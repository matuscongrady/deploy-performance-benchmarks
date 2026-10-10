import { createHmac, timingSafeEqual } from 'node:crypto';
import { input } from '../data.mjs';
import { revision } from './payment-webhook.revision.mjs';
export async function handler(event = {}) {
  const request = input(event);
  const payload = request.payload ?? '{"orderId":"order-100","status":"paid"}';
  const expected = createHmac('sha256', 'fixture-only-not-a-secret').update(payload).digest('hex');
  const provided = request.signature ?? expected;
  if (provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) throw new Error('Invalid signature');
  return { revision, accepted: true, ...JSON.parse(payload) };
}
