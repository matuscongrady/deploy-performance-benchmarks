import { z } from 'zod';
import { createHash } from 'node:crypto';
import { input } from '../data.mjs';
import { revision } from './payment-intent.revision.mjs';
export async function handler(event = {}) {
  const request = z.object({ orderId: z.string().default('order-100'), amountCents: z.number().int().positive().default(3300) }).parse(input(event));
  return { revision, intentId: createHash('sha256').update(request.orderId).digest('hex').slice(0, 16), amountCents: request.amountCents, currency: 'USD', capture: 'manual' };
}
