import pg from 'pg';
import { StorageSource, StorageFile, DownloadTask, DownloadBatch, HierarchyFolder, HierarchyBreadcrumb, HierarchyResponse } from './types.js';

// Timestamps (Unix ms), sizes and COUNT(*) are BIGINT; SUM/AVG return NUMERIC. Both fit in a JS number.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => parseInt(value, 10));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => parseFloat(value));

export const DATABASE_URL = process.env.DATABASE_URL || 'postgres://reelhouse:reelhouse@localhost:5435/reelhouse';

export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });
pool.on('error', (err) => console.error('Postgres pool error:', err.message));

type Queryable = pg.Pool | pg.PoolClient;

/** SQL here is written with ? placeholders; Postgres wants $1, $2, ... */
const numberPlaceholders = (sql: string): string => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

export async function query<T = any>(sql: string, params: unknown[] = [], client: Queryable = pool): Promise<T[]> {
  return (await client.query(numberPlaceholders(sql), params)).rows as T[];
}

export async function queryOne<T = any>(sql: string, params: unknown[] = [], client: Queryable = pool): Promise<T | undefined> {
  return (await query<T>(sql, params, client))[0];
}

export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Insert many rows with multi-row VALUES, split so each statement stays under
 * Postgres's 65535-parameter limit. `suffix` is appended, e.g. an ON CONFLICT clause.
 */
