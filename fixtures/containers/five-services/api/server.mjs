import express from 'express';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';
import { revision } from './revision.mjs';
import Decimal from 'decimal.js';
const service = 'api';
export function createApp() {
  const app = express(); app.use(express.json({ limit: '64kb' }));
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/version', (req, res) => res.json({ service, revision }));
  app.post('/quote', (req, res) => {
    const { quantity } = z.object({ quantity: z.number().int().positive() }).parse(req.body);
    res.json({ service, revision, total: new Decimal('12.50').times(quantity).toFixed(2) });
  });
  app.use((error, req, res, next) => res.status(400).json({ error: 'Invalid request' }));
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createApp().listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
  process.on('SIGTERM', () => server.close());
}
