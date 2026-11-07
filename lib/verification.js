const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TELEGRAM_URL = 'https://api.telegram.org/bot';
const MAX_TOKEN_LENGTH = 2048;

const text = (input, max = 180) => typeof input === 'string' ? input.slice(0, max).replace(/[\u0000-\u001F\u007F]/g, ' ') : '';
const html = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const value = (s) => html(s || 'Unavailable');

function decodeCity(s) {
  if (!s) return '';
  try { return decodeURIComponent(s); } catch { return s; }
}

function browserFromUA(ua) {
  if (/Edg\//.test(ua)) return 'Microsoft Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Google Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Unknown';
}

function osFromUA(ua) {
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS / iPadOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown';
}

function requestMetadata(req, details) {
  const h = req.headers;
  const ua = text(h.get('user-agent'), 220);
  // Vercel sets and overwrites X-Forwarded-For to avoid client-IP spoofing.
  // Do not trust this value when deploying outside Vercel without a trusted proxy.
  const ip = text(h.get('x-forwarded-for')?.split(',')[0]?.trim(), 80);
  return {
    ip,
    country: text(h.get('x-vercel-ip-country'), 12),
    city: text(decodeCity(h.get('x-vercel-ip-city')), 90),
    region: text(h.get('x-vercel-ip-country-region'), 20),
    browser: browserFromUA(ua),
    os: osFromUA(ua),
    userAgent: ua,
    language: text(details.language, 35),
    timezone: text(details.timezone, 70),
    connection: text(details.connection, 24),
    timestamp: new Date().toISOString(),
  };
}

function formattedTelegram(data) {
  // Telegram HTML formatting. All untrusted content is escaped.
  return [
    '🟣 <b>NEW VERIFIED WEBSITE VISITOR</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    '✅ <b>Verification</b>',
    'Status: Cloudflare Turnstile passed',
    `Time (UTC): <code>${value(data.timestamp)}</code>`,
    '',
    '🌐 <b>Network &amp; approximate location</b>',
    `Public IP: <code>${value(data.ip)}</code>`,
    `Country: ${value(data.country)}`,
    `City: ${value(data.city)}`,
    `Region: ${value(data.region)}`,
    `Connection estimate: ${value(data.connection)}`,
    '',
    '💻 <b>Browser &amp; device</b>',
    `Browser: ${value(data.browser)}`,
    `Operating system: ${value(data.os)}`,
    `Language: ${value(data.language)}`,
    `Time zone: ${value(data.timezone)}`,
    `User agent: <code>${value(data.userAgent)}</code>`,
    '',
    'ℹ️ IP-based location is approximate; no phone number or GPS was accessed.',
  ].join('\n');
}

function configuration(env) {
  const required = ['DEST_URL', 'TURNSTILE_SECRET', 'TURNSTILE_SITE_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
  if (required.some((key) => !env[key] || String(env[key]).startsWith('replace_'))) return null;
  try {
    const destination = new URL(env.DEST_URL);
    if (destination.protocol !== 'https:' || destination.username || destination.password) return null;
    return { destination };
  } catch { return null; }
}

function respond(message, status) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function verifyRequest(request, { env = process.env, doFetch = fetch } = {}) {
  if (request.method !== 'POST') return respond('Method not allowed.', 405);
  const cfg = configuration(env);
  if (!cfg) return respond('Service is not configured.', 503);

  // Derive the gate hostname from the URL Vercel served; no GATE_ORIGIN variable is needed.
  // For a browser POST, the Origin must match the current verification site.
  let gate;
  try {
    gate = new URL(request.url);
    if (gate.protocol !== 'https:' && !(gate.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(gate.hostname))) {
      return respond('HTTPS required.', 400);
    }
  } catch {
    return respond('Invalid request URL.', 400);
  }
  if (request.headers.get('origin') !== gate.origin) return respond('Incorrect verification origin.', 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return respond('JSON required.', 415);

  let body;
  try {
    if (Number(request.headers.get('content-length') || '0') > 6000) return respond('Payload too large.', 413);
    body = await request.json();
  } catch { return respond('Invalid request.', 400); }
  const token = body?.token;
  if (typeof token !== 'string' || token.length < 8 || token.length > MAX_TOKEN_LENGTH) {
    return respond('Invalid Turnstile token.', 400);
  }

  const meta = requestMetadata(request, {
    language: body?.language,
    timezone: body?.timezone,
    connection: body?.connection,
  });

  let result;
  try {
    const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
    if (meta.ip) form.set('remoteip', meta.ip);
    const response = await doFetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) throw new Error('Turnstile verification service failure');
    result = await response.json();
  } catch {
    return respond('Verification service is temporarily unavailable. Please try again.', 502);
  }
  // Hostname binding prevents accepted tokens from another website being replayed here.
  if (!result?.success || result.hostname !== gate.hostname) {
    return respond('Verification was not accepted. Please try again.', 403);
  }

  // Send only AFTER Siteverify approves. Delivery must succeed before we report success.
  try {
    const telegramResponse = await doFetch(`${TELEGRAM_URL}${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: formattedTelegram(meta),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(9000),
    });
    const telegramResult = await telegramResponse.json();
    if (!telegramResponse.ok || !telegramResult.ok) throw new Error('Telegram notification not delivered');
  } catch {
    // Do not leak the Telegram token, internal API response, or visitor metadata in logs or response.
    return respond('Access could not be completed. Please retry verification.', 502);
  }

  return Response.json({ ok: true, redirect: cfg.destination.href }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export { formattedTelegram };
