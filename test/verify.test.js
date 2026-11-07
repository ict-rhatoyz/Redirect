import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyRequest, formattedTelegram } from '../lib/verification.js';

const env = {
  GATE_ORIGIN: 'https://verify.example.com',
  DEST_URL: 'https://destination.example.com/welcome',
  TURNSTILE_SITE_KEY: 'test-sitekey',
  TURNSTILE_SECRET: 'test-secret',
  TELEGRAM_BOT_TOKEN: 'mock-bot-token',
  TELEGRAM_CHAT_ID: '42',
};
const sample = (token = 'sample-turnstile-token') => new Request('https://verify.example.com/api/verify', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Origin': 'https://verify.example.com',
    'X-Forwarded-For': '203.0.113.52',
    'X-Vercel-IP-Country': 'NL',
    'X-Vercel-IP-City': 'The%20Hague',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'
  },
  body: JSON.stringify({ token, language: 'en-GB', timezone: 'Europe/Amsterdam', connection: '4g' }),
});

test('verified token sends Telegram, then returns fixed redirect URL', async () => {
  const calls = [];
  const doFetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('siteverify')) return new Response(JSON.stringify({ success: true, hostname: 'verify.example.com' }), { status: 200 });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  };
  const result = await verifyRequest(sample(), { env, doFetch });
  const body = await result.json();
  assert.equal(result.status, 200);
  assert.deepEqual(body, { ok: true, redirect: env.DEST_URL });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /siteverify/);
  assert.match(calls[1].url, /sendMessage/);
  const msg = JSON.parse(calls[1].opts.body).text;
  assert.match(msg, /203\.0\.113\.52/);
  assert.match(msg, /The Hague/);
  assert.match(msg, /Cloudflare Turnstile passed/);
  assert.doesNotMatch(msg, /Phone:/);
});

test('failed Turnstile rejects and does not notify', async () => {
  let calls = 0;
  const result = await verifyRequest(sample(), { env, doFetch: async () => { calls++; return new Response('{"success":false}', {status:200}); } });
  assert.equal(result.status, 403);
  assert.equal(calls, 1);
});

test('wrong Siteverify hostname rejects and does not notify', async () => {
  let calls = 0;
  const result = await verifyRequest(sample(), { env, doFetch: async () => { calls++; return new Response('{"success":true,"hostname":"elsewhere.test"}', {status:200}); } });
  assert.equal(result.status, 403);
  assert.equal(calls, 1);
});

test('wrong request origin is rejected before external calls', async () => {
  const req = sample();
  const evil = new Request(req, { headers: { ...Object.fromEntries(req.headers), Origin: 'https://other.example' } });
  let calls = 0;
  const result = await verifyRequest(evil, { env, doFetch: async () => { calls++; throw new Error('should not call'); } });
  assert.equal(result.status, 403);
  assert.equal(calls, 0);
});

test('bad JSON and malformed token fail', async () => {
  const result = await verifyRequest(sample('bad'), { env });
  assert.equal(result.status, 400);
});

test('Telegram delivery fails closed with no redirect', async () => {
  const doFetch = async (url) => url.includes('siteverify')
    ? new Response('{"success":true,"hostname":"verify.example.com"}', {status: 200})
    : new Response('{"ok":false}', {status: 200});
  const result = await verifyRequest(sample(), { env, doFetch });
  assert.equal(result.status, 502);
  assert.equal((await result.json()).redirect, undefined);
});

test('Telegram message escapes supplied HTML', () => {
  const msg = formattedTelegram({ ip: '<script>alert(1)</script>', userAgent: 'Mozilla <b>bogus</b>', timestamp: '2026-11-07T09:00:00Z' });
  assert.doesNotMatch(msg, /<script>/);
  assert.match(msg, /&lt;script&gt;/);
  assert.match(msg, /&lt;b&gt;/);
});
