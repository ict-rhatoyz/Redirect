import { verifyRequest } from '../lib/verification.js';

export function POST(request) {
  return verifyRequest(request);
}
