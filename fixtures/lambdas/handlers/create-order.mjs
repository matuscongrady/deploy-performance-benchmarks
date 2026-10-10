import { z } from 'zod';
import { createHash } from 'node:crypto';
import { input, order, amount } from '../data.mjs';
import { revision } from './create-order.revision.mjs';
export async function handler(event = {}) {
  const request = z.object({ customerId: z.string(), email: z.string().email(), lines: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })) }).parse({ ...order, ...input(event) });
  return { revision, orderId: createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 16), status: 'accepted', total: amount(request.lines).toFixed(2) };
}
