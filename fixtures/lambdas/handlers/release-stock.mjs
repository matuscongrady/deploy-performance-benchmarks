import { z } from 'zod';
import { input } from '../data.mjs';
import { revision } from './release-stock.revision.mjs';
export async function handler(event = {}) {
  const request = z.object({ reservationId: z.string().default('reservation-10'), quantity: z.number().int().positive().default(2) }).parse(input(event));
  return { revision, released: request.quantity, reservationId: request.reservationId };
}
