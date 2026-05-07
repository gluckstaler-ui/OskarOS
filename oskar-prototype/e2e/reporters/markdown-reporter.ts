/**
 * Markdown reporter for Playwright e2e runs.
 *
 * Source: external/open-design/e2e/reporters/markdown-reporter.ts
 * Adapted 2026-05-02 (FEATURE-X §1.4 WP-3.2, Phase 3 Commit B testing infra).
 *
 * Adaptation
 * ----------
 * - English-language headings (OD's report is bilingual ZH/EN; OskarOS is
 *   English-only).
 * - `report-metadata.ts` dependency replaced by the `caseIndex` from
 *   `e2e/cases/index.ts` — each row's category / description / notes come
 *   from the registry rather than a parallel metadata file.
 * - Per CD's WP-3.2 directive ("report format must be stable across runs;
 *   diffs against INSTITUTIONAL-MEMORY.md must stay pasteable"): timestamps
 *   live in a single footer line, NOT in row data; rows are sorted
 *   alphabetically by caseId; durations rounded to a stable cell shape.
 * - Test title convention: `<caseId>: <title>` — same as OD. The reporter
 *   parses this back out so caseId-based registry lookup works.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  FullConfig,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { caseIndex } from '../cases';
import type { UICase } from '../cases/types';

interface MarkdownReporterOptions {
  /** Output path relative to cwd. Default: ./e2e/reports/latest.md */
  outputFile?: string;
  /** Include timestamps in the report. Set false for diff-stable output. */
  includeTimestamps?: boolean;
}

interface CaseRow {
  caseId: string;
  title: string;
  category: string;
  registered: boolean;
  notes: string[];
  status: string;
  durationMs: number;
  retries: number;
  file: string;
  line: number | null;
  attachments: Array<{ name: string; contentType: string; path: string }>;
  error: string | null;
}

interface Summary {
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  timedOut: number;
  interrupted: number;
  durationMs: number;
}

interface MarkdownInput {
  startedAt: Date;
  finishedAt: Date;
  summary: Summary;
  rows: CaseRow[];
  outputFile: string;
  includeTimestamps: boolean;
}

class MarkdownReporter implements Reporter {
  private rootSuite: Suite | null = null;
  private startedAt: Date | null = null;
  private readonly options: MarkdownReporterOptions;

  constructor(options: MarkdownReporterOptions = {}) {
    this.options = options;
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    this.rootSuite = suite;
    this.startedAt = new Date();
  }

  async onEnd(): Promise<void> {
    if (!this.rootSuite) return;

    const rows: CaseRow[] = [];
    visitSuite(this.rootSuite, rows);
    rows.sort((a, b) => a.caseId.localeCompare(b.caseId));

    const summary = summarize(rows);
    const startedAt = this.startedAt ?? new Date();
    const finishedAt = new Date();
    const outputFile = this.options.outputFile || './e2e/reports/latest.md';
    const includeTimestamps = this.options.includeTimestamps ?? true;
    const resolvedOutput = path.resolve(process.cwd(), outputFile);

    fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
    fs.writeFileSync(
      resolvedOutput,
      buildMarkdown({
        startedAt,
        finishedAt,
        summary,
        rows,
        outputFile,
        includeTimestamps,
      }),
      'utf8',
    );
  }
}

function visitSuite(suite: Suite, rows: CaseRow[]): void {
  for (const child of suite.suites || []) {
    visitSuite(child, rows);
  }
  for (const test of suite.tests || []) {
    const finalResult = test.results[test.results.length - 1];
    if (!finalResult) continue;
    rows.push(buildCaseRow(test, finalResult));
  }
}

function buildCaseRow(test: TestCase, finalResult: TestResult): CaseRow {
  const parsed = parseCaseTitle(test.title);
  const registered: UICase | undefined = caseIndex.byId(parsed.caseId);
  return {
    caseId: parsed.caseId,
    title: parsed.title,
    category: registered?.category ?? 'unregistered',
    registered: !!registered,
    notes: registered?.notes ?? [],
    status: normalizeStatus(finalResult.status, test.outcome?.()),
    durationMs: finalResult.duration ?? 0,
    retries: Math.max(0, test.results.length - 1),
    file: test.location?.file ?? '',
    line: test.location?.line ?? null,
    attachments: (finalResult.attachments || [])
      .map((entry) => ({
        name: entry.name || '',
        contentType: entry.contentType || '',
        path: entry.path ? toRelative(entry.path) : '',
      }))
      .filter((entry) => entry.path.length > 0),
    error: compactError(finalResult.error),
  };
}

function parseCaseTitle(title: string): { caseId: string; title: string } {
  const idx = title.indexOf(': ');
  if (idx === -1) {
    return { caseId: title, title };
  }
  return {
    caseId: title.slice(0, idx).trim(),
    title: title.slice(idx + 2).trim(),
  };
}

function normalizeStatus(
  status: string | undefined,
  outcome: string | undefined,
): string {
  if (outcome === 'flaky') return 'flaky';
  return status || 'unknown';
}

