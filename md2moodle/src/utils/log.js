/**
 * src/utils/log.js — Logger coloré minimaliste
 */

const C = {
  green:  '\x1b[92m',
  yellow: '\x1b[93m',
  red:    '\x1b[91m',
  cyan:   '\x1b[96m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  reset:  '\x1b[0m',
};

export const log = {
  ok:   (msg) => console.log(`  ${C.green}✓${C.reset} ${msg}`),
  warn: (msg) => console.log(`  ${C.yellow}⚠${C.reset} ${msg}`),
  err:  (msg) => console.log(`  ${C.red}✗${C.reset} ${msg}`),
  info: (msg) => console.log(`  ${C.bold}→${C.reset} ${msg}`),
  dim:  (msg) => console.log(`  ${C.dim}${msg}${C.reset}`),
  step: (msg) => console.log(`\n${C.bold}${C.cyan}${msg}${C.reset}`),
  done: (msg) => console.log(`\n${C.bold}${C.green}✅ ${msg}${C.reset}\n`),
};
