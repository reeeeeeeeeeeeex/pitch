import { spawnSync } from 'node:child_process';
const result = spawnSync(
  process.execPath,
  [
    'node_modules/@playwright/test/cli.js',
    'test',
    '--grep',
    'ten minute',
    '--workers',
    '2',
    '--output',
    '.local/soak-results',
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, RUN_SOAK: '1' },
  },
);
process.exitCode = result.status ?? 1;
