import express from 'express';
import { z } from 'zod';
import Decimal from 'decimal.js';
import Handlebars from 'handlebars';
import { DateTime } from 'luxon';
import { pathToFileURL } from 'node:url';
import { revision } from './revision.mjs';
const products = [{ id: 'coffee', name: 'Coffee beans', price: '12.50' }, { id: 'mug', name: 'Ceramic mug', price: '8.00' }];
export function createApp() {
  const app = express(); app.use(express.json({ limit: '64kb' }));
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/version', (req, res) => res.json({ service: 'commerce-api', revision }));
  app.get('/products', (req, res) => res.json({ revision, products }));
  app.post('/quote', (req, res) => {
    const { lines } = z.object({ lines: z.array(z.object({ productId: z.enum(['coffee', 'mug']), quantity: z.number().int().positive() })).nonempty() }).parse(req.body);
    const total = lines.reduce((sum, line) => sum.plus(new Decimal(products.find(p => p.id === line.productId).price).times(line.quantity)), new Decimal(0));
    res.json({ revision, total: total.toFixed(2), currency: 'USD' });
  });
  app.post('/receipt', (req, res) => {
    const request = z.object({ orderId: z.string(), placedAt: z.string().datetime(), total: z.string().regex(/^\d+\.\d{2}$/) }).parse(req.body);
    const date = DateTime.fromISO(request.placedAt, { zone: 'utc' }).toFormat('yyyy-MM-dd');
    res.json({ revision, html: Handlebars.compile('<p>Order {{orderId}}, {{date}}: USD {{total}}</p>')({ ...request, date }) });
  });
  app.use((error, req, res, next) => res.status(400).json({ error: 'Invalid request' }));
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createApp().listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
  process.on('SIGTERM', () => server.close());
}
