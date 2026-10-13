import { Writable } from 'node:stream';
import { once } from 'node:events';
import { query, queryOne } from '../db.js';
import { metricsService } from './metricsService.js';
import { NotFoundError } from '../errors.js';
import { ScanMetrics, StorageFile } from '../types.js';
import { formatBytes, formatDuration, formatClockTime } from '../utils/formatters.js';

/**
 * Exportable reports for a source: a self-contained HTML summary (printable to PDF)
 * and a CSV with one row per file.
 */

interface FolderStats {
  folder: string;
  files: number;
  size: number;
  videos: number;
  measuredVideos: number;
  playTime: number;
}

/** Totals per top-level folder, busiest by video play time first. */
async function folderBreakdown(sourceId: string): Promise<FolderStats[]> {
  // camelCase aliases are quoted: Postgres lowercases unquoted names
  return query<FolderStats>(
    `SELECT
       CASE WHEN strpos(key, '/') > 0 THEN substr(key, 1, strpos(key, '/') - 1) ELSE '(top level)' END AS folder,
       COUNT(*) AS files,
       COALESCE(SUM(size), 0) AS size,
       SUM(CASE WHEN category = 'video' THEN 1 ELSE 0 END) AS videos,
       SUM(CASE WHEN category = 'video' AND duration > 0 THEN 1 ELSE 0 END) AS "measuredVideos",
       COALESCE(SUM(CASE WHEN category = 'video' AND duration > 0 THEN duration ELSE 0 END), 0) AS "playTime"
     FROM files
     WHERE source_id = ?
     GROUP BY folder
     ORDER BY "playTime" DESC, size DESC`,
    [sourceId]
  );
}

async function measuredVideoCount(sourceId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM files WHERE source_id = ? AND category = 'video' AND duration > 0",
    [sourceId]
  );
  return row?.n ?? 0;
}

const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const fmtDate = (ms?: number): string => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');
const pct = (part: number, whole: number): string => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—');
const resolution = (f: StorageFile): string => (f.width && f.height ? `${f.width}×${f.height}` : '—');

