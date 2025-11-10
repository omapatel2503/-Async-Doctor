import express from 'express';
import cors from 'cors';
import multer from 'multer';
import extract from 'extract-zip';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Ollama } from 'ollama';
import { runAnalysis } from './analyzer';
import dotenv from 'dotenv';

const execAsync = promisify(exec);

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// ---------- Base path (for GKE Ingress path /api) ----------
const API_BASE = (process.env.API_BASE || '/api').replace(/\/$/, '') || '';
const api = express.Router();

// ---------- Paths ----------
const JOB_ROOT = path.join(process.cwd(), 'jobs');
fs.mkdirSync(JOB_ROOT, { recursive: true });
fs.mkdirSync(path.join(JOB_ROOT, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(JOB_ROOT, 'repos'), { recursive: true });


// ---------- Multer (ZIP uploads) ----------
const uploadZip = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(JOB_ROOT, 'uploads')),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
      cb(null, `${Date.now()}_${safe}`);
    }
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    (/\.zip$/i.test(file.originalname) ? cb(null, true) : cb(new Error('Only .zip files are accepted')))
});

// ---------- Multer (trace.json upload) ----------
const uploadTrace = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const jobDir = path.join(JOB_ROOT, req.params.jobId);
      fs.mkdirSync(jobDir, { recursive: true });
      cb(null, jobDir);
    },
    filename: (_req, file, cb) =>
      cb(null, file.originalname.toLowerCase().endsWith('.json') ? file.originalname : 'trace.json')
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    (/\.json$/i.test(file.originalname) ? cb(null, true) : cb(new Error('Only .json trace files are accepted')))
});

// ---------- Ollama (Cloud or Local) ----------
const ollama = new Ollama({
  host: process.env.OLLAMA_HOST || 'https://ollama.com',
  headers: process.env.OLLAMA_API_KEY
    ? { Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY }
    : undefined
});
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gpt-oss:20b-cloud';

// ---- AI helper ----
async function askOllamaForFix(input: {
  rule: string;
  message: string;
  file: string;
  funcSnippet: string;
  languageHint?: 'ts' | 'js';
}): Promise<{ fixed_function: string; explanation?: string }> {
  const system = `You are a senior ${input.languageHint === 'ts' ? 'TypeScript' : 'JavaScript'} engineer.
Return ONLY strict JSON with fields: "fixed_function" (the entire corrected function) and "explanation" (1–2 lines). No markdown.`;

  const user = `
Anti-pattern rule: ${input.rule}
Message: ${input.message}
File: ${input.file}

Fix the function below to remove the anti-pattern. Keep names and behavior.

Return JSON exactly like:
{"fixed_function":"<FUNCTION HERE>", "explanation":"<1-2 lines>"}

<<<FUNCTION_START
${input.funcSnippet}
FUNCTION_END>>>
`.trim();

  const response = await ollama.chat({
    model: OLLAMA_MODEL,
    stream: true,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  });

  let raw = '';
  for await (const part of response) {
    if (part?.message?.content) raw += part.message.content;
  }

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Model did not return JSON.');
  const parsed = JSON.parse(match[0]);
  if (!parsed.fixed_function || typeof parsed.fixed_function !== 'string') {
    throw new Error('JSON missing "fixed_function".');
  }
  return parsed;
}

