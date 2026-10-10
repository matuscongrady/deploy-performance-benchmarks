import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { createApp } from './server.mjs';
const probe = JSON.parse(await readFile(new URL('./probe.json', import.meta.url)));
if (probe.sign) probe.body[probe.sign] = createHmac('sha256', 'fixture-only-not-a-secret').update(probe.body.payload).digest('hex');
const server = createApp().listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const version = await (await fetch(`${base}/version`)).json();
  assert.equal(typeof version.revision, 'string');
  const response = await fetch(`${base}${probe.path}`, { method: probe.method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(probe.body) });
  assert.equal(response.status, 200);
  const result = await response.json();
  for (const [key, expected] of Object.entries(probe.expect)) assert.deepEqual(result[key], expected);
  assert.equal(result.revision, version.revision);
  console.log(`Verified ${version.service}: version and actual business response over HTTP.`);
} finally { await new Promise(resolve => server.close(resolve)); }
