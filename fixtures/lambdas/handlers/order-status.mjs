import { z } from 'zod';
import { input } from '../data.mjs';
import { revision } from './order-status.revision.mjs';
export async function handler(event = {}) {
  const { orderId } = z.object({ orderId: z.string().default('order-100') }).parse(input(event));
  return { revision, orderId, status: orderId === 'order-100' ? 'processing' : 'not-found' };
}
