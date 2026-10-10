import assert from 'node:assert/strict';
import { createApp } from './server.mjs';
const server = createApp().listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  assert.equal((await (await fetch(`${base}/version`)).json()).service, 'commerce-api');
  const quote = await fetch(`${base}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines: [{ productId: 'coffee', quantity: 2 }, { productId: 'mug', quantity: 1 }] }) });
  assert.equal((await quote.json()).total, '33.00');
  const receipt = await fetch(`${base}/receipt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: 'order-100', placedAt: '2025-01-15T12:00:00Z', total: '33.00' }) });
  assert.equal((await receipt.json()).html, '<p>Order order-100, 2025-01-15: USD 33.00</p>');
  const invalid = await fetch(`${base}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines: [{ productId: 'coffee', quantity: -1 }] }) });
  assert.equal(invalid.status, 400);
  console.log('Verified Node API over HTTP: version, quote, receipt and invalid input.');
} finally { await new Promise(resolve => server.close(resolve)); }
