import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url)));
function run(command, args, directory) {
  const result = spawnSync(command, args, { cwd: resolve(root, directory), stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const contexts = [manifest.lambda?.context, ...(manifest.containers || []).filter(c=>c.id!=='container-python').map(c=>c.buildContext), ...(manifest.fiveServices?.services || []).map(s=>s.buildContext)].filter(Boolean);
for (const directory of new Set(contexts)) run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], directory);
const python = manifest.containers?.find(c=>c.id==='container-python');
if (python && !process.argv.includes('--node-only')) {
  run('uv', ['venv', '--python', manifest.runtimes.python, '.venv'], python.buildContext);
  run('uv', ['pip', 'install', '--python', '.venv/bin/python', '--require-hashes', '-r', 'requirements-check.txt'], python.buildContext);
}
