import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url)));
const contexts = [manifest.lambda?.context, ...(manifest.containers || []).filter(c=>c.id!=='container-python').map(c=>c.buildContext), ...(manifest.fiveServices?.services || []).map(s=>s.buildContext)].filter(Boolean);
for (const directory of new Set(contexts)) {
  const result = spawnSync(process.execPath, ['check.mjs'], { cwd: resolve(root, directory), stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const fixture = manifest.containers?.find(c=>c.id==='container-python');
if (fixture && !process.argv.includes('--node-only')) {
  const python = resolve(root, fixture.buildContext, '.venv/bin/python');
  if (!existsSync(python)) throw new Error('Install the Python check environment first. See fixtures/README.md. Use --node-only only when intentionally excluding Python.');
  const result = spawnSync(python, ['check.py'], { cwd: resolve(root, fixture.buildContext), stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('All selected fixture checks passed. These checks made no cloud requests.');
