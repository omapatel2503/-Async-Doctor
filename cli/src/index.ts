import fs from 'fs';
import path from 'path';
import { Linter, Rule } from 'eslint';
import { Command } from 'commander';

// Import custom rule definitions
import awaitInLoopRule from './rules/awaitInLoop';
import asyncAwaitedReturnRule from './rules/asyncFunctionAwaitedReturn';
import promiseResolveThenRule from './rules/promiseResolveThen';
import executorOneArgUsedRule from './rules/executorOneArgUsed';
import customPromisificationRule from './rules/customPromisification';

// NEW: remaining 3 rules
import reactionReturnsPromiseRule from './rules/reactionReturnsPromise';
import asyncExecutorInPromiseRule from './rules/asyncExecutorInPromise';
import redundantNewPromiseWrapperRule from './rules/redundantNewPromiseWrapper';

// Configure CLI using commander
const program = new Command();
program
  .name('async-doctor')
  .description('Detect and refactor async/await anti-patterns')
  .option('--json', 'Output results in JSON format');

program
  .command('fix')
  .description('Apply suggested refactor for a given issue ID (if tests pass)')
  .requiredOption('--id <id>', 'ID of the issue to fix')
  .action(async (options) => {
    const issueId = Number(options.id);
    const results = runAnalysis(process.cwd());  // re-run analysis in current project
    const issue = results.find(res => res.id === issueId);
    if (!issue) {
      console.error(`Issue ID ${issueId} not found.`);
      process.exit(1);
    }
    if (!issue.fixable) {
      console.log(`Issue ${issueId} ("${issue.pattern}") is not auto-fixable.`);
      process.exit(0);
    }
    // Apply fix (currently only removes unnecessary 'await' in return)
    const filePath = issue.file;
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const lines = fileContent.split(/\r?\n/);
    const lineIndex = issue.line - 1;
    let lineText = lines[lineIndex];
    const colIndex = issue.column - 1;
    // Remove 'await' keyword and a following space if present
    if (lineText.slice(colIndex, colIndex + 5) === 'await') {
      const after = lineText.charAt(colIndex + 5);
      const removeCount = (after === ' ') ? 6 : 5;
      lineText = lineText.slice(0, colIndex) + lineText.slice(colIndex + removeCount);
      lines[lineIndex] = lineText;
      fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
      // Run tests to verify no failures
      console.log(`Applied fix for issue ${issueId}. Running tests...`);
      try {
        // Spawn npm test synchronously
        const res = require('child_process').spawnSync('npm', ['test'], { stdio: 'inherit' });
        if (res.status !== 0) {
          // Tests failed: revert the change
          fs.writeFileSync(filePath, fileContent, 'utf-8');
          console.error(`Fix reverted: tests failed for issue ${issueId}.`);
          process.exit(1);
        } else {
          console.log(`Fix applied successfully for issue ${issueId} (tests passed).`);
        }
      } catch (err) {
        fs.writeFileSync(filePath, fileContent, 'utf-8');
        console.error('Error running tests:', err);
        process.exit(1);
      }
    } else {
      console.error('Failed to apply fix: "await" not found at expected location.');
    }
  });

program
  .argument('[targetDir]', 'Target project directory (defaults to current directory)')
  .action((targetDir) => {
    const target = targetDir || process.cwd();
    const results = runAnalysis(target);
    if (program.opts().json) {
  // --- new behavior: write anti-patterns.json file into target directory ---
  const outputPath = path.join(target, 'anti-patterns.json');
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8');
    console.log(`✅ Anti-patterns saved to: ${outputPath}`);
  } catch (err) {
    console.error('❌ Failed to write anti-patterns.json:', err);
    process.exit(1);
  }
} else {
  // Human-readable table output
  console.log(`Found ${results.length} async anti-pattern instance(s):`);
  console.log(`ID  File:Line        Pattern                           Description`);
  console.log(`--  ---------------  ---------------------------------  ------------------------------`);
  results.forEach(res => {
    const idStr = res.id.toString().padStart(2, ' ');
    const location = `${path.relative(target, res.file)}:${res.line}`;
    const locCol = location.padEnd(15, ' ');
    const patternCol = res.pattern.padEnd(33, ' ');
    console.log(`${idStr}  ${locCol}  ${patternCol}  ${res.message}`);
  });
}
  });

program.parse(process.argv);

/**
 * Run static analysis on the target directory, returning a list of findings.
 */
function runAnalysis(targetDir: string) {
  const linter = new Linter();

  // Register custom rules
  linter.defineRule('await-in-loop', awaitInLoopRule as unknown as Rule.RuleModule);
  linter.defineRule('async-function-awaited-return', asyncAwaitedReturnRule as unknown as Rule.RuleModule);
  linter.defineRule('promise-resolve-then', promiseResolveThenRule as unknown as Rule.RuleModule);
  linter.defineRule('executor-one-arg-used', executorOneArgUsedRule as unknown as Rule.RuleModule);
  linter.defineRule('custom-promisification', customPromisificationRule as unknown as Rule.RuleModule);

  // NEW: register remaining 3
  linter.defineRule('reaction-returns-promise', reactionReturnsPromiseRule as unknown as Rule.RuleModule);
  linter.defineRule('async-executor-in-promise', asyncExecutorInPromiseRule as unknown as Rule.RuleModule);
  linter.defineRule('redundant-new-promise-wrapper', redundantNewPromiseWrapperRule as unknown as Rule.RuleModule);

  // Register TypeScript parser
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const tsParser = require('@typescript-eslint/parser');
  linter.defineParser('ts-parser', tsParser);

  // Configuration for ESLint verification
  const config: Linter.LegacyConfig = {
    parser: 'ts-parser',
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      ecmaFeatures: { jsx: true }
    },
    rules: {
      'await-in-loop': 'error',
      'async-function-awaited-return': 'error',
      'promise-resolve-then': 'error',
      'executor-one-arg-used': 'error',
      'custom-promisification': 'error',

      // NEW: enable remaining 3
      'reaction-returns-promise': 'error',
      'async-executor-in-promise': 'error',
      'redundant-new-promise-wrapper': 'error'
    }
  };

  // Recursively gather target files (JS/TS)
  const files: string[] = [];
  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(entry.name)) {
          files.push(fullPath);
        }
      }
    }
  }
  walk(targetDir);

  const results: Array<{
    id: number, file: string, line: number, column: number, pattern: string,
    message: string, fixable: boolean
  }> = [];
  files.forEach(filePath => {
    const code = fs.readFileSync(filePath, 'utf-8');
    const messages = linter.verify(code, config, { filename: filePath });
    for (const m of messages) {
      results.push({
        id: 0,  // temporary, will assign after sorting
        file: filePath,
        line: m.line,
        column: m.column,
        pattern: m.ruleId || '',
        message: m.message,
        // NOTE: Linter.verify messages typically don't include `.fix`; fixable=true means our rule declared fixable,
        // but actual application needs verifyAndFix. We keep this boolean as a hint for the CLI.
        fixable: Boolean((m as any).fix)
      });
    }
  });

  // Sort results by file and line for stable IDs
  results.sort((a, b) => {
    if (a.file < b.file) return -1;
    if (a.file > b.file) return 1;
    if (a.line < b.line) return -1;
    if (a.line > b.line) return 1;
    return a.column - b.column;
  });
  results.forEach((res, idx) => { res.id = idx + 1; });
  return results;
}