/** A table from a header row and body rows; cells are escaped, numeric columns right-aligned. */
function table(headers: string[], rows: Array<Array<string | number>>, numericFrom = 1): string {
  if (rows.length === 0) return '<p class="empty">No data.</p>';
  const cell = (tag: string, value: string | number, i: number) =>
    `<${tag}${i >= numericFrom ? ' class="num"' : ''}>${escapeHtml(value)}</${tag}>`;
  return `<table><thead><tr>${headers.map((h, i) => cell('th', h, i)).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((v, i) => cell('td', v, i)).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

export async function buildHtmlReport(sourceId: string): Promise<{ filename: string; html: string }> {
  const m: ScanMetrics | null = await metricsService.computeMetrics(sourceId);
  if (!m) throw new NotFoundError('Source not found');
  const source = await queryOne<{ last_scanned_at?: number }>('SELECT last_scanned_at FROM sources WHERE id = ?', [sourceId]);
  const folders = await folderBreakdown(sourceId);
  const measured = await measuredVideoCount(sourceId);
  const generatedAt = Date.now();
  const v = m.video;

  const kpis: Array<[string, string, string?]> = [
    ['Total files', m.totalFiles.toLocaleString('en-US')],
    ['Total size', formatBytes(m.totalSize)],
    ['Videos', v.videoCount.toLocaleString('en-US'), formatBytes(v.totalVideoSize)],
    ['Total video play time', formatDuration(v.totalVideoDuration), `${(v.totalVideoDuration / 3600).toFixed(1)} hours`],
    ['Average video length', formatClockTime(v.avgVideoDuration)],
    ['Synced to this server', `${m.onPremSync.syncPercentage}%`, `${m.onPremSync.syncedFilesCount.toLocaleString('en-US')} files`],
  ];

  const coverageNote =
    v.videoCount > measured
      ? `<p class="note">Play time covers <b>${measured.toLocaleString('en-US')} of ${v.videoCount.toLocaleString('en-US')}</b> videos (${pct(measured, v.videoCount)}). The rest have no measured length yet: run a Deep scan to include them.</p>`
      : '';

  const sections = [
    `<h2>Video play time by folder</h2>
     ${table(
       ['Folder', 'Files', 'Size', 'Videos', 'Measured', 'Play time', 'Hours'],
       folders.map((f) => [
         f.folder,
         f.files.toLocaleString('en-US'),
         formatBytes(f.size),
         f.videos.toLocaleString('en-US'),
         f.videos ? pct(f.measuredVideos, f.videos) : '—',
         formatDuration(f.playTime),
         (f.playTime / 3600).toFixed(1),
       ])
     )}`,
    `<div class="grid">
      <div><h2>Video resolution</h2>${table(['Resolution', 'Videos'], Object.entries(v.resolutionBuckets))}</div>
      <div><h2>Video length</h2>${table(['Length', 'Videos'], Object.entries(v.durationBuckets))}</div>
    </div>`,
    `<div class="grid">
      <div><h2>File types</h2>${table(
        ['Category', 'Files', 'Size', 'Share of size'],
        Object.entries(m.categories)
          .filter(([, c]) => c.count > 0)
          .sort(([, a], [, b]) => b.totalSize - a.totalSize)
          .map(([name, c]) => [name, c.count.toLocaleString('en-US'), formatBytes(c.totalSize), `${c.percentSize.toFixed(1)}%`])
      )}</div>
      <div><h2>Top extensions</h2>${table(
        ['Extension', 'Files', 'Size'],
        m.topExtensions.slice(0, 10).map((e) => [`.${e.extension || '(none)'}`, e.count.toLocaleString('en-US'), formatBytes(e.totalSize)])
      )}</div>
    </div>`,
    `<div class="grid">
      <div><h2>File age (last modified)</h2>${table(['Age', 'Files'], Object.entries(m.ageBuckets))}</div>
      <div><h2>File size</h2>${table(['Size', 'Files'], Object.entries(m.sizeBuckets))}</div>
    </div>`,
    `<h2>Added per month</h2>${table(
      ['Month', 'Files', 'Size'],
      m.monthlyIngestion.map((row) => [row.month, row.count.toLocaleString('en-US'), formatBytes(row.totalSize)])
    )}`,
    `<h2>Longest videos</h2>${table(
      ['File', 'Length', 'Resolution', 'Size', 'Modified'],
      m.longestVideos.slice(0, 10).map((f) => [f.key, formatClockTime(f.duration || 0), resolution(f), formatBytes(f.size), fmtDate(f.lastModified)])
    )}`,
    `<h2>Largest files</h2>${table(
      ['File', 'Size', 'Type', 'Modified'],
      m.largestFiles.slice(0, 10).map((f) => [f.key, formatBytes(f.size), f.category, fmtDate(f.lastModified)])
    )}`,
    `<h2>Local mirror</h2>${table(
      ['', 'Files', 'Size'],
      [
        ['On remote storage', m.onPremSync.totalRemoteFiles.toLocaleString('en-US'), formatBytes(m.onPremSync.totalRemoteSize)],
        ['Downloaded to this server', m.onPremSync.syncedFilesCount.toLocaleString('en-US'), formatBytes(m.onPremSync.syncedSize)],
        ['Not downloaded yet', m.onPremSync.missingLocalCount.toLocaleString('en-US'), formatBytes(m.onPremSync.missingLocalSize)],
        ['Local copy differs in size', m.onPremSync.mismatchedCount.toLocaleString('en-US'), ''],
      ]
    )}`,
  ];

  const title = `${m.sourceName} storage report`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { --ink: #0f172a; --muted: #64748b; --line: #e2e8f0; --tint: #f8fafc; --accent: #0e7490; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 16px; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: #fff; }
  main { max-width: 1040px; margin: 0 auto; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 28px 0 8px; color: var(--accent); }
  .meta { color: var(--muted); font-size: 13px; margin: 0; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 20px 0 4px; }
  .kpi { border: 1px solid var(--line); border-radius: 10px; padding: 12px; background: var(--tint); }
  .kpi .label { font-size: 12px; color: var(--muted); }
  .kpi .value { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .kpi .sub { font-size: 12px; color: var(--muted); }
  .note { border-left: 3px solid #d97706; background: #fffbeb; padding: 8px 12px; margin: 12px 0 0; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 0 24px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 12px; color: var(--muted); font-weight: 600; background: var(--tint); }
  td { word-break: break-word; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .empty { color: var(--muted); }
  footer { margin-top: 32px; color: var(--muted); font-size: 12px; }
  @media print { body { padding: 0; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">${escapeHtml(m.provider.toUpperCase())} · Last scanned ${escapeHtml(fmtDate(source?.last_scanned_at))} · Generated ${escapeHtml(fmtDate(generatedAt))}</p>
  <div class="kpis">
    ${kpis
      .map(
        ([label, value, sub]) =>
          `<div class="kpi"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div>${
            sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ''
          }</div>`
      )
      .join('')}
  </div>
  ${coverageNote}
  ${sections.join('\n')}
  <footer>Generated by Reelhouse from the latest scan. Figures reflect the remote storage as of the scan time.</footer>
</main>
</body>
</html>`;

  return { filename: `${fileSafe(m.sourceName)}-report-${dateStamp(generatedAt)}.html`, html };
}

