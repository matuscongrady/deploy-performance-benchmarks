import Handlebars from 'handlebars';
import validator from 'validator';
import { input, order } from '../data.mjs';
import { revision } from './notification.revision.mjs';
export async function handler(event = {}) {
  const request = { ...order, ...input(event) };
  if (!validator.isEmail(request.email)) throw new Error('Invalid recipient');
  const html = Handlebars.compile('<p>Your order {{id}} has been accepted.</p>')(request);
  return { revision, recipient: request.email, subject: `Order ${request.id}`, html };
}
