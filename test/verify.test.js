import test from 'node:test';
import assert from 'node:assert/strict';
import { visitRequest, publicConfiguration, formattedTelegram } from '../lib/verification.js';

const env = {
  DEST_URL: 'https://destination.example.com/welcome',
  TELEGRAM_BOT_TOKEN: 'mock-bot-token',
  TELEGRAM_CHAT_ID: '42',
};
const cfEnv = {
  ...env,
  TURNSTILE_MODE: 'optional',
  TURNSTILE_SITE_KEY: 'test-sitekey',
  TURNSTILE_SECRET: 'test-secret',
};
const sample = ({ token, hostname = 'verify.example.com' } = {}) => new Request(`https://${hostname}/api/verify`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Origin': `https://${hostname}`,
    'X-Forwarded-For': '203.0.113.52',
    'X-Vercel-IP-Country': 'NL',
    'X-Vercel-IP-City': 'The%20Hague',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  },
  body: JSON.stringify({ ...(token ? { token } : {}), language: 'en-GB', timezone: 'Europe/Amsterdam', connection: '4g' }),
});
const telegramOK = () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });

test('missing Turnstile keys: sends Telegram and redirects automatically', async () => {
  const calls = [];
  const result = await visitRequest(sample(), { env, doFetch: async (url, opts) => { calls.push({ url, opts }); return telegramOK(); } });
  const body = await result.json();
  assert.equal(result.status, 200);
  assert.deepEqual(body, { ok: true, redirect: env.DEST_URL, notificationSent: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /sendMessage/);
  const msg = JSON.parse(calls[0].opts.body).text;
  assert.match(msg, /203\.0\.113\.52/);
  assert.match(msg, /The Hague/);
  assert.match(msg, /Not enabled/);
  assert.doesNotMatch(msg, /Phone:/);
});

test('leftover Turnstile keys with mode off do not block or call Cloudflare', async () => {
  const calls = [];
  const result = await visitRequest(sample(), { env: { ...cfEnv, TURNSTILE_MODE: 'off' }, doFetch: async (url) => { calls.push(url); return telegramOK(); } });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /sendMessage/);
});

test('mode optional without both keys behaves like Turnstile off', async () => {
  const calls = [];
  const result = await visitRequest(sample(), { env: { ...env, TURNSTILE_MODE: 'optional', TURNSTILE_SITE_KEY: 'test-only' }, doFetch: async (url) => { calls.push(url); return telegramOK(); } });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
});

test('optional Turnstile valid token gets verified, then Telegram notification', async () => {
  const calls = [];
  const response = await visitRequest(sample({ token: 'valid-turnstile-token' }), {
    env: cfEnv,
    doFetch: async (url) => { calls.push(url); return url.includes('siteverify') ? Response.json({ success: true, hostname: 'verify.example.com' }) : telegramOK(); },
  });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /siteverify/);
  assert.match(calls[1], /sendMessage/);
});

test('optional Turnstile invalid response never blocks notification or redirect', async () => {
  const calls = [];
  const response = await visitRequest(sample({ token: 'wrong-token-string' }), {
    env: cfEnv,
    doFetch: async (url, opts) => { calls.push({ url, opts }); return url.includes('siteverify') ? Response.json({ success: false }) : telegramOK(); },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.notificationSent, true);
  assert.equal(calls.length, 2);
  assert.match(JSON.parse(calls[1].opts.body).text, /Not completed/);
});

test('optional Turnstile outage never blocks notification or redirect', async () => {
  const calls = [];
  const response = await visitRequest(sample({ token: 'valid-looking-token' }), {
    env: cfEnv,
    doFetch: async (url) => { calls.push(url); if (url.includes('siteverify')) throw Error('offline'); return telegramOK(); },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).notificationSent, true);
  assert.equal(calls.length, 2);
});

test('optional Turnstile without token continues without Cloudflare', async () => {
  const calls = [];
  const response = await visitRequest(sample(), { env: cfEnv, doFetch: async (url) => { calls.push(url); return telegramOK(); } });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
});

test('Telegram failure does not block redirect', async () => {
  const response = await visitRequest(sample(), { env, doFetch: async () => Response.json({ ok: false }, { status: 502 }) });
  assert.deepEqual(await response.json(), { ok: true, redirect: env.DEST_URL, notificationSent: false });
});

test('missing Telegram config still redirects but truthfully indicates not sent', async () => {
  const response = await visitRequest(sample(), { env: { DEST_URL: env.DEST_URL }, doFetch: async () => { throw Error('must not call'); } });
  assert.deepEqual(await response.json(), { ok: true, redirect: env.DEST_URL, notificationSent: false });
});

test('missing destination fails to redirect', async () => {
  const response = await visitRequest(sample(), { env: { ...env, DEST_URL: '' } });
  assert.equal(response.status, 503);
});

test('rejects incorrect request origin before notifying', async () => {
  const original = sample();
  const h = new Headers(original.headers);
  h.set('Origin', 'https://other.example.com');
  const req = new Request(original.url, { method: 'POST', headers: h, body: '{}' });
  const response = await visitRequest(req, { env, doFetch: async () => { throw Error('should not call'); } });
  assert.equal(response.status, 403);
});

test('invalid JSON is rejected', async () => {
  const headers = new Headers(sample().headers);
  const req = new Request('https://verify.example.com/api/verify', { method: 'POST', headers, body: 'not json' });
  const response = await visitRequest(req, { env });
  assert.equal(response.status, 400);
});

test('Telegram escapes supplied HTML in user data', () => {
  const msg = formattedTelegram({ ip: '<script>alert(1)</script>', userAgent: 'Mozilla <b>bogus</b>' });
  assert.doesNotMatch(msg, /<script>/);
  assert.match(msg, /&lt;script&gt;/);
  assert.match(msg, /&lt;b&gt;/);
});

test('valid custom Vercel/custom hostname works without GATE_ORIGIN', async () => {
  const response = await visitRequest(sample({ hostname: 'preview-123.vercel.app' }), { env, doFetch: async () => telegramOK() });
  assert.equal(response.status, 200);
});

test('public config includes optional Turnstile only when intentionally enabled', () => {
  assert.deepEqual(publicConfiguration(env), { redirect: env.DEST_URL, turnstileEnabled: false });
  assert.deepEqual(publicConfiguration({ ...cfEnv, TURNSTILE_MODE: 'off' }), { redirect: env.DEST_URL, turnstileEnabled: false });
  assert.deepEqual(publicConfiguration(cfEnv), { redirect: env.DEST_URL, turnstileEnabled: true, siteKey: 'test-sitekey' });
});
