// Kept at /api/verify for compatibility with the previous package.
// Turnstile is optional and never blocks the visitor in this version.
import { visitRequest } from '../lib/verification.js';

export function POST(request) {
  return visitRequest(request);
}