function compactError(error: TestResult['error']): string | null {
  if (!error) return null;
  const raw = [error.message, error.value, error.stack]
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!raw) return null;
  return raw.split('\n').slice(0, 8).join('\n');
}

function summarize(rows: CaseRow[]): Summary {
  const summary = {
    total: rows.length,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    timedOut: 0,
    interrupted: 0,
    durationMs: rows.reduce((sum, row) => sum + row.durationMs, 0),
  };

  for (const row of rows) {
    if (row.status === 'passed') summary.passed += 1;
    else if (row.status === 'failed') summary.failed += 1;
    else if (row.status === 'flaky') summary.flaky += 1;
    else if (row.status === 'skipped') summary.skipped += 1;
    else if (row.status === 'timedOut') summary.timedOut += 1;
    else if (row.status === 'interrupted') summary.interrupted += 1;
  }

  return summary;
}

function buildMarkdown({
  startedAt,
  finishedAt,
  summary,
  rows,
  outputFile,
  includeTimestamps,
}: MarkdownInput): string {
  const lines: string[] = [];
  const verdict =
    summary.failed === 0 && summary.timedOut === 0 ? 'PASSED' : 'FAILED';

  lines.push('# OskarOS UI test report');
  lines.push('');
  lines.push(`Verdict: **${verdict}**`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total cases: ${summary.total}`);
  lines.push(`- Passed: ${summary.passed}`);
  lines.push(`- Failed: ${summary.failed}`);
  lines.push(`- Flaky: ${summary.flaky}`);
  lines.push(`- Skipped: ${summary.skipped}`);
  lines.push(`- Timed out: ${summary.timedOut}`);
  lines.push(`- Interrupted: ${summary.interrupted}`);
  lines.push(`- Total duration: ${formatDuration(summary.durationMs)}`);
  lines.push('');

  lines.push('## Case results');
  lines.push('');
  lines.push('| Case ID | Category | Title | Status | Duration | Retries |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    lines.push(
      `| \`${escapeCell(row.caseId)}\` | ${escapeCell(row.category)} | ${escapeCell(row.title)} | ${statusLabel(row.status)} | ${formatDuration(row.durationMs)} | ${row.retries} |`,
    );
  }
  lines.push('');

  lines.push('## Case context');
  lines.push('');
  for (const row of rows) {
    lines.push(`### ${row.caseId}`);
    lines.push('');
    lines.push(`- Category: ${row.category}`);
    lines.push(`- Title: ${row.title}`);
    lines.push(`- Status: ${statusLabel(row.status)}`);
    lines.push(`- Registered in caseIndex: ${row.registered ? 'yes' : 'no'}`);
    if (row.notes.length > 0) {
      lines.push('- Notes:');
      for (const note of row.notes) {
        lines.push(`  - ${note}`);
      }
    }
    lines.push('');
  }

  const problematic = rows.filter((row) => row.status !== 'passed');
  if (problematic.length > 0) {
    lines.push('## Failures');
    lines.push('');
    for (const row of problematic) {
      lines.push(`### ${row.caseId}`);
      lines.push('');
      lines.push(`- Title: ${row.title}`);
      lines.push(`- Status: ${statusLabel(row.status)}`);
      lines.push(
        `- Location: \`${toRelative(row.file)}${row.line ? `:${row.line}` : ''}\``,
      );
      if (row.error) {
        lines.push('- Error:');
        lines.push('```text');
        lines.push(row.error);
        lines.push('```');
      }
      if (row.attachments.length > 0) {
        lines.push('- Attachments:');
        for (const attachment of row.attachments) {
          lines.push(
            `  - \`${attachment.name}\` · \`${attachment.path}\``,
          );
        }
      }
      lines.push('');
    }
  }

  lines.push('## Artifacts');
  lines.push('');
  lines.push(
    '- HTML report: `e2e/reports/playwright-html-report/index.html`',
  );
  lines.push('- JSON results: `e2e/reports/results.json`');
  lines.push('- JUnit results: `e2e/reports/junit.xml`');
  lines.push('- Playwright attachments: `e2e/reports/test-results/`');
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push(
    '- This report contains only the UI automation cases that actually executed.',
  );
  lines.push(
    '- See `e2e/cases/index.ts` for the full registered flow set.',
  );
  lines.push(
    '- Failed cases: prioritize HTML report and attachments paths above.',
  );

  // Timestamps live in a single footer block so the primary content stays
  // diff-stable across runs (per CD's WP-3.2 directive).
  if (includeTimestamps) {
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(`Started: ${startedAt.toISOString()}`);
    lines.push(`Finished: ${finishedAt.toISOString()}`);
    lines.push(`Output: \`${outputFile}\``);
  }

  lines.push('');
  return lines.join('\n');
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusLabel(status: string): string {
  return status;
}

function toRelative(filePath: string): string {
  if (!filePath) return '';
  return path.relative(process.cwd(), filePath) || filePath;
}

function escapeCell(value: string): string {
  return String(value).replace(/\|/g, '\\|');
}

export default MarkdownReporter;