// ---- File helpers ----
function readJSON<T = any>(p: string): T {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeJSON(p: string, val: any) {
  fs.writeFileSync(p, JSON.stringify(val, null, 2), 'utf8');
}

// ---- Trace ↔ findings cross-ref ----
type TraceEvent = {
  id: number;
  triggerId?: number;
  type?: string;
  start?: number;
  end?: number;
  location?: string; // "path:line:col" or "path:line"
  origin?: 'user' | 'lib' | string;
};

function parseLocation(loc: string) {
  const m = loc && loc.match(/^(.*):(\d+)(?::\d+)?$/);
  if (!m) return null;
  return { abs: m[1], line: Number(m[2]) || 0 };
}

function crossReference(
  root: string,
  report: any,
  events: TraceEvent[]
) {
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const fnRanges = findings.map((f: any) => {
    const fnLen = String(f.funcSnippet || '').split(/\r?\n/).length || 1;
    return { id: f.id, file: f.file, start: f.funcStart, end: f.funcStart + fnLen - 1, rule: f.rule };
  });

  const execCounts: Record<number, number> = {};
  const byRuleExecuted: Record<string, number> = {};
  let userEvents = 0, libEvents = 0;

  for (const ev of events) {
    const loc = ev.location && parseLocation(ev.location);
    if (!loc) continue;
    const rel = path.relative(root, loc.abs).replace(/\\/g, '/');

    for (const r of fnRanges) {
      if (r.file === rel && loc.line >= r.start && loc.line <= r.end) {
        execCounts[r.id] = (execCounts[r.id] || 0) + 1;
        byRuleExecuted[r.rule] = (byRuleExecuted[r.rule] || 0) + 1;
      }
    }

    if (ev.origin === 'user') userEvents++;
    else libEvents++;
  }

  const executedFindingCount = Object.keys(execCounts).length;
  return {
    execCounts,
    summary: {
      totalTraceEvents: events.length,
      userEvents,
      libEvents,
      executedFindingCount,
      byRuleExecuted
    }
  };
}

function mergeReportWithExec(
  staticReport: any,
  overlay: { execCounts: Record<number, number>; summary: any }
) {
  return {
    ...staticReport,
    findings: staticReport.findings.map((f: any) => ({
      ...f,
      execCount: overlay.execCounts[f.id] || 0
    })),
    dynamic: overlay.summary
  };
}

function getJobRoot(jobId: string) {
  const jobDir = path.join(JOB_ROOT, jobId);
  const repoDir = path.join(jobDir, 'repo');
  const projDir = path.join(jobDir, 'project');
  const root = fs.existsSync(repoDir) ? repoDir : projDir;
  return { jobDir, root };
}

// ---------- Health ----------
api.get('/health', (_req, res) => res.json({ ok: true }));

// ---------- Analyze GitHub repo ----------
api.post('/analyze-github', async (req, res) => {
  const { repoUrl, branch } = req.body;

  if (!repoUrl || typeof repoUrl !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "repoUrl" field.' });
  }

  const githubUrlRegex = /^https?:\/\/(www\.)?github\.com\/[\w-]+\/[\w.-]+\/?$/;
  if (!githubUrlRegex.test(String(repoUrl).replace(/\.git$/, ''))) {
    return res.status(400).json({ error: 'Invalid GitHub repository URL.' });
  }

  const jobId = crypto.randomUUID();
  const { jobDir } = getJobRoot(jobId);
  const repoDir = path.join(jobDir, 'repo');
  const reportPath = path.join(jobDir, 'anti-patterns.json');

  try {
    fs.mkdirSync(repoDir, { recursive: true });

    const cloneCmd = branch
      ? `git clone --depth 1 --branch ${branch} "${repoUrl}" "${repoDir}"`
      : `git clone --depth 1 "${repoUrl}" "${repoDir}"`;

    await execAsync(cloneCmd, {
      timeout: 300000,
      maxBuffer: 50 * 1024 * 1024
    });

    const result = runAnalysis(repoDir);
    writeJSON(reportPath, result);

    res.json({
      jobId,
      reportUrl: `${API_BASE}/jobs/${jobId}/report`,
      repoUrl,
      branch: branch || 'default',
      ...result
    });
  } catch (e: any) {
    console.error('GitHub analysis error:', e);
    try { if (fs.existsSync(jobDir)) fs.rmSync(jobDir, { recursive: true, force: true }); } catch {}
    let errorMessage = e?.message || 'GitHub analysis failed';
    if (errorMessage.includes('Repository not found')) errorMessage = 'Repository not found. Please check the URL and ensure it is public.';
    else if (errorMessage.includes('Could not resolve host')) errorMessage = 'Network error. Please check your internet connection.';
    else if (errorMessage.includes('timeout')) errorMessage = 'Repository clone timeout. The repository might be too large.';
    res.status(500).json({ error: errorMessage });
  }
});

// ---------- Analyze ZIP upload ----------
api.post('/analyze', uploadZip.single('project'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Missing file. Use field "project".' });

  const jobId = crypto.randomUUID();
  const { jobDir } = getJobRoot(jobId);
  const extractDir = path.join(jobDir, 'project');
  const reportPath = path.join(jobDir, 'anti-patterns.json');

  fs.mkdirSync(extractDir, { recursive: true });

  try {
    await extract(req.file.path, { dir: extractDir });
    const result = runAnalysis(extractDir);
    fs.mkdirSync(jobDir, { recursive: true });
    writeJSON(reportPath, result);

    res.json({
      jobId,
      reportUrl: `${API_BASE}/jobs/${jobId}/report`,
      ...result
    });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e?.message || 'Analyze failed' });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch {}
  }
});

