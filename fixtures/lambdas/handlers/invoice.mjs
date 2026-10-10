import Handlebars from 'handlebars';
import { order, amount } from '../data.mjs';
import { revision } from './invoice.revision.mjs';
export async function handler(event = {}) {
  const html = Handlebars.compile('<h1>Invoice {{id}}</h1><p>Total USD {{total}}</p>')({ id: order.id, total: amount(order.lines).toFixed(2) });
  return { revision, orderId: order.id, html };
}
