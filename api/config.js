// Safe-to-publish configuration: the Turnstile site key is public.
export function GET() {
  const siteKey = process.env.TURNSTILE_SITE_KEY;
  if (!siteKey || siteKey.startsWith('replace_')) {
    return Response.json({ error: 'Turnstile is not configured.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return Response.json({ siteKey }, { headers: { 'Cache-Control': 'no-store' } });
}
