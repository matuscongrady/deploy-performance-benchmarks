import express from 'express';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';
import { revision } from './revision.mjs';
import Handlebars from 'handlebars';
const service = 'notifications';
export function createApp() {
  const app = express(); app.use(express.json({ limit: '64kb' }));
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/version', (req, res) => res.json({ service, revision }));
  app.post('/notify', (req, res) => {
    const { jobId, email, orderId } = z.object({ jobId: z.string().min(1), email: z.string().email(), orderId: z.string() }).parse(req.body);
    const html = Handlebars.compile('<p>Order {{orderId}} is ready.</p>')({ orderId });
    res.json({ service, revision, jobId, recipient: email, html, status: 'processed' });
  });
  app.use((error, req, res, next) => res.status(400).json({ error: 'Invalid request' }));
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createApp().listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
  process.on('SIGTERM', () => server.close());
}
