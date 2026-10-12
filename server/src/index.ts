import express, { Request, Response } from 'express';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import mime from 'mime-types';
import { db, sourceRepo, fileRepo, downloadRepo } from './db.js';
import { storageService } from './services/storageService.js';
import { scannerService } from './services/scannerService.js';
import { metricsService } from './services/metricsService.js';
import { downloadService } from './services/downloadService.js';
import { StorageSource, DownloadBatch } from './types.js';
import { BadRequestError, NotFoundError } from './errors.js';

const app = express();
const server = http.createServer(app);

// The bundled client is served same-origin (or via the Vite dev proxy), so only explicitly
// allowed origins may call the API cross-origin. This server writes to the local disk, so an
// open CORS policy would let any visited web page trigger downloads into arbitrary folders.
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
);

/** Requests without an Origin (non-browser clients) or from the serving host itself are trusted */
function isOriginAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)) }));

// Block cross-site state-changing requests, including CORS "simple" requests that skip preflight
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (isOriginAllowed(req.headers.origin, req.headers.host)) return next();
  res.status(403).json({ error: 'Origin not allowed' });
});

// WebSockets ignore CORS, so check the Origin on the handshake to keep other sites from
// subscribing to scan and download events
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: ({ origin, req }: { origin: string; req: http.IncomingMessage }) =>
    isOriginAllowed(origin, req.headers.host),
});

app.use(express.json());

// Broadcast to WebSocket clients
const clients = new Set<WebSocket>();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

