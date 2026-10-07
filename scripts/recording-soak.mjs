import { spawnSync } from 'node:child_process';
const build = spawnSync('npm run build', { shell: true, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);
const run = spawnSync(
  process.execPath,
  [
    'node_modules/@playwright/test/cli.js',
    'test',
    '--grep',
    'thirty minute',
    '--project',
    'chrome',
    '--output',
    '.local/recording-soak-test',
  ],
  { stdio: 'inherit', env: { ...process.env, RUN_RECORDING_SOAK: '1' } },
);
process.exitCode = run.status ?? 1;
