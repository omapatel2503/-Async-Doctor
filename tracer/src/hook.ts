import * as asyncHooks from 'node:async_hooks';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';

type Origin = 'user' | 'library' | 'io';

export interface PromiseEvent {
  id: number;
  triggerId: number;
  type: string;      // 'PROMISE'
  start: number;     // ms since tracer start
  end?: number;      // ms since tracer start
  location?: string; // "file:line:col"
  origin?: Origin;   // user | library | io
  stack?: string;    // optional full stack if enabled
}

/* ==============================
   Environment / configuration
   ============================== */

const OUT_PATH = process.env.ASYNC_DOCTOR_TRACE || 'trace.json';
const CAPTURE_STACKS =
  process.env.ASYNC_DOCTOR_STACKS === '1' ||
  process.env.ASYNC_DOCTOR_STACKS === 'true';

const CWD = process.cwd().replace(/\\/g, '/');              // normalize slashes
const TRACER_DIR = path.resolve(__dirname).replace(/\\/g, '/'); // compiled dist dir

/* ==============================
   State
   ============================== */

const t0 = performance.now();
const events = new Map<number, PromiseEvent>();

function nowRel(): number {
  return performance.now() - t0;
}

/* ==============================
   Stack helpers
   ============================== */

function isInternalFrame(line: string): boolean {
  return (
    line.includes('node:internal') ||
    line.includes(' internal/') ||
    line.includes('(internal/') ||
    line.includes('internal/process') ||
    line.includes('internal/modules') ||
    line.includes('async_hooks.js')
  );
}

function isTracerFrame(line: string): boolean {
  // Skip anything from our tracer (dist/src) and the capture helper itself
  // Examples:
  //   at captureLocation (C:/.../tracer/dist/hook.js:53:17)
  //   at C:/.../tracer/src/hook.ts:123:45
  const norm = line.replace(/\\/g, '/');
  return (
    norm.includes('/tracer/dist/') ||
    norm.includes('/tracer/src/') ||
    norm.includes('/hook.js') ||
    norm.includes('/hook.ts') ||
    norm.includes('captureLocation')
  );
}

// Extract "file:line:col" from a stack line
// Handles:
//   "    at fn (C:\path\file.js:12:34)"
//   "    at /path/file.js:12:34"
function extractFileLoc(line: string): string | undefined {
  // windows drive or POSIX abs path, until :line:col
  const m = line.match(/\(?([A-Za-z]:[\\/].+?:\d+:\d+|\/.+?:\d+:\d+)\)?\s*$/);
  const loc = m?.[1];
  return loc ? loc.replace(/\\/g, '/') : undefined;
}

function classifyOrigin(loc?: string, fullLine?: string): Origin {
  if (!loc && !fullLine) return 'user';
  if (loc && loc.includes('/node_modules/')) return 'library';
  // Crude IO hint from frame text (fs/http/etc.)
  if (fullLine && /\b(fs|http|https|net|dns|dgram)\b/.test(fullLine)) return 'io';
  if (loc && loc.startsWith(CWD)) return 'user';
  return 'library';
}

/**
 * Pick the first non-internal, non-tracer frame.
 * Prefer frames under CWD (user code) when available.
 */
function captureLocation(includeStack = CAPTURE_STACKS): {
  location?: string;
  stack?: string;
  origin?: Origin;
} {
  const err = new Error();
  const raw = err.stack ?? '';
  const lines = raw.split('\n').slice(1); // drop "Error"

  let chosenLoc: string | undefined;
  let chosenOrigin: Origin | undefined;

  for (const line of lines) {
    if (isInternalFrame(line) || isTracerFrame(line)) continue;
    const loc = extractFileLoc(line);
    if (!loc) continue;

    // First acceptable frame
    if (!chosenLoc) {
      chosenLoc = loc;
      chosenOrigin = classifyOrigin(loc, line);
    }
    // Prefer a frame inside the current working directory (user code)
    if (loc.startsWith(CWD)) {
      chosenLoc = loc;
      chosenOrigin = classifyOrigin(loc, line);
      break;
    }
  }

  return {
    location: chosenLoc,
    origin: chosenOrigin,
    stack: includeStack ? raw : undefined
  };
}

/* ==============================
   Async hooks
   ============================== */

const hook = asyncHooks.createHook({
  init(asyncId, type, triggerAsyncId) {
    if (type !== 'PROMISE') return;

    const meta = captureLocation();

    events.set(asyncId, {
      id: asyncId,
      triggerId: triggerAsyncId,
      type,
      start: nowRel(),
      location: meta.location,
      origin: meta.origin,
      stack: meta.stack
    });
  },

  // before(asyncId) {},   // could be used to track resume points
  // after(asyncId) {},    // could be used to track suspension duration

  promiseResolve(asyncId) {
    const evt = events.get(asyncId);
    if (evt && evt.end === undefined) {
      evt.end = nowRel();
    }
  },

  destroy(asyncId) {
    // If GC/cleanup occurs before resolve hook fires, close the event
    const evt = events.get(asyncId);
    if (evt && evt.end === undefined) {
      evt.end = nowRel();
    }
  }
});

hook.enable();

/* ==============================
   Flush trace on exit
   ============================== */

function safeWriteFileSync(file: string, data: string) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    // ignore mkdir errors (race)
  }
  fs.writeFileSync(file, data, 'utf8');
}

function flush() {
  try {
    const arr = Array.from(events.values());
    // sort by start time for nicer charts
    arr.sort((a, b) => a.start - b.start);
    safeWriteFileSync(OUT_PATH, JSON.stringify(arr, null, 2));
    // eslint-disable-next-line no-console
    console.error(`Async Doctor tracer: wrote ${arr.length} events to ${OUT_PATH}`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Async Doctor tracer: failed to write trace:', e);
  }
}

// Write in as many exit scenarios as possible
process.on('beforeExit', flush);
process.on('exit', flush);
process.on('SIGINT', () => { flush(); process.exit(130); });
process.on('SIGTERM', () => { flush(); process.exit(143); });

// This module is meant to be preloaded via NODE_OPTIONS / --require
export {};
