import { products } from '../data.mjs';
import { revision } from './category-list.revision.mjs';
export async function handler(event = {}) {
  return { revision, categories: [...new Set(products.map(p => p.category))].sort() };
}
