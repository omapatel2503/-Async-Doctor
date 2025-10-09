#!/usr/bin/env node
import { spawn } from 'node:child_process';
import * as path from 'node:path';

function parseArgs(argv: string[]) {
  // async-doctor-trace [--out trace.json] [--stacks] [--quiet] [--cwd <dir>] -- <command...>
  let out = 'trace.json';
  let stacks = false;
  let quiet = false;
  let cwd: string | undefined;

  const cmdParts: string[] = [];
  let inCmd = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!inCmd) {
      if (a === '--') { inCmd = true; continue; }
      if (a === '--out' && argv[i + 1]) { out = argv[++i]; continue; }
      if (a === '--stacks') { stacks = true; continue; }
      if (a === '--quiet' || a === '-q') { quiet = true; continue; }
      if (a === '--cwd' && argv[i + 1]) { cwd = argv[++i]; continue; }
      // allow single-arg command without --
      if (!a.startsWith('-')) { inCmd = true; cmdParts.push(a); continue; }
    } else {
      cmdParts.push(a);
    }
  }
  return { out, stacks, quiet, cwd, cmdParts };
}

function helpAndExit(code = 1) {
  console.log(
`Usage:
  async-doctor-trace [--out trace.json] [--stacks] [--quiet] [--cwd <dir>] -- <command...>
  async-doctor-trace [--out trace.json] [--stacks] [--quiet] [--cwd <dir>] <command...>

Examples:
  async-doctor-trace -- npm test
  async-doctor-trace --out .tmp/trace.json --stacks -- npm run build && npm test
  async-doctor-trace --cwd "../../appcenter-cli" -- npm test`
  );
  process.exit(code);
}

const { out, stacks, quiet, cwd, cmdParts } = parseArgs(process.argv.slice(2));
if (cmdParts.length === 0) helpAndExit(1);

// Path to compiled hook.js
const hookPath = path.join(__dirname, 'hook.js');

// IMPORTANT: Quote the path for NODE_OPTIONS so spaces are safe on Windows.
// JSON.stringify gives us a properly quoted/escaped string with backslashes handled.
const preload = `--require ${JSON.stringify(hookPath)}`;

const env = { ...process.env };
const existing = env.NODE_OPTIONS || '';
env.NODE_OPTIONS = existing ? `${existing} ${preload}` : preload;
env.NODE_OPTIONS += ' --no-experimental-strip-types';
env.ASYNC_DOCTOR_TRACE = out;
if (stacks) env.ASYNC_DOCTOR_STACKS = '1';

if (!quiet) {
  console.error(
    `Async Doctor tracer: tracing "${cmdParts.join(' ')}"\n` +
    `  output: ${out}\n` +
    `  stacks: ${stacks ? 'on' : 'off'}\n` +
    (cwd ? `  cwd: ${cwd}\n` : '')
  );
}

// Run the command via shell so complex commands work (npm scripts, &&, etc.)
const child = spawn(cmdParts.join(' '), {
  stdio: 'inherit',
  shell: true,
  env,
  cwd: cwd ?? process.cwd(),
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
