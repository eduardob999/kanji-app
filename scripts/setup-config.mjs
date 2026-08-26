/**
 * Creates src/firebaseConfig.ts from the checked-in template the first time it
 * is needed. Runs automatically before `npm run dev` and `npm run build`.
 *
 * The generated file is gitignored, so a fresh clone (or CI) would otherwise
 * fail to compile on a missing import before it ever got the chance to explain
 * why.
 */
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(projectRoot, 'src/firebaseConfig.ts');
const template = resolve(projectRoot, 'src/firebaseConfig.example.ts');

if (existsSync(target)) {
  process.exit(0);
}

if (!existsSync(template)) {
  console.error('Missing src/firebaseConfig.example.ts — cannot create the Firebase config.');
  process.exit(1);
}

copyFileSync(template, target);

console.log(
  'Created src/firebaseConfig.ts from the template.\n' +
    'Add your Firebase values there or in .env.local before signing in.',
);
