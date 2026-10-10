import { z } from 'zod';
import { input, products } from '../data.mjs';
import { createHash } from 'node:crypto';
import { revision } from './reserve-stock.revision.mjs';
export async function handler(event = {}) {
  const request = z.object({ productId: z.string().default('mug'), quantity: z.number().int().positive().default(2) }).parse(input(event));
  const product = products.find(p => p.id === request.productId);
  if (!product || request.quantity > product.stock) throw new Error('Insufficient stock');
  return { revision, reservationId: createHash('sha256').update(JSON.stringify(request)).digest('hex').slice(0, 12), remaining: product.stock - request.quantity };
}