// ---------- Upload tracer output & merge ----------
api.post('/jobs/:jobId/trace', uploadTrace.single('trace'), async (req, res) => {
  try {
    const { jobId } = req.params;
    const { jobDir, root } = getJobRoot(jobId);
    const reportPath = path.join(jobDir, 'anti-patterns.json');
    if (!fs.existsSync(reportPath)) {
      return res.status(404).json({ error: 'No static analysis found for this job. Run analysis first.' });
    }

    const staticReport = readJSON(reportPath);

    if (!req.file) return res.status(400).json({ error: 'Missing file "trace".' });
    const traceRaw = readJSON<any>(req.file.path);
    const events: TraceEvent[] = Array.isArray(traceRaw) ? traceRaw
                          : Array.isArray(traceRaw?.events) ? traceRaw.events
                          : [];

    const overlay = crossReference(root, staticReport, events);
    const execPath = path.join(jobDir, 'executions.json');
    writeJSON(execPath, overlay);

    const merged = mergeReportWithExec(staticReport, overlay);
    return res.json({
      jobId,
      reportUrl: `${API_BASE}/jobs/${jobId}/report`,
      ...merged
    });
  } catch (e: any) {
    console.error('Trace upload error:', e);
    res.status(500).json({ error: e?.message || 'Trace upload failed' });
  }
});

// ---------- AI Fix (preview/apply) ----------
function replaceFunctionInFile(absFile: string, funcStart: number, currentFunc: string, newFunc: string) {
  const content = fs.readFileSync(absFile, 'utf8');
  const lines = content.split(/\r?\n/);

  const currLen = currentFunc.split(/\r?\n/).length;
  const startIdx = Math.max(0, funcStart - 1);
  const endIdx = startIdx + currLen; // exclusive
  const next = [...lines.slice(0, startIdx), ...newFunc.split(/\r?\n/), ...lines.slice(endIdx)].join('\n');

  try { fs.writeFileSync(absFile + '.bak', content, 'utf8'); } catch {}
  fs.writeFileSync(absFile, next, 'utf8');
}

api.post('/jobs/:jobId/ai/fix', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { file, line, rule, message, funcSnippet, funcStart, apply } = req.body || {};
    if (!file || !funcSnippet || !funcStart || !rule) {
      return res.status(400).json({ error: 'Missing required fields (file, funcSnippet, funcStart, rule).' });
    }

    const { jobDir, root } = getJobRoot(jobId);
    if (!fs.existsSync(root)) return res.status(404).json({ error: 'Job project not found.' });

    const absFile = path.join(root, file);
    if (!fs.existsSync(absFile)) return res.status(404).json({ error: 'Target file not found.' });

    const languageHint = /\.(ts|tsx)$/i.test(file) ? 'ts' : 'js';
    const ai = await askOllamaForFix({ rule, message, file, funcSnippet, languageHint });

    if (!apply) {
      return res.json({
        applied: false,
        fixedFunction: ai.fixed_function,
        explanation: ai.explanation || ''
      });
    }

    replaceFunctionInFile(absFile, Number(funcStart), String(funcSnippet), String(ai.fixed_function));

    const result = runAnalysis(root);
    writeJSON(path.join(jobDir, 'anti-patterns.json'), result);

    const execPath = path.join(jobDir, 'executions.json');
    const merged = fs.existsSync(execPath)
      ? mergeReportWithExec(result, readJSON(execPath))
      : result;

    return res.json({
      applied: true,
      fixedFunction: ai.fixed_function,
      explanation: ai.explanation || '',
      report: { jobId, reportUrl: `${API_BASE}/jobs/${jobId}/report`, ...merged }
    });

  } catch (e:any) {
    console.error('AI fix error:', e);
    res.status(500).json({
      error: e?.message || 'AI fix failed',
      hint: e?.status_code === 401 ? 'Ollama returned 401. Check OLLAMA_HOST and OLLAMA_API_KEY.' : undefined
    });
  }
});

// ---------- Jobs ----------
api.get('/jobs/:jobId/report', (req, res) => {
  const jobDir = path.join(JOB_ROOT, req.params.jobId);
  const staticPath = path.join(jobDir, 'anti-patterns.json');
  if (!fs.existsSync(staticPath)) return res.status(404).json({ error: 'Report not found' });

  const staticReport = readJSON(staticPath);
  const execPath = path.join(jobDir, 'executions.json');

  if (fs.existsSync(execPath)) {
    const overlay = readJSON(execPath);
    return res.json(mergeReportWithExec(staticReport, overlay));
  }

  res.json(staticReport);
});

api.delete('/jobs/:jobId', (req, res) => {
  const jobDir = path.join(JOB_ROOT, req.params.jobId);
  if (!fs.existsSync(jobDir)) return res.status(404).json({ error: 'Job not found' });
  try {
    fs.rmSync(jobDir, { recursive: true, force: true });
    res.json({ success: true, message: 'Job deleted successfully' });
  } catch {
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

// mount router + static under API base
app.use(API_BASE, api);
app.use(`${API_BASE}/jobs`, express.static(JOB_ROOT));

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(PORT, '0.0.0.0', () =>
  console.log(`Async Doctor server: http://localhost:${PORT}${API_BASE}`)
);
