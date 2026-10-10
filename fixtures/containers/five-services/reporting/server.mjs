import express from 'express';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';
import { revision } from './revision.mjs';
import PDFDocument from 'pdfkit';
const service = 'reporting';
export function createApp() {
  const app = express(); app.use(express.json({ limit: '64kb' }));
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/version', (req, res) => res.json({ service, revision }));
  app.post('/report', async (req, res, next) => {
    try {
      const { jobId, sales } = z.object({ jobId: z.string().min(1), sales: z.number().nonnegative() }).parse(req.body);
      const pdf = new PDFDocument(); const chunks = [];
      const done = new Promise((resolve, reject) => { pdf.on('data', part => chunks.push(part)); pdf.on('end', () => resolve(Buffer.concat(chunks))); pdf.on('error', reject); });
      pdf.text(`Sales report ${jobId}: ${sales}`); pdf.end(); const bytes = await done;
      res.json({ service, revision, jobId, format: bytes.subarray(0, 4).toString(), bytes: bytes.length });
    } catch (error) { next(error); }
  });
  app.use((error, req, res, next) => res.status(400).json({ error: 'Invalid request' }));
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createApp().listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
  process.on('SIGTERM', () => server.close());
}
