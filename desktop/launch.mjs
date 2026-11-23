import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { homedir } from 'node:os';

process.env.PATH = [dirname(process.execPath), homedir() + '/.bend/bin', homedir() + '/.bun/bin',
  process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean).join(':');

for (const args of [['engine/build.mjs'], ['node_modules/vite/bin/vite.js', 'build', 'web']]) {
  const build = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (build.error) console.error(build.error.message);
  if (build.status !== 0) {
    console.error('Run npm ci and npm run engine:setup from the project folder if dependencies are missing.');
    process.exit(build.status ?? 1);
  }
}

process.env.PORT = process.env.TRAINING_DESKTOP_PORT ?? '4175';
await import('../server/index.mjs');
