#!/usr/bin/env node

import { formatCliError, run } from '../lib/pageleaf.js';

try {
  await run(process.argv.slice(2));
} catch (error) {
  console.error(formatCliError(error));
  process.exitCode = error?.exitCode ?? 1;
}
