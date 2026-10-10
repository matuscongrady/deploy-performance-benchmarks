import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { input } from '../data.mjs';
import { revision } from './catalog-import.revision.mjs';
export async function handler(event = {}) {
  const { csv = 'id,price,stock\ncoffee,12.50,40\nmug,8.00,12' } = input(event);
  const rows = parse(csv, { columns: true, skip_empty_lines: true }).map(row => z.object({ id: z.string(), price: z.coerce.number().positive(), stock: z.coerce.number().int().nonnegative() }).parse(row));
  return { revision, imported: rows.length, products: rows };
}
