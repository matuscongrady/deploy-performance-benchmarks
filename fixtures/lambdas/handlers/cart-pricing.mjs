import Decimal from 'decimal.js';
import { z } from 'zod';
import { input, products, order } from '../data.mjs';
import { revision } from './cart-pricing.revision.mjs';
export async function handler(event = {}) {
  const { lines } = z.object({ lines: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })).default(order.lines) }).parse(input(event));
  const total = lines.reduce((sum, line) => sum.plus(new Decimal(products.find(p => p.id === line.productId).price).times(line.quantity)), new Decimal(0));
  return { revision, subtotal: total.toFixed(2), currency: 'USD' };
}