function broadcastWs(type: string, data: any) {
  const message = JSON.stringify({ type, data });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Hook scanner and download events into WebSocket broadcast
scannerService.onProgress((event) => {
  broadcastWs('scan:progress', event);
});

downloadService.onProgress((event) => {
  broadcastWs('download:progress', event);
});

const paramId = (req: Request): string => (Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) || '';

const sendError = (res: Response, err: any) => {
  const status = err instanceof BadRequestError ? 400 : err instanceof NotFoundError ? 404 : 500;
  res.status(status).json({ error: err.message });
};

/**
 * Normalize a user-supplied directory path. Empty/missing → undefined; otherwise an absolute path.
 */
function parseDirectoryPath(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new BadRequestError(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('\0')) throw new BadRequestError(`${field} contains invalid characters`);
  return path.resolve(trimmed);
}

/**
 * Locate an already-downloaded copy of a file: the source's default directory first,
 * then the path recorded when it was downloaded to a custom location.
 */
function findLocalCopy(source: StorageSource, key: string): string | undefined {
  const candidates = [
    source.localPath ? path.join(source.localPath, key) : undefined,
    fileRepo.getByKey(source.id, key)?.localFilePath,
  ];
  return candidates.find((p): p is string => Boolean(p) && fs.existsSync(p!));
}

// ---------------- API ROUTES ----------------

// 1. Sources CRUD
app.get('/api/sources', (_req: Request, res: Response) => {
  try {
    const sources = sourceRepo.getAll();
    res.json(sources);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sources/:id', (req: Request, res: Response) => {
  try {
    const source = sourceRepo.getById(paramId(req));
    if (!source) return res.status(404).json({ error: 'Source not found' });
    res.json(source);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sources', (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data.name || !data.bucket || !data.provider) {
      return res.status(400).json({ error: 'Name, provider, and bucket are required' });
    }

    const defaultLocalPath = parseDirectoryPath(data.localPath, 'localPath') || '';
    if (defaultLocalPath && !fs.existsSync(defaultLocalPath)) {
      try { fs.mkdirSync(defaultLocalPath, { recursive: true }); } catch {}
    }

    const newSource: StorageSource = {
      id: `src-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: data.name,
      provider: data.provider,
      endpoint: data.endpoint || '',
      bucket: data.bucket,
      region: data.region || 'us-east-1',
      accessKey: data.accessKey || '',
      secretKey: data.secretKey || '',
      forcePathStyle: Boolean(data.forcePathStyle),
      cdnUrl: data.cdnUrl || '',
      localPath: defaultLocalPath,
      readOnly: data.readOnly !== false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scanStatus: 'idle',
      totalFiles: 0,
      totalSize: 0,
      totalVideoDuration: 0,
    };

    sourceRepo.insert(newSource);
    res.status(201).json(newSource);
  } catch (err: any) {
    sendError(res, err);
  }
});

app.put('/api/sources/:id', (req: Request, res: Response) => {
  try {
    const existing = sourceRepo.getById(paramId(req));
    if (!existing) return res.status(404).json({ error: 'Source not found' });

    const data = req.body;
    const updated: StorageSource = {
      ...existing,
      name: data.name ?? existing.name,
      provider: data.provider ?? existing.provider,
      endpoint: data.endpoint ?? existing.endpoint,
      bucket: data.bucket ?? existing.bucket,
      region: data.region ?? existing.region,
      accessKey: data.accessKey ?? existing.accessKey,
      secretKey: data.secretKey ?? existing.secretKey,
      forcePathStyle: data.forcePathStyle !== undefined ? Boolean(data.forcePathStyle) : existing.forcePathStyle,
      cdnUrl: data.cdnUrl ?? existing.cdnUrl,
      localPath:
        data.localPath === undefined ? existing.localPath : parseDirectoryPath(data.localPath, 'localPath') || '',
      readOnly: data.readOnly !== undefined ? Boolean(data.readOnly) : existing.readOnly,
      updatedAt: Date.now(),
    };

    if (updated.localPath && !fs.existsSync(updated.localPath)) {
      try { fs.mkdirSync(updated.localPath, { recursive: true }); } catch {}
    }

    sourceRepo.update(updated);
    res.json(updated);
  } catch (err: any) {
    sendError(res, err);
  }
});

app.delete('/api/sources/:id', (req: Request, res: Response) => {
  try {
    sourceRepo.delete(paramId(req));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Test storage connection before saving
app.post('/api/sources/test', async (req: Request, res: Response) => {
  try {
    const sourceData: StorageSource = {
      id: 'test',
      name: req.body.name || 'test',
      provider: req.body.provider,
      endpoint: req.body.endpoint,
      bucket: req.body.bucket,
      region: req.body.region,
      accessKey: req.body.accessKey,
      secretKey: req.body.secretKey,
      forcePathStyle: Boolean(req.body.forcePathStyle),
      localPath: '',
      readOnly: true,
      createdAt: 0,
      updatedAt: 0,
      scanStatus: 'idle',
      totalFiles: 0,
      totalSize: 0,
      totalVideoDuration: 0,
    };

    const result = await storageService.testConnection(sourceData);
    res.json(result);
  } catch (err: any) {
    res.json({ success: false, message: err.message });
  }
});

// 2. Scanner Trigger & Metrics
app.post('/api/sources/:id/scan', async (req: Request, res: Response) => {
  try {
    const source = sourceRepo.getById(paramId(req));
    if (!source) return res.status(404).json({ error: 'Source not found' });

    if (scannerService.isScanning(source.id)) {
      return res.status(409).json({ error: 'Scan already in progress' });
    }

    const deepMediaScan = req.body.deepMediaScan !== false;

    // Launch scan in background
    scannerService.startScan(source, { deepMediaScan }).catch((err) => {
      console.error(`Background scan error for ${source.id}:`, err);
    });

    res.json({ success: true, message: 'Scan started in background' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sources/:id/metrics', (req: Request, res: Response) => {
  try {
    const metrics = metricsService.computeMetrics(paramId(req));
    if (!metrics) return res.status(404).json({ error: 'Source not found' });
    res.json(metrics);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Files Browser & Search
app.get('/api/sources/:id/files', (req: Request, res: Response) => {
  try {
    const { category, search, limit, offset, sortBy, sortOrder, prefix } = req.query;
    const startDate = req.query.startDate ? parseInt(req.query.startDate as string, 10) : undefined;
    const endDate = req.query.endDate ? parseInt(req.query.endDate as string, 10) : undefined;

    const result = fileRepo.getBySource(paramId(req), {
      category: category as string,
      search: search as string,
      startDate,
      endDate,
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0,
      sortBy: sortBy as string,
      sortOrder: (sortOrder as 'ASC' | 'DESC') || 'ASC',
      prefix: prefix as string,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3.1 Hierarchical On-Demand Directory Explorer (Click-to-load folder navigation)
app.get('/api/sources/:id/hierarchy', (req: Request, res: Response) => {
  try {
    const id = paramId(req);
    const prefix = (req.query.prefix as string) || '';
    const category = (req.query.category as string) || 'all';
    const search = (req.query.search as string) || '';
    const startDate = req.query.startDate ? parseInt(req.query.startDate as string, 10) : undefined;
    const endDate = req.query.endDate ? parseInt(req.query.endDate as string, 10) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 200;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const sortBy = (req.query.sortBy as string) || 'key';
    const sortOrder = (req.query.sortOrder as 'ASC' | 'DESC') || 'ASC';

    const source = sourceRepo.getById(id);
    if (!source) {
      return res.status(404).json({ error: 'Source not found' });
    }

    const hierarchy = fileRepo.getHierarchy(id, {
      prefix,
      category,
      search,
      startDate,
      endDate,
      limit,
      offset,
      sortBy,
      sortOrder,
    });

    res.json(hierarchy);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3.2 Download entire folder with preserved folder structure
app.post('/api/sources/:id/download-folder', (req: Request, res: Response) => {
  try {
    const id = paramId(req);
    const { folderPrefix = '', onlyMissing = true, destinationDir } = req.body;

    const source = sourceRepo.getById(id);
    if (!source) {
      return res.status(404).json({ error: 'Source not found' });
    }

    const { batch, tasks } = downloadService.enqueueFolder(
      id,
      folderPrefix,
      Boolean(onlyMissing),
      parseDirectoryPath(destinationDir, 'destinationDir')
    );
    res.json({ batch, tasksCount: tasks.length });
  } catch (err: any) {
    sendError(res, err);
  }
});

// 4. File Streaming & Range Proxy (Supports seamless Video/Audio seeking & Image preview)
app.get('/api/sources/:id/stream', async (req: Request, res: Response) => {
  try {
    const source = sourceRepo.getById(paramId(req));
    if (!source) return res.status(404).send('Source not found');

    const key = req.query.key as string;
    if (!key) return res.status(400).send('File key is required');

    // Check if file is already on local on-premise disk
    const localFilePath = findLocalCopy(source, key);
    if (localFilePath) {
      return res.sendFile(path.resolve(localFilePath));
    }

    // Stream from S3 with Range headers
    const rangeHeader = req.headers.range;
    const { stream, contentLength, contentType, contentRange, acceptRanges } =
      await storageService.getObjectStream(source, key, rangeHeader);

    const detectedMime = mime.lookup(key) || contentType || 'application/octet-stream';
    res.setHeader('Content-Type', detectedMime);

    if (acceptRanges) {
      res.setHeader('Accept-Ranges', acceptRanges);
    } else {
      res.setHeader('Accept-Ranges', 'bytes');
    }

    if (rangeHeader && contentRange) {
      res.status(206);
      res.setHeader('Content-Range', contentRange);
      if (contentLength !== undefined) {
        res.setHeader('Content-Length', contentLength);
      }
    } else if (contentLength !== undefined) {
      res.setHeader('Content-Length', contentLength);
    }

    stream.pipe(res);
  } catch (err: any) {
    console.error('Stream error:', err);
    res.status(500).send(err.message || 'Error streaming file');
  }
});

// 5. Raw Text / Code Content for preview
app.get('/api/sources/:id/raw', async (req: Request, res: Response) => {
  try {
    const source = sourceRepo.getById(paramId(req));
    if (!source) return res.status(404).send('Source not found');

    const key = req.query.key as string;
    if (!key) return res.status(400).send('Key required');

    // If local exists, read local
    const localFilePath = findLocalCopy(source, key);
    if (localFilePath) {
      const content = fs.readFileSync(localFilePath, 'utf8');
      return res.json({ content });
    }

    // Remote range read up to 256KB for preview
    const buffer = await storageService.getObjectRangeBuffer(source, key, 'bytes=0-262143');
    res.json({ content: buffer.toString('utf8') });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Direct / Presigned URL
app.get('/api/sources/:id/preview-url', async (req: Request, res: Response) => {
  try {
    const source = sourceRepo.getById(paramId(req));
    if (!source) return res.status(404).json({ error: 'Source not found' });

    const key = req.query.key as string;
    if (!key) return res.status(400).json({ error: 'Key required' });

    if (source.cdnUrl) {
      const resolved = storageService.getResolvedUrl(source, key);
      return res.json({ url: resolved, type: 'cdn' });
    }

    const presigned = await storageService.getPresignedUrl(source, key, 3600);
    res.json({ url: presigned, type: 'presigned' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Download Endpoints
app.get('/api/downloads', (_req: Request, res: Response) => {
  try {
    const tasks = downloadRepo.getAll();
    res.json(tasks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/downloads', (req: Request, res: Response) => {
  try {
    const { sourceId, keys, key } = req.body;
    if (!sourceId) return res.status(400).json({ error: 'sourceId required' });
    const destinationDir = parseDirectoryPath(req.body.destinationDir, 'destinationDir');

    if (Array.isArray(keys) && keys.length > 0) {
      const result = downloadService.enqueueBatch(sourceId, keys, destinationDir);
      return res.json(result);
    } else if (key) {
      const task = downloadService.enqueue(sourceId, key, destinationDir);
      return res.json({ task });
    }

    res.status(400).json({ error: 'Provide key or keys array' });
  } catch (err: any) {
    sendError(res, err);
  }
});

app.post('/api/downloads/missing', (req: Request, res: Response) => {
  try {
    const { sourceId, destinationDir } = req.body;
    if (!sourceId) return res.status(400).json({ error: 'sourceId required' });

    const result = downloadService.enqueueAllMissing(
      sourceId,
      parseDirectoryPath(destinationDir, 'destinationDir')
    );
    res.json(result);
  } catch (err: any) {
    sendError(res, err);
  }
});

// System Helper: Suggest clean default on-premise download path per source
app.get('/api/system/default-download-path', (req: Request, res: Response) => {
  try {
    const sourceName = (req.query.sourceName as string) || 'source';
    const sanitized = sourceName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const suggestedPath = path.resolve(process.cwd(), 'downloads', sanitized);
    res.json({ suggestedPath });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Checkpoint & Date Range Downloads
app.get('/api/sources/:id/checkpoint', (req: Request, res: Response) => {
  try {
    const source = sourceRepo.getById(paramId(req));
    if (!source) return res.status(404).json({ error: 'Source not found' });
    res.json({
      lastCheckpointMtime: source.lastCheckpointMtime || null,
      now: Date.now(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sources/:id/checkpoint', (req: Request, res: Response) => {
  try {
    const { timestamp } = req.body;
    sourceRepo.updateCheckpoint(paramId(req), timestamp ? Number(timestamp) : 0);
    res.json({ success: true, timestamp });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sources/:id/date-range-preview', (req: Request, res: Response) => {
  try {
    const { startDate, endDate, onlyMissing } = req.query;
    const files = fileRepo.getByDateRange(paramId(req), {
      startDate: startDate ? parseInt(startDate as string, 10) : undefined,
      endDate: endDate ? parseInt(endDate as string, 10) : undefined,
      onlyMissing: onlyMissing === 'true' || onlyMissing === '1',
    });
    const totalSize = files.reduce((acc, f) => acc + f.size, 0);
    res.json({
      count: files.length,
      totalSize,
      files: files.slice(0, 100),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sources/:id/download-range', (req: Request, res: Response) => {
  try {
    const { startDate, endDate, onlyMissing, updateCheckpoint, destinationDir } = req.body;
    const result = downloadService.enqueueDateRange({
      sourceId: paramId(req),
      startDate: startDate ? Number(startDate) : undefined,
      endDate: endDate ? Number(endDate) : undefined,
      onlyMissing: Boolean(onlyMissing),
      updateCheckpoint: Boolean(updateCheckpoint),
      destinationDir: parseDirectoryPath(destinationDir, 'destinationDir'),
    });
    res.json(result);
  } catch (err: any) {
    sendError(res, err);
  }
});

// Download Action History (Batches & Tasks)
app.get('/api/history/batches', (req: Request, res: Response) => {
  try {
    const { sourceId, limit } = req.query;
    const batches = downloadRepo.getBatches(
      sourceId as string,
      limit ? parseInt(limit as string, 10) : 50
    );
    res.json(batches);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history/batches/:id', (req: Request, res: Response) => {
  try {
    const batch = downloadRepo.getBatchById(paramId(req));
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    const tasks = downloadRepo.getBatchTasks(paramId(req));
    res.json({ batch, tasks });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history/tasks', (req: Request, res: Response) => {
  try {
    const { sourceId, search, status, limit, offset } = req.query;
    const result = downloadRepo.getHistory({
      sourceId: sourceId as string,
      search: search as string,
      status: status as string,
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/downloads/:id/cancel', (req: Request, res: Response) => {
  try {
    const success = downloadService.cancel(paramId(req));
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Demo Seed Helper (Allows immediate interactive trial with realistic mock CDN assets)
app.post('/api/demo/seed', (_req: Request, res: Response) => {
  try {
    const demoSourceId = 'demo-cdn-store';
    let demoSource = sourceRepo.getById(demoSourceId);

    const downloadsDir = path.resolve(process.cwd(), 'downloads', 'demo-cdn-store');
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true });
    }

    if (!demoSource) {
      demoSource = {
        id: demoSourceId,
        name: 'Global Edge Video & Media CDN',
        provider: 'r2',
        endpoint: 'https://demo-account.r2.cloudflarestorage.com',
        bucket: 'media-assets-prod',
        region: 'auto',
        cdnUrl: 'https://media.globaledge-cdn.net',
        localPath: downloadsDir,
        readOnly: true,
        createdAt: Date.now() - 30 * 86400000,
        updatedAt: Date.now(),
        scanStatus: 'completed',
        totalFiles: 0,
        totalSize: 0,
        totalVideoDuration: 0,
      };
      sourceRepo.insert(demoSource);
    }

    // Populate realistic sample files across categories and video durations
    const sampleFiles: Array<any> = [
      // Videos (varying durations: shorts, standard, 4k movies)
      {
        key: 'videos/2026/keynote-product-launch-4k.mp4',
        size: 4294967296, // 4 GB
        duration: 5430, // 1h 30m 30s
        width: 3840,
        height: 2160,
        codec: 'hevc',
        bitrate: 6320000,
        lastModified: Date.now() - 2 * 86400000,
        category: 'video',
        extension: 'mp4',
      },
      {
        key: 'videos/courses/module-01-system-architecture.mp4',
        size: 1572864000, // 1.46 GB
        duration: 2840, // 47m 20s
        width: 1920,
        height: 1080,
        codec: 'h264',
        bitrate: 4430000,
        lastModified: Date.now() - 12 * 86400000,
        category: 'video',
        extension: 'mp4',
      },
      {
        key: 'videos/courses/module-02-distributed-caching.mkv',
        size: 1932735283, // 1.8 GB
        duration: 3510, // 58m 30s
        width: 1920,
        height: 1080,
        codec: 'h264',
        bitrate: 4400000,
        lastModified: Date.now() - 10 * 86400000,
        category: 'video',
        extension: 'mkv',
      },
      {
        key: 'videos/ads/summer-promo-teaser-30s.mp4',
        size: 68157440, // 65 MB
        duration: 30, // 30s
        width: 3840,
        height: 2160,
        codec: 'hevc',
        bitrate: 18000000,
        lastModified: Date.now() - 5 * 86400000,
        category: 'video',
        extension: 'mp4',
      },
      {
        key: 'videos/shorts/feature-highlight-reel.webm',
        size: 36700160, // 35 MB
        duration: 48, // 48s
        width: 1080,
        height: 1920,
        codec: 'vp9',
        bitrate: 6100000,
        lastModified: Date.now() - 1 * 86400000,
        category: 'video',
        extension: 'webm',
      },
      {
        key: 'videos/interviews/cto-fireside-chat.mp4',
        size: 2791728742, // 2.6 GB
        duration: 4920, // 1h 22m
        width: 2560,
        height: 1440,
        codec: 'h264',
        bitrate: 4500000,
        lastModified: Date.now() - 25 * 86400000,
        category: 'video',
        extension: 'mp4',
      },
      {
        key: 'videos/tutorials/onboarding-walkthrough.mp4',
        size: 429916160, // 410 MB
        duration: 720, // 12 mins
        width: 1920,
        height: 1080,
        codec: 'h264',
        bitrate: 4770000,
        lastModified: Date.now() - 40 * 86400000,
        category: 'video',
        extension: 'mp4',
      },
      {
        key: 'videos/archive/2025-annual-summit-livestream.mov',
        size: 8589934592, // 8 GB
        duration: 10800, // 3h 00m
        width: 1920,
        height: 1080,
        codec: 'prores',
        bitrate: 6360000,
        lastModified: Date.now() - 120 * 86400000,
        category: 'video',
        extension: 'mov',
      },

      // Audio
      {
        key: 'podcasts/ep42-edge-computing-frontiers.mp3',
        size: 89128960, // 85 MB
        duration: 3720, // 1h 2m
        codec: 'mp3',
        bitrate: 192000,
        lastModified: Date.now() - 8 * 86400000,
        category: 'audio',
        extension: 'mp3',
      },
      {
        key: 'audio/soundtracks/hero-ambient-score.wav',
        size: 52428800, // 50 MB
        duration: 195, // 3m 15s
        codec: 'pcm',
        bitrate: 1411200,
        lastModified: Date.now() - 45 * 86400000,
        category: 'audio',
        extension: 'wav',
      },

      // Images
      {
        key: 'images/marketing/hero-banner-ultrawide.webp',
        size: 2450000,
        width: 3840,
        height: 1600,
        lastModified: Date.now() - 4 * 86400000,
        category: 'image',
        extension: 'webp',
      },
      {
        key: 'images/brand/logo-mark-vector.svg',
        size: 34200,
        lastModified: Date.now() - 150 * 86400000,
        category: 'image',
        extension: 'svg',
      },
      {
        key: 'images/photos/datacenter-cluster-hall.jpg',
        size: 8940000,
        width: 6000,
        height: 4000,
        lastModified: Date.now() - 20 * 86400000,
        category: 'image',
        extension: 'jpg',
      },

      // Documents & PDFs
      {
        key: 'docs/specifications/cdn-caching-spec-v3.pdf',
        size: 14200000,
        lastModified: Date.now() - 15 * 86400000,
        category: 'document',
        extension: 'pdf',
      },
      {
        key: 'docs/reports/quarterly-bandwidth-analysis.xlsx',
        size: 5120000,
        lastModified: Date.now() - 35 * 86400000,
        category: 'document',
        extension: 'xlsx',
      },

      // Archives
      {
        key: 'backups/database-snapshot-2026-03.tar.gz',
        size: 12884901888, // 12 GB
        lastModified: Date.now() - 3 * 86400000,
        category: 'archive',
        extension: 'tar.gz',
      },

      // Code & Configs
      {
        key: 'config/edge-routing-rules.json',
        size: 45000,
        lastModified: Date.now() - 1 * 86400000,
        category: 'code',
        extension: 'json',
      },
      {
        key: 'scripts/cache-purge-invalidation.py',
        size: 12500,
        lastModified: Date.now() - 60 * 86400000,
        category: 'code',
        extension: 'py',
      },
    ];

    const toInsert = sampleFiles.map((sf, index) => {
      // Simulate that a couple of files are already downloaded to on-prem box
      const isSynced = index === 1 || index === 3;
      return {
        id: `${demoSourceId}:${sf.key}`,
        sourceId: demoSourceId,
        key: sf.key,
        size: sf.size,
        etag: `etag-${Math.random().toString(36).substring(2, 9)}`,
        lastModified: sf.lastModified,
        contentType: sf.category === 'video' ? `video/${sf.extension}` : `application/${sf.extension}`,
        extension: sf.extension,
        category: sf.category,
        duration: sf.duration || 0,
        width: sf.width,
        height: sf.height,
        codec: sf.codec,
        bitrate: sf.bitrate,
        localStatus: isSynced ? 'synced' : 'missing',
        localSize: isSynced ? sf.size : undefined,
        localMtime: isSynced ? sf.lastModified : undefined,
        scannedAt: Date.now(),
      };
    });

    fileRepo.upsertBatch(toInsert as any);

    const totalFiles = toInsert.length;
    const totalSize = toInsert.reduce((acc, f) => acc + f.size, 0);
    const totalVideoDuration = toInsert.reduce((acc, f) => acc + (f.duration || 0), 0);

    const updated = {
      ...demoSource,
      totalFiles,
      totalSize,
      totalVideoDuration,
      lastScannedAt: Date.now(),
      scanStatus: 'completed' as const,
      updatedAt: Date.now(),
    };
    sourceRepo.update(updated);

    res.json({ success: true, message: 'Demo CDN library seeded successfully', source: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend static build if present
const CLIENT_DIST = path.resolve(process.cwd(), 'client', 'dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.use((req: Request, res: Response, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
      return res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    }
    next();
  });
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[Reelhouse Server] Running at http://localhost:${PORT}`);
  console.log(`[Reelhouse Server] WebSocket ready at ws://localhost:${PORT}/ws`);
});
