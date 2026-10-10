import { z } from 'zod';
import { input, products } from '../data.mjs';
import { revision } from './inventory-check.revision.mjs';
export async function handler(event = {}) {
  const request = z.object({ productId: z.string().default('coffee'), quantity: z.number().int().positive().default(2) }).parse(input(event));
  const item = products.find(p => p.id === request.productId);
  return { revision, available: Boolean(item && item.stock >= request.quantity), stock: item?.stock ?? 0 };
}
