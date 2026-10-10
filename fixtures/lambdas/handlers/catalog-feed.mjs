import { XMLBuilder } from 'fast-xml-parser';
import { products } from '../data.mjs';
import { revision } from './catalog-feed.revision.mjs';
export async function handler(event = {}) {
  const xml = new XMLBuilder({ format: false }).build({ catalog: { product: products.map(p => ({ id: p.id, name: p.name, price: p.price })) } });
  return { revision, contentType: 'application/xml', xml };
}
