import express from 'express';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';
import { revision } from './revision.mjs';

const service = 'inventory';
export function createApp() {
  const app = express(); app.use(express.json({ limit: '64kb' }));
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/version', (req, res) => res.json({ service, revision }));
  app.post('/reserve', (req, res) => {
    const { productId, quantity } = z.object({ productId: z.enum(['coffee', 'mug']), quantity: z.number().int().positive().max(12) }).parse(req.body);
    const stock = { coffee: 40, mug: 12 }[productId];
    res.json({ service, revision, productId, remaining: stock - quantity });
  });
  app.use((error, req, res, next) => res.status(400).json({ error: 'Invalid request' }));
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createApp().listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
  process.on('SIGTERM', () => server.close());
}
