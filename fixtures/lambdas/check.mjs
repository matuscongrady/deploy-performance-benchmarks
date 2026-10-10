import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const workloads = JSON.parse(await readFile(new URL('./workloads.json', import.meta.url)));
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
const names = [...new Set(Object.values(workloads).flatMap(w=>Object.keys(w.entrypoints)))];
function contains(actual, expected) {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length===expected.length && expected.every((v,i)=>contains(actual[i],v));
  if (expected && typeof expected==='object') return actual && Object.entries(expected).every(([key,value])=>contains(actual[key],value));
  return actual===expected;
}
const results = {};
for (const name of names) {
  const spec = manifest.lambda.functions.find(f=>f.name===name);
  const { handler } = await import(new URL(`handlers/${name}.mjs`, import.meta.url));
  const result = await handler(spec.probe.input);
  assert.equal(typeof result.revision, 'string');
  assert.ok(contains(result,spec.probe.expected),`Business result failed for ${name}`);
  results[name] = result;
}
if (results.report) {
  assert.deepEqual(results.report.files.map(f=>f.prefix), ['%PDF','PK','PK']);
  assert.ok(results.report.files.every(f=>f.bytes>1000));
}
if (results['payment-webhook']) {
  const { handler } = await import('./handlers/payment-webhook.mjs');
  await assert.rejects(handler({ signature:'bad' }), /Invalid signature/);
}
if (results['cart-pricing']) {
  const { handler } = await import('./handlers/cart-pricing.mjs');
  await assert.rejects(handler({ lines:[{productId:'coffee',quantity:-1}] }));
}
console.log(`Verified ${names.length} selected functions and their business results.`);