export async function insertRows(
  client: Queryable,
  table: string,
  columns: string[],
  rows: unknown[][],
  suffix = ''
): Promise<void> {
  const perStatement = Math.floor(60000 / columns.length);
  for (let start = 0; start < rows.length; start += perStatement) {
    const chunk = rows.slice(start, start + perStatement);
    const values = chunk.map((_, r) => `(${columns.map((_, c) => `$${r * columns.length + c + 1}`).join(', ')})`);
    await client.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values.join(', ')} ${suffix}`, chunk.flat());
  }
}

/** Escape LIKE wildcards so keys containing % or _ match literally. */
const likeEscape = (value: string): string => value.replace(/[\\%_]/g, '\\$&');

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    bucket TEXT NOT NULL,
    region TEXT,
    access_key TEXT,
    secret_key TEXT,
    force_path_style BOOLEAN NOT NULL DEFAULT FALSE,
    cdn_url TEXT,
    local_path TEXT NOT NULL DEFAULT '',
    read_only BOOLEAN NOT NULL DEFAULT TRUE,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    last_scanned_at BIGINT,
    scan_status TEXT NOT NULL DEFAULT 'idle',
    total_files BIGINT NOT NULL DEFAULT 0,
    total_size BIGINT NOT NULL DEFAULT 0,
    total_video_duration DOUBLE PRECISION NOT NULL DEFAULT 0,
    last_checkpoint_mtime BIGINT
  );

  -- key uses the "C" collation: byte order like SQLite, and prefix LIKE can use the index
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    key TEXT COLLATE "C" NOT NULL,
    size BIGINT NOT NULL,
    etag TEXT,
    last_modified BIGINT NOT NULL,
    content_type TEXT NOT NULL,
    extension TEXT NOT NULL,
    category TEXT NOT NULL,
    duration DOUBLE PRECISION DEFAULT 0,
    width INTEGER,
    height INTEGER,
    codec TEXT,
    bitrate BIGINT,
    local_status TEXT DEFAULT 'missing',
    local_size BIGINT,
    local_mtime BIGINT,
    local_file_path TEXT,
    scanned_at BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_files_source_key ON files(source_id, key);
  CREATE INDEX IF NOT EXISTS idx_files_source_category ON files(source_id, category);
  CREATE INDEX IF NOT EXISTS idx_files_source_mtime ON files(source_id, last_modified);
  CREATE INDEX IF NOT EXISTS idx_files_source_size ON files(source_id, size);
  CREATE INDEX IF NOT EXISTS idx_files_source_duration ON files(source_id, duration);

  CREATE TABLE IF NOT EXISTS download_tasks (
    id TEXT PRIMARY KEY,
    batch_id TEXT,
    source_id TEXT NOT NULL,
    file_key TEXT NOT NULL,
    destination_path TEXT NOT NULL,
    size BIGINT NOT NULL,
    bytes_downloaded BIGINT DEFAULT 0,
    speed_bps BIGINT DEFAULT 0,
    status TEXT DEFAULT 'queued',
    error TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    completed_at BIGINT
  );

  CREATE INDEX IF NOT EXISTS idx_downloads_status ON download_tasks(status);
  CREATE INDEX IF NOT EXISTS idx_downloads_source_key ON download_tasks(source_id, file_key);
  CREATE INDEX IF NOT EXISTS idx_downloads_batch ON download_tasks(batch_id);
  CREATE INDEX IF NOT EXISTS idx_downloads_created ON download_tasks(created_at);

  CREATE TABLE IF NOT EXISTS download_batches (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    type TEXT NOT NULL,
    start_date BIGINT,
    end_date BIGINT,
    files_count BIGINT DEFAULT 0,
    total_size BIGINT DEFAULT 0,
    bytes_downloaded BIGINT DEFAULT 0,
    status TEXT DEFAULT 'queued',
    checkpoint_applied BOOLEAN NOT NULL DEFAULT FALSE,
    checkpoint_timestamp BIGINT,
    created_at BIGINT NOT NULL,
    completed_at BIGINT
  );

  CREATE INDEX IF NOT EXISTS idx_batches_source ON download_batches(source_id);
  CREATE INDEX IF NOT EXISTS idx_batches_created ON download_batches(created_at);

  CREATE TABLE IF NOT EXISTS scan_history (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    started_at BIGINT NOT NULL,
    completed_at BIGINT,
    status TEXT NOT NULL,
    files_count BIGINT DEFAULT 0,
    total_size BIGINT DEFAULT 0,
    video_duration_seconds DOUBLE PRECISION DEFAULT 0,
    metrics_json TEXT,
    error TEXT
  );

  -- One-off markers such as "SQLite data imported"
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at BIGINT NOT NULL
  );
`;

/**
 * Wait for Postgres (it may still be starting next to us in Docker), then create the schema.
 * Schema changes go here as idempotent statements (CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS).
 */
export async function initDatabase(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (err: any) {
      if (attempt >= 30) throw new Error(`Cannot reach Postgres at ${redactUrl(DATABASE_URL)}: ${err.message}`);
      if (attempt === 1) console.log(`[Reelhouse Server] Waiting for Postgres at ${redactUrl(DATABASE_URL)}...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  await pool.query(SCHEMA);
}

export const redactUrl = (url: string): string => url.replace(/\/\/([^:/@]+):[^@]*@/, '//$1:***@');

export async function getMeta(key: string, client: Queryable = pool): Promise<string | undefined> {
  return (await queryOne<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', [key], client))?.value;
}

export async function setMeta(key: string, value: string, client: Queryable = pool): Promise<void> {
  await query(
    `INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, Date.now()],
    client
  );
}

// Repository helpers
export const sourceRepo = {
  async getAll(): Promise<StorageSource[]> {
    const rows = await query('SELECT * FROM sources ORDER BY created_at ASC');
    return rows.map(mapSourceRow);
  },

  async getById(id: string): Promise<StorageSource | null> {
    const row = await queryOne('SELECT * FROM sources WHERE id = ?', [id]);
    return row ? mapSourceRow(row) : null;
  },

  async insert(source: StorageSource): Promise<void> {
    await query(
      `INSERT INTO sources (
        id, name, provider, endpoint, bucket, region, access_key, secret_key,
        force_path_style, cdn_url, local_path, read_only, created_at, updated_at,
        last_scanned_at, scan_status, total_files, total_size, total_video_duration,
        last_checkpoint_mtime
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        source.id,
        source.name,
        source.provider,
        source.endpoint,
        source.bucket,
        source.region || '',
        source.accessKey || '',
        source.secretKey || '',
        Boolean(source.forcePathStyle),
        source.cdnUrl || '',
        source.localPath || '',
        Boolean(source.readOnly),
        source.createdAt,
        source.updatedAt,
        source.lastScannedAt || null,
        source.scanStatus,
        source.totalFiles,
        source.totalSize,
        source.totalVideoDuration,
        source.lastCheckpointMtime || null,
      ]
    );
  },

  async update(source: StorageSource): Promise<void> {
    await query(
      `UPDATE sources SET
        name = ?, provider = ?, endpoint = ?, bucket = ?, region = ?, access_key = ?, secret_key = ?,
        force_path_style = ?, cdn_url = ?, local_path = ?, read_only = ?, updated_at = ?,
        last_scanned_at = ?, scan_status = ?, total_files = ?, total_size = ?, total_video_duration = ?,
        last_checkpoint_mtime = ?
      WHERE id = ?`,
      [
        source.name,
        source.provider,
        source.endpoint,
        source.bucket,
        source.region || '',
        source.accessKey || '',
        source.secretKey || '',
        Boolean(source.forcePathStyle),
        source.cdnUrl || '',
        source.localPath || '',
        Boolean(source.readOnly),
        source.updatedAt,
        source.lastScannedAt || null,
        source.scanStatus,
        source.totalFiles,
        source.totalSize,
        source.totalVideoDuration,
        source.lastCheckpointMtime || null,
        source.id,
      ]
    );
  },

  /** Record a finished scan without touching settings that may have been edited meanwhile. */
  async finishScan(
    id: string,
    totals: { totalFiles: number; totalSize: number; totalVideoDuration: number; lastScannedAt: number }
  ): Promise<void> {
    await query(
      `UPDATE sources SET scan_status = 'completed', total_files = ?, total_size = ?, total_video_duration = ?,
        last_scanned_at = ?, updated_at = ?
      WHERE id = ?`,
      [totals.totalFiles, totals.totalSize, totals.totalVideoDuration, totals.lastScannedAt, Date.now(), id]
    );
  },

  async updateCheckpoint(id: string, timestamp: number): Promise<void> {
    await query('UPDATE sources SET last_checkpoint_mtime = ?, updated_at = ? WHERE id = ?', [timestamp, Date.now(), id]);
  },

  async updateScanStatus(id: string, status: StorageSource['scanStatus'], lastScannedAt?: number): Promise<void> {
    if (lastScannedAt) {
      await query('UPDATE sources SET scan_status = ?, last_scanned_at = ?, updated_at = ? WHERE id = ?', [
        status,
        lastScannedAt,
        Date.now(),
        id,
      ]);
    } else {
      await query('UPDATE sources SET scan_status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), id]);
    }
  },

  async delete(id: string): Promise<void> {
    await transaction(async (client) => {
      await query('DELETE FROM files WHERE source_id = ?', [id], client);
      await query('DELETE FROM download_tasks WHERE source_id = ?', [id], client);
      await query('DELETE FROM scan_history WHERE source_id = ?', [id], client);
      await query('DELETE FROM sources WHERE id = ?', [id], client);
    });
  },
};

const ALLOWED_SORT = ['key', 'size', 'last_modified', 'duration', 'category', 'extension', 'local_status'];
const sortClause = (sortBy: string, sortOrder?: string): string =>
  `${ALLOWED_SORT.includes(sortBy) ? sortBy : 'key'} ${sortOrder === 'DESC' ? 'DESC' : 'ASC'}`;

export const fileRepo = {
  async getBySource(
    sourceId: string,
    options: {
      category?: string;
      search?: string;
      startDate?: number;
      endDate?: number;
      limit?: number;
      offset?: number;
      sortBy?: string;
      sortOrder?: 'ASC' | 'DESC';
      prefix?: string;
    } = {}
  ): Promise<{ files: StorageFile[]; total: number }> {
    const { category, search, startDate, endDate, limit = 100, offset = 0, sortBy = 'key', sortOrder = 'ASC', prefix } = options;

    let whereClause = 'WHERE source_id = ?';
    const params: any[] = [sourceId];

    if (category && category !== 'all') {
      whereClause += ' AND category = ?';
      params.push(category);
    }
    if (search) {
      // Case-insensitive, as it was with SQLite's LIKE
      whereClause += ' AND key ILIKE ?';
      params.push(`%${likeEscape(search)}%`);
    }
    if (prefix) {
      whereClause += ' AND key LIKE ?';
      params.push(`${likeEscape(prefix)}%`);
    }
    if (startDate !== undefined) {
      whereClause += ' AND last_modified >= ?';
      params.push(startDate);
    }
    if (endDate !== undefined) {
      whereClause += ' AND last_modified <= ?';
      params.push(endDate);
    }

    const countRow = await queryOne(`SELECT COUNT(*) AS count FROM files ${whereClause}`, params);
    const rows = await query(
      `SELECT * FROM files ${whereClause} ORDER BY ${sortClause(sortBy, sortOrder)} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return { files: rows.map(mapFileRow), total: countRow?.count ?? 0 };
  },

  async getByKey(sourceId: string, key: string): Promise<StorageFile | null> {
    const row = await queryOne('SELECT * FROM files WHERE source_id = ? AND key = ?', [sourceId, key]);
    return row ? mapFileRow(row) : null;
  },

  /** Rows for many keys at once (one scanner page), keyed by file key. */
  async getByKeys(sourceId: string, keys: string[]): Promise<Map<string, StorageFile>> {
    if (keys.length === 0) return new Map();
    const rows = await query('SELECT * FROM files WHERE source_id = ? AND key = ANY(?)', [sourceId, keys]);
    return new Map(rows.map((row) => [row.key, mapFileRow(row)]));
  },

  /** Every file to download for a source or folder, without a page limit. */
  async listForDownload(
    sourceId: string,
    options: { prefix?: string; onlyMissing?: boolean; excludeSynced?: boolean } = {}
  ): Promise<StorageFile[]> {
    let sql = 'SELECT * FROM files WHERE source_id = ?';
    const params: any[] = [sourceId];
    if (options.prefix) {
      sql += ' AND key LIKE ?';
      params.push(`${likeEscape(options.prefix)}%`);
    }
    if (options.onlyMissing) sql += " AND local_status = 'missing'";
    if (options.excludeSynced) sql += " AND local_status <> 'synced'";
    const rows = await query(`${sql} ORDER BY key`, params);
    return rows.map(mapFileRow);
  },

  async getHierarchy(
    sourceId: string,
    options: {
      prefix?: string;
      category?: string;
      search?: string;
      startDate?: number;
      endDate?: number;
      limit?: number;
      offset?: number;
      sortBy?: string;
      sortOrder?: 'ASC' | 'DESC';
    } = {}
  ): Promise<HierarchyResponse> {
    const rawPrefix = options.prefix || '';
    // Normalize prefix: if empty or '/', normalize to ''; otherwise ensure it ends with '/'
    const prefix = rawPrefix && rawPrefix !== '/' ? (rawPrefix.endsWith('/') ? rawPrefix : rawPrefix + '/') : '';
    const { category, search, startDate, endDate, limit = 200, offset = 0, sortBy = 'key', sortOrder = 'ASC' } = options;

    // Build breadcrumbs
    const breadcrumbs: HierarchyBreadcrumb[] = [{ name: 'Root', prefix: '' }];
    if (prefix) {
      const parts = prefix.replace(/\/$/, '').split('/');
      let currentAcc = '';
      for (const part of parts) {
        currentAcc += part + '/';
        breadcrumbs.push({ name: part, prefix: currentAcc });
      }
    }

    // Determine parent prefix
    let parentPrefix: string | null = null;
    if (prefix) {
      const parts = prefix.replace(/\/$/, '').split('/');
      parts.pop();
      parentPrefix = parts.length > 0 ? parts.join('/') + '/' : '';
    }

    // Filter clauses for optional category, search, and date range
    let filterClause = '';
    const filterParams: any[] = [];
    if (category && category !== 'all') {
      filterClause += ' AND category = ?';
      filterParams.push(category);
    }
    if (search) {
      filterClause += ' AND key ILIKE ?';
      filterParams.push(`%${likeEscape(search)}%`);
    }
    if (startDate !== undefined) {
      filterClause += ' AND last_modified >= ?';
      filterParams.push(startDate);
    }
    if (endDate !== undefined) {
      filterClause += ' AND last_modified <= ?';
      filterParams.push(endDate);
    }

    // The part of the key below the current folder
    const rest = `substr(key, ${prefix.length + 1})`;
    const scope = prefix ? 'source_id = ? AND key LIKE ?' : 'source_id = ?';
    const scopeParams = prefix ? [sourceId, `${likeEscape(prefix)}%`] : [sourceId];

    // 1. Immediate subfolders
    const folderRows = await query(
      `SELECT
         substr(${rest}, 1, strpos(${rest}, '/') - 1) AS folder_name,
         COUNT(*) AS file_count,
         SUM(size) AS total_size,
         SUM(duration) AS video_duration
       FROM files
       WHERE ${scope} AND strpos(${rest}, '/') > 0 ${filterClause}
       GROUP BY folder_name
       ORDER BY folder_name ASC`,
      [...scopeParams, ...filterParams]
    );

    const folders: HierarchyFolder[] = folderRows
      .filter((r) => r.folder_name)
      .map((r) => ({
        name: r.folder_name,
        prefix: `${prefix}${r.folder_name}/`,
        fileCount: Number(r.file_count || 0),
        totalSize: Number(r.total_size || 0),
        videoDuration: Number(r.video_duration || 0),
      }));

    // 2. Files directly in this folder
    const fileWhere = `WHERE ${scope} AND strpos(${rest}, '/') = 0 ${filterClause}`;
    const totalFilesRow = await queryOne(`SELECT COUNT(*) AS count FROM files ${fileWhere}`, [...scopeParams, ...filterParams]);
    const fileRows = await query(
      `SELECT * FROM files ${fileWhere} ORDER BY ${sortClause(sortBy, sortOrder)} LIMIT ? OFFSET ?`,
      [...scopeParams, ...filterParams, limit, offset]
    );
    const files: StorageFile[] = fileRows.map(mapFileRow);

    const totalSize = folders.reduce((acc, f) => acc + f.totalSize, 0) + files.reduce((acc, f) => acc + f.size, 0);

    return {
      currentPrefix: prefix,
      parentPrefix,
      breadcrumbs,
      folders,
      files,
      totalFolders: folders.length,
      totalFiles: totalFilesRow?.count ?? 0,
      totalSize,
    };
  },

  async upsertBatch(files: StorageFile[]): Promise<void> {
    if (files.length === 0) return;
    // A statement can't update the same row twice, so keep the last entry per id
    const unique = [...new Map(files.map((f) => [f.id, f])).values()];
    const columns = [
      'id', 'source_id', 'key', 'size', 'etag', 'last_modified', 'content_type',
      'extension', 'category', 'duration', 'width', 'height', 'codec', 'bitrate',
      'local_status', 'local_size', 'local_mtime', 'local_file_path', 'scanned_at',
    ];
    const rows = unique.map((item) => [
      item.id,
      item.sourceId,
      item.key,
      item.size,
      item.etag ?? null,
      item.lastModified,
      item.contentType,
      item.extension,
      item.category,
      item.duration || 0,
      item.width ?? null,
      item.height ?? null,
      item.codec ?? null,
      item.bitrate ?? null,
      item.localStatus,
      item.localSize ?? null,
      item.localMtime ?? null,
      item.localFilePath ?? null,
      item.scannedAt,
    ]);
    // Never blank out media info: a quick scan sends no duration, a deep scan only for new/changed files
    await insertRows(
      pool,
      'files',
      columns,
      rows,
      `ON CONFLICT (id) DO UPDATE SET
        size = excluded.size,
        etag = excluded.etag,
        last_modified = excluded.last_modified,
        content_type = excluded.content_type,
        extension = excluded.extension,
        category = excluded.category,
        duration = CASE WHEN excluded.duration > 0 THEN excluded.duration ELSE files.duration END,
        width = COALESCE(excluded.width, files.width),
        height = COALESCE(excluded.height, files.height),
        codec = COALESCE(excluded.codec, files.codec),
        bitrate = COALESCE(excluded.bitrate, files.bitrate),
        local_status = excluded.local_status,
        local_size = excluded.local_size,
        local_mtime = excluded.local_mtime,
        local_file_path = excluded.local_file_path,
        scanned_at = excluded.scanned_at`
    );
  },

  async updateLocalStatus(
    id: string,
    status: StorageFile['localStatus'],
    size?: number,
    mtime?: number,
    filePath?: string
  ): Promise<void> {
    await query('UPDATE files SET local_status = ?, local_size = ?, local_mtime = ?, local_file_path = ? WHERE id = ?', [
      status,
      size ?? null,
      mtime ?? null,
      filePath ?? null,
      id,
    ]);
  },

  async getByDateRange(
    sourceId: string,
    options: { startDate?: number; endDate?: number; onlyMissing?: boolean } = {}
  ): Promise<StorageFile[]> {
    let sql = 'SELECT * FROM files WHERE source_id = ?';
    const params: any[] = [sourceId];
    if (options.startDate !== undefined) {
      sql += ' AND last_modified >= ?';
      params.push(options.startDate);
    }
    if (options.endDate !== undefined) {
      sql += ' AND last_modified <= ?';
      params.push(options.endDate);
    }
    if (options.onlyMissing) {
      sql += " AND local_status = 'missing'";
    }
    sql += ' ORDER BY last_modified ASC';
    const rows = await query(sql, params);
    return rows.map(mapFileRow);
  },
};

const TASK_COLUMNS = [
  'id', 'batch_id', 'source_id', 'file_key', 'destination_path', 'size', 'bytes_downloaded',
  'speed_bps', 'status', 'error', 'created_at', 'updated_at', 'completed_at',
];

export const downloadRepo = {
  async createBatch(batch: DownloadBatch): Promise<void> {
    await query(
      `INSERT INTO download_batches (
        id, source_id, source_name, type, start_date, end_date, files_count,
        total_size, bytes_downloaded, status, checkpoint_applied, checkpoint_timestamp,
        created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        batch.id,
        batch.sourceId,
        batch.sourceName,
        batch.type,
        batch.startDate || null,
        batch.endDate || null,
        batch.filesCount,
        batch.totalSize,
        batch.bytesDownloaded,
        batch.status,
        Boolean(batch.checkpointApplied),
        batch.checkpointTimestamp || null,
        batch.createdAt,
        batch.completedAt || null,
      ]
    );
  },

  async updateBatch(id: string, updates: Partial<DownloadBatch>): Promise<void> {
    const fields: string[] = [];
    const params: any[] = [];
    if (updates.status !== undefined) { fields.push('status = ?'); params.push(updates.status); }
    if (updates.bytesDownloaded !== undefined) { fields.push('bytes_downloaded = ?'); params.push(updates.bytesDownloaded); }
    if (updates.completedAt !== undefined) { fields.push('completed_at = ?'); params.push(updates.completedAt); }
    if (fields.length > 0) {
      await query(`UPDATE download_batches SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
    }
  },

  async updateBatchProgress(batchId: string): Promise<void> {
    const stats = await queryOne(
      `SELECT
        COUNT(*) AS total,
        SUM(size) AS total_size,
        SUM(bytes_downloaded) AS downloaded,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
        SUM(CASE WHEN status = 'downloading' THEN 1 ELSE 0 END) AS downloading_count
      FROM download_tasks
      WHERE batch_id = ?`,
      [batchId]
    );

    if (!stats || stats.total === 0) return;

    let status: DownloadBatch['status'] = 'downloading';
    let completedAt: number | null = null;
    if (stats.downloading_count === 0) {
      if (stats.completed_count === stats.total) {
        status = 'completed';
        completedAt = Date.now();
      } else if (stats.failed_count === stats.total) {
        status = 'failed';
        completedAt = Date.now();
      } else if (stats.completed_count > 0 || stats.failed_count > 0) {
        status = 'partial';
        completedAt = Date.now();
      }
    }

    await query(
      `UPDATE download_batches
      SET bytes_downloaded = ?, status = ?, completed_at = COALESCE(completed_at, ?)
      WHERE id = ?`,
      [stats.downloaded || 0, status, completedAt, batchId]
    );
  },

  async getBatches(sourceId?: string, limit: number = 50): Promise<DownloadBatch[]> {
    let sql = 'SELECT * FROM download_batches';
    const params: any[] = [];
    if (sourceId) {
      sql += ' WHERE source_id = ?';
      params.push(sourceId);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    const rows = await query(sql, params);
    return rows.map(mapBatchRow);
  },

  async getBatchById(id: string): Promise<DownloadBatch | null> {
    const row = await queryOne('SELECT * FROM download_batches WHERE id = ?', [id]);
    return row ? mapBatchRow(row) : null;
  },

  async getBatchTasks(batchId: string): Promise<DownloadTask[]> {
    const rows = await query('SELECT * FROM download_tasks WHERE batch_id = ? ORDER BY created_at ASC', [batchId]);
    return rows.map(mapDownloadRow);
  },

  async create(task: DownloadTask): Promise<void> {
    await this.createMany([task]);
  },

  async createMany(tasks: DownloadTask[]): Promise<void> {
    if (tasks.length === 0) return;
    const rows = tasks.map((task) => [
      task.id,
      task.batchId || null,
      task.sourceId,
      task.fileKey,
      task.destinationPath,
      task.size,
      task.bytesDownloaded,
      task.speedBps,
      task.status,
      task.error || null,
      task.createdAt,
      task.updatedAt,
      task.completedAt || null,
    ]);
    await transaction((client) => insertRows(client, 'download_tasks', TASK_COLUMNS, rows));
  },

  async updateProgress(id: string, bytesDownloaded: number, speedBps: number, status?: DownloadTask['status']): Promise<void> {
    if (status) {
      await query('UPDATE download_tasks SET bytes_downloaded = ?, speed_bps = ?, status = ?, updated_at = ? WHERE id = ?', [
        bytesDownloaded,
        speedBps,
        status,
        Date.now(),
        id,
      ]);
    } else {
      // Progress updates are sent without waiting; never let a late one touch a finished task
      await query(
        "UPDATE download_tasks SET bytes_downloaded = ?, speed_bps = ?, updated_at = ? WHERE id = ? AND status = 'downloading'",
        [bytesDownloaded, speedBps, Date.now(), id]
      );
    }
  },

  async finish(id: string, status: 'completed' | 'failed', error?: string): Promise<void> {
    const task = await queryOne(
      `UPDATE download_tasks
      SET status = ?, error = ?, speed_bps = 0, updated_at = ?, completed_at = ?
      WHERE id = ?
      RETURNING batch_id`,
      [status, error || null, Date.now(), Date.now(), id]
    );
    if (task?.batch_id) {
      await this.updateBatchProgress(task.batch_id);
    }
  },

  async getAll(): Promise<DownloadTask[]> {
    const rows = await query('SELECT * FROM download_tasks ORDER BY created_at DESC LIMIT 100');
    return rows.map(mapDownloadRow);
  },

  async getBySource(sourceId: string): Promise<DownloadTask[]> {
    const rows = await query('SELECT * FROM download_tasks WHERE source_id = ? ORDER BY created_at DESC LIMIT 50', [sourceId]);
    return rows.map(mapDownloadRow);
  },

  async getHistory(
    options: { sourceId?: string; search?: string; status?: string; limit?: number; offset?: number } = {}
  ): Promise<{ tasks: DownloadTask[]; total: number }> {
    const { sourceId, search, status, limit = 50, offset = 0 } = options;
    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (sourceId) { where += ' AND source_id = ?'; params.push(sourceId); }
    if (status) { where += ' AND status = ?'; params.push(status); }
    if (search) { where += ' AND file_key ILIKE ?'; params.push(`%${likeEscape(search)}%`); }

    const countRow = await queryOne(`SELECT COUNT(*) AS count FROM download_tasks ${where}`, params);
    const rows = await query(`SELECT * FROM download_tasks ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [
      ...params,
      limit,
      offset,
    ]);
    return { tasks: rows.map(mapDownloadRow), total: countRow?.count ?? 0 };
  },
};

function mapSourceRow(row: any): StorageSource {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    endpoint: row.endpoint,
    bucket: row.bucket,
    region: row.region || undefined,
    accessKey: row.access_key || undefined,
    secretKey: row.secret_key || undefined,
    forcePathStyle: Boolean(row.force_path_style),
    cdnUrl: row.cdn_url || undefined,
    localPath: row.local_path,
    readOnly: Boolean(row.read_only),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastScannedAt: row.last_scanned_at || undefined,
    scanStatus: row.scan_status,
    totalFiles: row.total_files,
    totalSize: row.total_size,
    totalVideoDuration: row.total_video_duration,
    lastCheckpointMtime: row.last_checkpoint_mtime || undefined,
  };
}

export function mapFileRow(row: any): StorageFile {
  return {
    id: row.id,
    sourceId: row.source_id,
    key: row.key,
    size: row.size,
    etag: row.etag || undefined,
    lastModified: row.last_modified,
    contentType: row.content_type,
    extension: row.extension,
    category: row.category,
    duration: row.duration || 0,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    codec: row.codec || undefined,
    bitrate: row.bitrate ?? undefined,
    localStatus: row.local_status,
    localSize: row.local_size ?? undefined,
    localMtime: row.local_mtime ?? undefined,
    localFilePath: row.local_file_path ?? undefined,
    scannedAt: row.scanned_at,
  };
}

function mapDownloadRow(row: any): DownloadTask {
  return {
    id: row.id,
    batchId: row.batch_id || undefined,
    sourceId: row.source_id,
    fileKey: row.file_key,
    destinationPath: row.destination_path,
    size: row.size,
    bytesDownloaded: row.bytes_downloaded,
    speedBps: row.speed_bps,
    status: row.status,
    error: row.error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || undefined,
  };
}

function mapBatchRow(row: any): DownloadBatch {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    type: row.type,
    startDate: row.start_date || undefined,
    endDate: row.end_date || undefined,
    filesCount: row.files_count,
    totalSize: row.total_size,
    bytesDownloaded: row.bytes_downloaded,
    status: row.status,
    checkpointApplied: Boolean(row.checkpoint_applied),
    checkpointTimestamp: row.checkpoint_timestamp || undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at || undefined,
  };
}
