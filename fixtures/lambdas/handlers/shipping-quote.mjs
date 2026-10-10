import Decimal from 'decimal.js';
import { z } from 'zod';
import { input } from '../data.mjs';
import { revision } from './shipping-quote.revision.mjs';
export async function handler(event = {}) {
  const request = z.object({ country: z.enum(['US', 'CA', 'GB']).default('US'), weightKg: z.number().positive().default(2) }).parse(input(event));
  const base = { US: '4.00', CA: '8.00', GB: '12.00' }[request.country];
  return { revision, cost: new Decimal(base).plus(new Decimal(request.weightKg).times('1.25')).toFixed(2), currency: 'USD' };
}
