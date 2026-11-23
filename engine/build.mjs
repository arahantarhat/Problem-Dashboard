import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const env = {...process.env, BEND_NO_TELEMETRY:'1'};
const checkout = '.engine/bend/bend2/main.ts';
const bun = existsSync(root + '.engine/runtime/node_modules/.bin/bun') ? '.engine/runtime/node_modules/.bin/bun' : 'bun';
const command = process.env.BEND_BIN || (existsSync(root+checkout) ? bun : 'bend');
const prefix = !process.env.BEND_BIN && existsSync(root+checkout) ? [checkout] : [];
mkdirSync(root+'.engine', {recursive:true});
const result = spawnSync(command,[...prefix,'engine/training.bend','-o','.engine/training.mjs'],{cwd:root,env,stdio:'inherit'});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
