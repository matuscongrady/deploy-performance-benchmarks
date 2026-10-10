import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { input } from '../data.mjs';
import { revision } from './shipment-update.revision.mjs';
export async function handler(event = {}) {
  const { xml = '<shipment><orderId>order-100</orderId><status>delivered</status></shipment>' } = input(event);
  const shipment = z.object({ orderId: z.string(), status: z.enum(['shipped', 'delivered']) }).parse(new XMLParser().parse(xml).shipment);
  return { revision, ...shipment };
}
