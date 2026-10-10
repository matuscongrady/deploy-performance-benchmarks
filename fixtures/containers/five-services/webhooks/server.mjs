import express from 'express';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';
import { revision } from './revision.mjs';
import { createHmac, timingSafeEqual } from 'node:crypto';
const service = 'webhooks';
export function createApp() {
  const app = express(); app.use(express.json({ limit: '64kb' }));
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/version', (req, res) => res.json({ service, revision }));
  app.post('/webhook', (req, res) => {
    const request = z.object({ payload: z.string(), signature: z.string() }).parse(req.body);
    const expected = createHmac('sha256', 'fixture-only-not-a-secret').update(request.payload).digest('hex');
    if (request.signature.length !== expected.length || !timingSafeEqual(Buffer.from(request.signature), Buffer.from(expected))) return res.status(401).json({ error: 'Invalid signature' });
    res.json({ service, revision, accepted: true, event: JSON.parse(request.payload) });
  });
  app.use((error, req, res, next) => res.status(400).json({ error: 'Invalid request' }));
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createApp().listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
  process.on('SIGTERM', () => server.close());
}
