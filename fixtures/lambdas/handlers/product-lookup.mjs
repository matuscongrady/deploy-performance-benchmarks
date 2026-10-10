import { z } from 'zod';
import { input, products } from '../data.mjs';
import { revision } from './product-lookup.revision.mjs';
export async function handler(event = {}) {
  const { id } = z.object({ id: z.string().default('coffee') }).parse(input(event));
  const product = products.find(p => p.id === id);
  return { revision, product: product ?? null };
}
