import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { StorageSource, StorageFile, DownloadTask, DownloadBatch, ScanMetrics, HierarchyFolder, HierarchyBreadcrumb, HierarchyResponse } from './types.js';

const DB_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const dbPath = path.join(DB_DIR, 'cdn_buddy.db');
export const db = new Database(dbPath);

// Enable WAL mode for high concurrency
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    bucket TEXT NOT NULL,
    region TEXT,
    access_key TEXT,
    secret_key TEXT,
    force_path_style INTEGER DEFAULT 0,
    cdn_url TEXT,
    local_path TEXT NOT NULL,
    read_only INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_scanned_at INTEGER,
    scan_status TEXT DEFAULT 'idle',
    total_files INTEGER DEFAULT 0,
    total_size INTEGER DEFAULT 0,
    total_video_duration REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    key TEXT NOT NULL,
    size INTEGER NOT NULL,
    etag TEXT,
    last_modified INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    extension TEXT NOT NULL,
    category TEXT NOT NULL,
    duration REAL DEFAULT 0,
    width INTEGER,
    height INTEGER,
    codec TEXT,
    bitrate INTEGER,
    local_status TEXT DEFAULT 'missing',
    local_size INTEGER,
    local_mtime INTEGER,
    scanned_at INTEGER NOT NULL,
    FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_files_source ON files(source_id);
  CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);
  CREATE INDEX IF NOT EXISTS idx_files_size ON files(size);
  CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(last_modified);
  CREATE INDEX IF NOT EXISTS idx_files_duration ON files(duration);
  CREATE INDEX IF NOT EXISTS idx_files_key ON files(key);

  CREATE TABLE IF NOT EXISTS download_tasks (
    id TEXT PRIMARY KEY,
    batch_id TEXT,
    source_id TEXT NOT NULL,
    file_key TEXT NOT NULL,
    destination_path TEXT NOT NULL,
    size INTEGER NOT NULL,
    bytes_downloaded INTEGER DEFAULT 0,
    speed_bps INTEGER DEFAULT 0,
    status TEXT DEFAULT 'queued',
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_downloads_status ON download_tasks(status);

  CREATE TABLE IF NOT EXISTS download_batches (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    type TEXT NOT NULL,
    start_date INTEGER,
    end_date INTEGER,
    files_count INTEGER DEFAULT 0,
    total_size INTEGER DEFAULT 0,
    bytes_downloaded INTEGER DEFAULT 0,
    status TEXT DEFAULT 'queued',
    checkpoint_applied INTEGER DEFAULT 0,
    checkpoint_timestamp INTEGER,
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_batches_source ON download_batches(source_id);
  CREATE INDEX IF NOT EXISTS idx_batches_created ON download_batches(created_at);

  CREATE TABLE IF NOT EXISTS scan_history (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    status TEXT NOT NULL,
    files_count INTEGER DEFAULT 0,
    total_size INTEGER DEFAULT 0,
    video_duration_seconds REAL DEFAULT 0,
    metrics_json TEXT,
    error TEXT
  );
`);

// Safe migrations for existing SQLite databases
try { db.exec('ALTER TABLE sources ADD COLUMN last_checkpoint_mtime INTEGER;'); } catch {}
try { db.exec('ALTER TABLE download_tasks ADD COLUMN batch_id TEXT;'); } catch {}
try { db.exec('ALTER TABLE download_tasks ADD COLUMN completed_at INTEGER;'); } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_downloads_batch ON download_tasks(batch_id);'); } catch {}



// Repository helpers
export const sourceRepo = {
  getAll(): StorageSource[] {
    const rows = db.prepare('SELECT * FROM sources ORDER BY created_at ASC').all() as any[];
    return rows.map(mapSourceRow);
  },

  getById(id: string): StorageSource | null {
    const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as any;
    return row ? mapSourceRow(row) : null;
  },

  insert(source: StorageSource): void {
    const stmt = db.prepare(`
      INSERT INTO sources (
        id, name, provider, endpoint, bucket, region, access_key, secret_key,
        force_path_style, cdn_url, local_path, read_only, created_at, updated_at,
        last_scanned_at, scan_status, total_files, total_size, total_video_duration,
        last_checkpoint_mtime
      ) VALUES (
        @id, @name, @provider, @endpoint, @bucket, @region, @accessKey, @secretKey,
        @forcePathStyle, @cdnUrl, @localPath, @readOnly, @createdAt, @updatedAt,
        @lastScannedAt, @scanStatus, @totalFiles, @totalSize, @totalVideoDuration,
        @lastCheckpointMtime
      )
    `);
    stmt.run({
      ...source,
      forcePathStyle: source.forcePathStyle ? 1 : 0,
      readOnly: source.readOnly ? 1 : 0,
      accessKey: source.accessKey || '',
      secretKey: source.secretKey || '',
      region: source.region || '',
      cdnUrl: source.cdnUrl || '',
      lastScannedAt: source.lastScannedAt || null,
      lastCheckpointMtime: source.lastCheckpointMtime || null,
    });
  },

  update(source: StorageSource): void {
    const stmt = db.prepare(`
      UPDATE sources SET
        name = @name,
        provider = @provider,
        endpoint = @endpoint,
        bucket = @bucket,
        region = @region,
        access_key = @accessKey,
        secret_key = @secretKey,
        force_path_style = @forcePathStyle,
        cdn_url = @cdnUrl,
        local_path = @localPath,
        read_only = @readOnly,
        updated_at = @updatedAt,
        last_scanned_at = @lastScannedAt,
        scan_status = @scanStatus,
        total_files = @totalFiles,
        total_size = @totalSize,
        total_video_duration = @totalVideoDuration,
        last_checkpoint_mtime = @lastCheckpointMtime
      WHERE id = @id
    `);
    stmt.run({
      ...source,
      forcePathStyle: source.forcePathStyle ? 1 : 0,
      readOnly: source.readOnly ? 1 : 0,
      accessKey: source.accessKey || '',
      secretKey: source.secretKey || '',
      region: source.region || '',
      cdnUrl: source.cdnUrl || '',
      lastScannedAt: source.lastScannedAt || null,
      lastCheckpointMtime: source.lastCheckpointMtime || null,
    });
  },

  updateCheckpoint(id: string, timestamp: number): void {
    db.prepare('UPDATE sources SET last_checkpoint_mtime = ?, updated_at = ? WHERE id = ?')
      .run(timestamp, Date.now(), id);
  },

  updateScanStatus(id: string, status: StorageSource['scanStatus'], lastScannedAt?: number): void {
    if (lastScannedAt) {
      db.prepare('UPDATE sources SET scan_status = ?, last_scanned_at = ?, updated_at = ? WHERE id = ?')
        .run(status, lastScannedAt, Date.now(), id);
    } else {
      db.prepare('UPDATE sources SET scan_status = ?, updated_at = ? WHERE id = ?')
        .run(status, Date.now(), id);
    }
  },

  delete(id: string): void {
    db.prepare('DELETE FROM files WHERE source_id = ?').run(id);
    db.prepare('DELETE FROM download_tasks WHERE source_id = ?').run(id);
    db.prepare('DELETE FROM scan_history WHERE source_id = ?').run(id);
    db.prepare('DELETE FROM sources WHERE id = ?').run(id);
  },
};

export const fileRepo = {
  getBySource(
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
  ): { files: StorageFile[]; total: number } {
    const {
      category,
      search,
      startDate,
      endDate,
      limit = 100,
      offset = 0,
      sortBy = 'key',
      sortOrder = 'ASC',
      prefix,
    } = options;

    let whereClause = 'WHERE source_id = ?';
    const params: any[] = [sourceId];

    if (category && category !== 'all') {
      whereClause += ' AND category = ?';
      params.push(category);
    }

    if (search) {
      whereClause += ' AND key LIKE ?';
      params.push(`%${search}%`);
    }

    if (prefix) {
      whereClause += ' AND key LIKE ?';
      params.push(`${prefix}%`);
    }

    if (startDate !== undefined) {
      whereClause += ' AND last_modified >= ?';
      params.push(startDate);
    }

    if (endDate !== undefined) {
      whereClause += ' AND last_modified <= ?';
      params.push(endDate);
    }

    const countRow = db.prepare(`SELECT COUNT(*) as count FROM files ${whereClause}`).get(...params) as any;
    const total = countRow ? countRow.count : 0;

    // Validate sortBy column to prevent SQL injection
    const allowedSort = ['key', 'size', 'last_modified', 'duration', 'category', 'extension', 'local_status'];
    const safeSort = allowedSort.includes(sortBy) ? sortBy : 'key';
    const safeOrder = sortOrder === 'DESC' ? 'DESC' : 'ASC';

    const rows = db.prepare(`
      SELECT * FROM files
      ${whereClause}
      ORDER BY ${safeSort} ${safeOrder}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[];

    return {
      files: rows.map(mapFileRow),
      total,
    };
  },

  getByKey(sourceId: string, key: string): StorageFile | null {
    const row = db.prepare('SELECT * FROM files WHERE source_id = ? AND key = ?').get(sourceId, key) as any;
    return row ? mapFileRow(row) : null;
  },

  getHierarchy(
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
  ): HierarchyResponse {
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

    const len = prefix.length;

    // Filter clauses for optional category, search, and date range
    let catClause = '';
    const catParams: any[] = [];
    if (category && category !== 'all') {
      catClause = ' AND category = ?';
      catParams.push(category);
    }

    let searchClause = '';
    const searchParams: any[] = [];
    if (search) {
      searchClause = ' AND key LIKE ?';
      searchParams.push(`%${search}%`);
    }

    let dateClause = '';
    const dateParams: any[] = [];
    if (startDate !== undefined) {
      dateClause += ' AND last_modified >= ?';
      dateParams.push(startDate);
    }
    if (endDate !== undefined) {
      dateClause += ' AND last_modified <= ?';
      dateParams.push(endDate);
    }

    // 1. Folders query
    let folderSql = '';
    const folderParams: any[] = [sourceId];

    if (!prefix) {
      folderSql = `
        SELECT
          SUBSTR(key, 1, INSTR(key, '/') - 1) AS folder_name,
          COUNT(*) as file_count,
          SUM(size) as total_size,
          SUM(duration) as video_duration
        FROM files
        WHERE source_id = ? AND INSTR(key, '/') > 0 ${catClause} ${searchClause} ${dateClause}
        GROUP BY folder_name
        ORDER BY folder_name ASC
      `;
    } else {
      folderSql = `
        SELECT
          SUBSTR(SUBSTR(key, ${len + 1}), 1, INSTR(SUBSTR(key, ${len + 1}), '/') - 1) AS folder_name,
          COUNT(*) as file_count,
          SUM(size) as total_size,
          SUM(duration) as video_duration
        FROM files
        WHERE source_id = ? AND key LIKE ? AND INSTR(SUBSTR(key, ${len + 1}), '/') > 0 ${catClause} ${searchClause} ${dateClause}
        GROUP BY folder_name
        ORDER BY folder_name ASC
      `;
      folderParams.push(`${prefix}%`);
    }

    folderParams.push(...catParams, ...searchParams, ...dateParams);
    const folderRows = db.prepare(folderSql).all(...folderParams) as any[];

    const folders: HierarchyFolder[] = folderRows
      .filter((r) => r.folder_name)
      .map((r) => ({
        name: r.folder_name,
        prefix: `${prefix}${r.folder_name}/`,
        fileCount: Number(r.file_count || 0),
        totalSize: Number(r.total_size || 0),
        videoDuration: Number(r.video_duration || 0),
      }));

    // 2. Immediate files query
    let fileSql = '';
    let countSql = '';
    const fileParams: any[] = [sourceId];

    const allowedSort = ['key', 'size', 'last_modified', 'duration', 'category', 'extension', 'local_status'];
    const safeSort = allowedSort.includes(sortBy) ? sortBy : 'key';
    const safeOrder = sortOrder === 'DESC' ? 'DESC' : 'ASC';

    if (!prefix) {
      countSql = `SELECT COUNT(*) as count FROM files WHERE source_id = ? AND INSTR(key, '/') = 0 ${catClause} ${searchClause} ${dateClause}`;
      fileSql = `
        SELECT * FROM files
        WHERE source_id = ? AND INSTR(key, '/') = 0 ${catClause} ${searchClause} ${dateClause}
        ORDER BY ${safeSort} ${safeOrder}
        LIMIT ? OFFSET ?
      `;
    } else {
      countSql = `SELECT COUNT(*) as count FROM files WHERE source_id = ? AND key LIKE ? AND INSTR(SUBSTR(key, ${len + 1}), '/') = 0 ${catClause} ${searchClause} ${dateClause}`;
      fileSql = `
        SELECT * FROM files
        WHERE source_id = ? AND key LIKE ? AND INSTR(SUBSTR(key, ${len + 1}), '/') = 0 ${catClause} ${searchClause} ${dateClause}
        ORDER BY ${safeSort} ${safeOrder}
        LIMIT ? OFFSET ?
      `;
      fileParams.push(`${prefix}%`);
    }

    const countParams = [...fileParams, ...catParams, ...searchParams, ...dateParams];
    const totalFilesRow = db.prepare(countSql).get(...countParams) as any;
    const totalFiles = totalFilesRow ? totalFilesRow.count : 0;

    const queryParams = [...fileParams, ...catParams, ...searchParams, ...dateParams, limit, offset];
    const fileRows = db.prepare(fileSql).all(...queryParams) as any[];
    const files: StorageFile[] = fileRows.map(mapFileRow);

    const totalSize = folders.reduce((acc, f) => acc + f.totalSize, 0) + files.reduce((acc, f) => acc + f.size, 0);

    return {
      currentPrefix: prefix,
      parentPrefix,
      breadcrumbs,
      folders,
      files,
      totalFolders: folders.length,
      totalFiles,
      totalSize,
    };
  },

  upsertBatch(files: StorageFile[]): void {
    if (files.length === 0) return;
    const insertStmt = db.prepare(`
      INSERT INTO files (
        id, source_id, key, size, etag, last_modified, content_type,
        extension, category, duration, width, height, codec, bitrate,
        local_status, local_size, local_mtime, scanned_at
      ) VALUES (
        @id, @sourceId, @key, @size, @etag, @lastModified, @contentType,
        @extension, @category, @duration, @width, @height, @codec, @bitrate,
        @localStatus, @localSize, @localMtime, @scannedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        size = excluded.size,
        etag = excluded.etag,
        last_modified = excluded.last_modified,
        content_type = excluded.content_type,
        extension = excluded.extension,
        category = excluded.category,
        duration = CASE WHEN excluded.duration > 0 THEN excluded.duration ELSE files.duration END,
        width = CASE WHEN excluded.width IS NOT NULL THEN excluded.width ELSE files.width END,
        height = CASE WHEN excluded.height IS NOT NULL THEN excluded.height ELSE files.height END,
        codec = CASE WHEN excluded.codec IS NOT NULL THEN excluded.codec ELSE files.codec END,
        bitrate = CASE WHEN excluded.bitrate IS NOT NULL THEN excluded.bitrate ELSE files.bitrate END,
        local_status = excluded.local_status,
        local_size = excluded.local_size,
        local_mtime = excluded.local_mtime,
        scanned_at = excluded.scanned_at
    `);

    const transaction = db.transaction((items: StorageFile[]) => {
      for (const item of items) {
        insertStmt.run({
          ...item,
          duration: item.duration || 0,
          width: item.width ?? null,
          height: item.height ?? null,
          codec: item.codec ?? null,
          bitrate: item.bitrate ?? null,
          localSize: item.localSize ?? null,
          localMtime: item.localMtime ?? null,
        });
      }
    });

    transaction(files);
  },

  updateLocalStatus(id: string, status: StorageFile['localStatus'], size?: number, mtime?: number): void {
    db.prepare('UPDATE files SET local_status = ?, local_size = ?, local_mtime = ? WHERE id = ?')
      .run(status, size ?? null, mtime ?? null, id);
  },

  getByDateRange(
    sourceId: string,
    options: { startDate?: number; endDate?: number; onlyMissing?: boolean } = {}
  ): StorageFile[] {
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
    const rows = db.prepare(sql).all(...params) as any[];
    return rows.map(mapFileRow);
  },

  deleteMissingFiles(sourceId: string, currentKeys: string[]): void {
    // If scanning a full bucket, remove files no longer present
    if (currentKeys.length === 0) return;
    const placeholders = currentKeys.map(() => '?').join(',');
    db.prepare(`DELETE FROM files WHERE source_id = ? AND key NOT IN (${placeholders})`).run(sourceId, ...currentKeys);
  },
};

