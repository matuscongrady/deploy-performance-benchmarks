import { z } from 'zod';
import { DateTime } from 'luxon';
import { input } from '../data.mjs';
import { revision } from './return-request.revision.mjs';
export async function handler(event = {}) {
  const request = z.object({ deliveredAt: z.string().default('2025-01-01'), requestedAt: z.string().default('2025-01-15'), orderId: z.string().default('order-100') }).parse(input(event));
  const days = DateTime.fromISO(request.requestedAt).diff(DateTime.fromISO(request.deliveredAt), 'days').days;
  return { revision, orderId: request.orderId, eligible: days >= 0 && days <= 30, daysSinceDelivery: days };
}