const CSV_COLUMNS = [
  'path',
  'folder',
  'category',
  'extension',
  'size_bytes',
  'size',
  'last_modified_utc',
  'duration_seconds',
  'duration',
  'width',
  'height',
  'codec',
  'local_copy',
] as const;

/**
 * Quote a CSV cell. Values starting with = + - @ are prefixed with ' so spreadsheet apps
 * don't run them as formulas (file names come from remote storage).
 */
function csvCell(value: unknown): string {
  let s = value === undefined || value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_PAGE_SIZE = 2000;

/** Write one CSV row per file, reading the table in pages so large libraries stay out of memory. */
export async function writeCsvReport(sourceId: string, out: Writable): Promise<void> {
  const write = async (chunk: string) => {
    // Respect backpressure from a slow client
    if (!out.write(chunk)) await once(out, 'drain');
  };
  await write('﻿'); // BOM so Excel reads UTF-8 file names correctly
  await write(CSV_COLUMNS.join(',') + '\r\n');

  // Keyset paging: continue after the last key written (keys are unique per source)
  let lastKey: string | null = null;
  for (;;) {
    const rows: any[] = await query(
      `SELECT key, category, extension, size, last_modified, duration, width, height, codec, local_status
       FROM files WHERE source_id = ? ${lastKey === null ? '' : 'AND key > ?'}
       ORDER BY key LIMIT ${CSV_PAGE_SIZE}`,
      lastKey === null ? [sourceId] : [sourceId, lastKey]
    );
    if (rows.length === 0) break;
    lastKey = rows[rows.length - 1].key;
    await write(rows.map(csvLine).join(''));
    if (rows.length < CSV_PAGE_SIZE) break;
  }
}

function csvLine(r: any): string {
  const slash = r.key.lastIndexOf('/');
  const line = [
    r.key,
    slash > 0 ? r.key.slice(0, slash) : '',
    r.category,
    r.extension,
    r.size,
    formatBytes(r.size),
    new Date(r.last_modified).toISOString(),
    r.duration > 0 ? r.duration.toFixed(2) : '',
    r.duration > 0 ? formatClockTime(r.duration) : '',
    r.width ?? '',
    r.height ?? '',
    r.codec ?? '',
    r.local_status,
  ];
  return line.map(csvCell).join(',') + '\r\n';
}

export async function csvReportFilename(sourceId: string): Promise<string> {
  const source = await queryOne<{ name: string }>('SELECT name FROM sources WHERE id = ?', [sourceId]);
  if (!source) throw new NotFoundError('Source not found');
  return `${fileSafe(source.name)}-files-${dateStamp(Date.now())}.csv`;
}

const fileSafe = (name: string): string => name.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'source';
const dateStamp = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
