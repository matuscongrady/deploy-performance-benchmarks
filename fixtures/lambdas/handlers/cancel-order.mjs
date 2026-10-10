import { z } from 'zod';
import { input } from '../data.mjs';
import { revision } from './cancel-order.revision.mjs';
export async function handler(event = {}) {
  const request = z.object({ orderId: z.string().default('order-100'), status: z.enum(['processing', 'shipped']).default('processing') }).parse(input(event));
  return { revision, orderId: request.orderId, cancelled: request.status === 'processing' };
}