export const downloadRepo = {
  createBatch(batch: DownloadBatch): void {
    db.prepare(`
      INSERT INTO download_batches (
        id, source_id, source_name, type, start_date, end_date, files_count,
        total_size, bytes_downloaded, status, checkpoint_applied, checkpoint_timestamp,
        created_at, completed_at
      ) VALUES (
        @id, @sourceId, @sourceName, @type, @startDate, @endDate, @filesCount,
        @totalSize, @bytesDownloaded, @status, @checkpointApplied, @checkpointTimestamp,
        @createdAt, @completedAt
      )
    `).run({
      ...batch,
      startDate: batch.startDate || null,
      endDate: batch.endDate || null,
      checkpointApplied: batch.checkpointApplied ? 1 : 0,
      checkpointTimestamp: batch.checkpointTimestamp || null,
      completedAt: batch.completedAt || null,
    });
  },

  updateBatch(id: string, updates: Partial<DownloadBatch>): void {
    const fields: string[] = [];
    const params: any = { id };
    if (updates.status !== undefined) { fields.push('status = @status'); params.status = updates.status; }
    if (updates.bytesDownloaded !== undefined) { fields.push('bytes_downloaded = @bytesDownloaded'); params.bytesDownloaded = updates.bytesDownloaded; }
    if (updates.completedAt !== undefined) { fields.push('completed_at = @completedAt'); params.completedAt = updates.completedAt; }
    if (fields.length > 0) {
      db.prepare(`UPDATE download_batches SET ${fields.join(', ')} WHERE id = @id`).run(params);
    }
  },

  updateBatchProgress(batchId: string): void {
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(size) as total_size,
        SUM(bytes_downloaded) as downloaded,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
        SUM(CASE WHEN status = 'downloading' THEN 1 ELSE 0 END) as downloading_count
      FROM download_tasks
      WHERE batch_id = ?
    `).get(batchId) as any;

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

    db.prepare(`
      UPDATE download_batches
      SET bytes_downloaded = ?, status = ?, completed_at = COALESCE(completed_at, ?)
      WHERE id = ?
    `).run(stats.downloaded || 0, status, completedAt, batchId);
  },

  getBatches(sourceId?: string, limit: number = 50): DownloadBatch[] {
    let sql = 'SELECT * FROM download_batches';
    const params: any[] = [];
    if (sourceId) {
      sql += ' WHERE source_id = ?';
      params.push(sourceId);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    const rows = db.prepare(sql).all(...params) as any[];
    return rows.map(mapBatchRow);
  },

  getBatchById(id: string): DownloadBatch | null {
    const row = db.prepare('SELECT * FROM download_batches WHERE id = ?').get(id) as any;
    return row ? mapBatchRow(row) : null;
  },

  getBatchTasks(batchId: string): DownloadTask[] {
    const rows = db.prepare('SELECT * FROM download_tasks WHERE batch_id = ? ORDER BY created_at ASC').all(batchId) as any[];
    return rows.map(mapDownloadRow);
  },

  create(task: DownloadTask): void {
    db.prepare(`
      INSERT INTO download_tasks (
        id, batch_id, source_id, file_key, destination_path, size, bytes_downloaded,
        speed_bps, status, error, created_at, updated_at, completed_at
      ) VALUES (
        @id, @batchId, @sourceId, @fileKey, @destinationPath, @size, @bytesDownloaded,
        @speedBps, @status, @error, @createdAt, @updatedAt, @completedAt
      )
    `).run({
      ...task,
      batchId: task.batchId || null,
      error: task.error || null,
      completedAt: task.completedAt || null,
    });
  },

  updateProgress(id: string, bytesDownloaded: number, speedBps: number, status?: DownloadTask['status']): void {
    if (status) {
      db.prepare(`
        UPDATE download_tasks
        SET bytes_downloaded = ?, speed_bps = ?, status = ?, updated_at = ?
        WHERE id = ?
      `).run(bytesDownloaded, speedBps, status, Date.now(), id);
    } else {
      db.prepare(`
        UPDATE download_tasks
        SET bytes_downloaded = ?, speed_bps = ?, updated_at = ?
        WHERE id = ?
      `).run(bytesDownloaded, speedBps, Date.now(), id);
    }
  },

  finish(id: string, status: 'completed' | 'failed', error?: string): void {
    const task = db.prepare('SELECT batch_id FROM download_tasks WHERE id = ?').get(id) as any;
    db.prepare(`
      UPDATE download_tasks
      SET status = ?, error = ?, speed_bps = 0, updated_at = ?, completed_at = ?
      WHERE id = ?
    `).run(status, error || null, Date.now(), Date.now(), id);

    if (task && task.batch_id) {
      this.updateBatchProgress(task.batch_id);
    }
  },

  getAll(): DownloadTask[] {
    const rows = db.prepare('SELECT * FROM download_tasks ORDER BY created_at DESC LIMIT 100').all() as any[];
    return rows.map(mapDownloadRow);
  },

  getBySource(sourceId: string): DownloadTask[] {
    const rows = db.prepare('SELECT * FROM download_tasks WHERE source_id = ? ORDER BY created_at DESC LIMIT 50').all(sourceId) as any[];
    return rows.map(mapDownloadRow);
  },

  getHistory(options: { sourceId?: string; search?: string; status?: string; limit?: number; offset?: number } = {}): { tasks: DownloadTask[]; total: number } {
    const { sourceId, search, status, limit = 50, offset = 0 } = options;
    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (sourceId) { where += ' AND source_id = ?'; params.push(sourceId); }
    if (status) { where += ' AND status = ?'; params.push(status); }
    if (search) { where += ' AND file_key LIKE ?'; params.push(`%${search}%`); }

    const countRow = db.prepare(`SELECT COUNT(*) as count FROM download_tasks ${where}`).get(...params) as any;
    const total = countRow ? countRow.count : 0;

    const rows = db.prepare(`SELECT * FROM download_tasks ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as any[];
    return { tasks: rows.map(mapDownloadRow), total };
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

function mapFileRow(row: any): StorageFile {
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
