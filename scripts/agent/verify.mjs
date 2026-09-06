import { verify, errorExit } from './lib.mjs';
try {
  const result = await verify({ profile: process.argv[2] ?? 'check' });
  console.log('Verification: ' + result.status + ' (' + result.fingerprint.slice(0, 12) + ')');
  if (result.status !== 'passed') process.exitCode = 1;
} catch (error) { errorExit(error); }
