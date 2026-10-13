import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { transaction, getMeta, setMeta, insertRows, query } from './db.js';

/**
 * One-time copy of the old SQLite database into Postgres. Runs at startup until it succeeds
 * once, then never again (recorded in app_meta). The SQLite file is left untouched as a backup.
 */

const IMPORT_MARKER = 'sqlite_import';

// Tables in dependency order (files reference sources)
const TABLES = ['sources', 'files', 'download_batches', 'download_tasks', 'scan_history'] as const;

// SQLite stored these as 0/1
const BOOLEAN_COLUMNS = new Set(['force_path_style', 'read_only', 'checkpoint_applied']);

function findSqliteFile(): string | undefined {
  const candidates = [
    process.env.SQLITE_IMPORT_PATH,
    path.resolve(process.cwd(), 'data', 'reelhouse.db'),
    // From before the rename (CDN Buddy → Reelhouse)
    path.resolve(process.cwd(), 'data', 'cdn_buddy.db'),
  ];
  return candidates.find((p): p is string => Boolean(p) && fs.existsSync(p!) && fs.statSync(p!).size > 0);
}

export async function importSqliteIfNeeded(): Promise<void> {
  if (await getMeta(IMPORT_MARKER)) return;

  const sqlitePath = findSqliteFile();
  if (!sqlitePath) {
    await setMeta(IMPORT_MARKER, JSON.stringify({ at: Date.now(), source: null, note: 'no SQLite database found' }));
    return;
  }

  console.log(`[Reelhouse Server] Importing SQLite data from ${sqlitePath} into Postgres...`);
  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const counts: Record<string, number> = {};

  try {
    await transaction(async (client) => {
      for (const table of TABLES) {
        const hasTable = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
        if (!hasTable) continue;

        // Copy the columns both schemas have (old databases may lack later additions)
        const pgColumns = (
          await query<{ column_name: string }>(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?",
            [table],
            client
          )
        ).map((c) => c.column_name);
        const sqliteColumns = (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
        const columns = pgColumns.filter((c) => sqliteColumns.includes(c));

        let sql = `SELECT ${columns.join(', ')} FROM ${table}`;
        // SQLite didn't enforce the foreign key; skip files whose source was deleted
        if (table === 'files') sql += ' WHERE source_id IN (SELECT id FROM sources)';
        const rows = (sqlite.prepare(sql).all() as Array<Record<string, unknown>>).map((row) =>
          columns.map((c) => (BOOLEAN_COLUMNS.has(c) ? Boolean(row[c]) : row[c] ?? null))
        );

        // Rows already in Postgres win, so a re-run can't overwrite newer data
        await insertRows(client, table, columns, rows, 'ON CONFLICT (id) DO NOTHING');
        counts[table] = rows.length;
      }
      await setMeta(IMPORT_MARKER, JSON.stringify({ at: Date.now(), source: sqlitePath, counts }), client);
    });
  } finally {
    sqlite.close();
  }

  console.log(
    `[Reelhouse Server] Imported ${Object.entries(counts)
      .map(([table, n]) => `${n} ${table}`)
      .join(', ')}. The SQLite file was left in place as a backup.`
  );
}
