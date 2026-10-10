import { z } from 'zod';
import { input, products } from '../data.mjs';
import { revision } from './product-search.revision.mjs';
export async function handler(event = {}) {
  const { query } = z.object({ query: z.string().default('cof') }).parse(input(event));
  return { revision, matches: products.filter(p => p.name.toLowerCase().includes(query.toLowerCase())).map(p => p.id) };
}
