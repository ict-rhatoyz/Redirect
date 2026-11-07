import { publicConfiguration } from '../lib/verification.js';

export function GET() {
  const config = publicConfiguration(process.env);
  if (!config) {
    return Response.json({ error: 'Destination is not configured.' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  return Response.json(config, { headers: { 'Cache-Control': 'no-store' } });
}
