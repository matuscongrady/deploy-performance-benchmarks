import Decimal from 'decimal.js';
import { z } from 'zod';
import { input } from '../data.mjs';
import { revision } from './apply-discount.revision.mjs';
export async function handler(event = {}) {
  const request = z.object({ subtotal: z.string().default('33.00'), code: z.string().default('WELCOME10') }).parse(input(event));
  const discount = request.code === 'WELCOME10' ? new Decimal(request.subtotal).times('0.10') : new Decimal(0);
  return { revision, discount: discount.toFixed(2), total: new Decimal(request.subtotal).minus(discount).toFixed(2) };
}
