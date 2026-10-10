import Decimal from 'decimal.js';
import { z } from 'zod';
import { input } from '../data.mjs';
import { revision } from './tax-quote.revision.mjs';
export async function handler(event = {}) {
  const request = z.object({ subtotal: z.string().default('33.00'), region: z.enum(['CA', 'NY', 'OR']).default('CA') }).parse(input(event));
  const rate = { CA: '0.0725', NY: '0.04', OR: '0' }[request.region];
  return { revision, tax: new Decimal(request.subtotal).times(rate).toFixed(2), region: request.region };
}
