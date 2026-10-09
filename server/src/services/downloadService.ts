import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { storageService } from './storageService.js';
import { sourceRepo, fileRepo, downloadRepo } from '../db.js';
import { DownloadTask, DownloadBatch, DateRangeDownloadRequest, StorageSource } from '../types.js';

export interface DownloadProgressEvent {
  taskId: string;
  batchId?: string;
  sourceId: string;
  fileKey: string;
  bytesDownloaded: number;
  totalSize: number;
  speedBps: number;
  status: DownloadTask['status'];
  error?: string;
}

export type DownloadProgressCallback = (event: DownloadProgressEvent) => void;

export class DownloadService {
  private queue: DownloadTask[] = [];
  private activeCount = 0;
  private maxConcurrency = 3;
  private listeners: DownloadProgressCallback[] = [];
  private abortControllers = new Map<string, AbortController>();

  public onProgress(cb: DownloadProgressCallback): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private broadcast(event: DownloadProgressEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in download listener:', err);
      }
    }
  }

  /**
   * Enqueue a single file download, preserving folder structure
   */
  public enqueue(
    sourceId: string,
    fileKey: string,
    customDestDir?: string,
    batchId?: string
  ): DownloadTask {
    const source = sourceRepo.getById(sourceId);
    if (!source) throw new Error('Source not found');

    const file = fileRepo.getByKey(sourceId, fileKey);
    const size = file ? file.size : 0;

    const baseDir = customDestDir || source.localPath || path.join(process.cwd(), 'downloads', source.name);
    // Robust folder structure preservation: remove leading slashes and map path segments
    const normalizedRelativePath = fileKey.replace(/^[/\\]+/, '').split('/').join(path.sep);
    const destinationPath = path.resolve(baseDir, normalizedRelativePath);

    const taskId = `dl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const task: DownloadTask = {
      id: taskId,
      batchId,
      sourceId,
      fileKey,
      destinationPath,
      size,
      bytesDownloaded: 0,
      speedBps: 0,
      status: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    downloadRepo.create(task);
    this.queue.push(task);
    this.broadcast({
      taskId: task.id,
      batchId: task.batchId,
      sourceId: task.sourceId,
      fileKey: task.fileKey,
      bytesDownloaded: 0,
      totalSize: task.size,
      speedBps: 0,
      status: 'queued',
    });

    this.processQueue();
    return task;
  }

  /**
   * Enqueue a batch of file keys, logging the session batch
   */
  public enqueueBatch(
    sourceId: string,
    fileKeys: string[],
    customDestDir?: string
  ): { batch: DownloadBatch; tasks: DownloadTask[] } {
    const source = sourceRepo.getById(sourceId);
    if (!source) throw new Error('Source not found');

    const batchId = `batch-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    let totalSize = 0;
    for (const key of fileKeys) {
      const file = fileRepo.getByKey(sourceId, key);
      if (file) totalSize += file.size;
    }

    const batch: DownloadBatch = {
      id: batchId,
      sourceId: source.id,
      sourceName: source.name,
      type: 'manual_batch',
      filesCount: fileKeys.length,
      totalSize,
      bytesDownloaded: 0,
      status: fileKeys.length === 0 ? 'completed' : 'queued',
      checkpointApplied: false,
      createdAt: Date.now(),
      completedAt: fileKeys.length === 0 ? Date.now() : undefined,
    };

    downloadRepo.createBatch(batch);

    const tasks = fileKeys.map((key) => this.enqueue(sourceId, key, customDestDir, batchId));
    return { batch, tasks };
  }

  /**
   * Enqueue download based on date range, creating checkpoint and session history
   */
  public enqueueDateRange(
    options: DateRangeDownloadRequest
  ): { batch: DownloadBatch; tasks: DownloadTask[] } {
    const source = sourceRepo.getById(options.sourceId);
    if (!source) throw new Error('Source not found');

    const files = fileRepo.getByDateRange(options.sourceId, {
      startDate: options.startDate,
      endDate: options.endDate,
      onlyMissing: options.onlyMissing,
    });

    const batchId = `batch-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const totalSize = files.reduce((acc, f) => acc + f.size, 0);

    // If updating checkpoint, set checkpoint timestamp to the upper bound (endDate or now)
    const checkpointTimestamp = options.updateCheckpoint
      ? (options.endDate && options.endDate < Date.now() ? options.endDate : Date.now())
      : undefined;

    const batch: DownloadBatch = {
      id: batchId,
      sourceId: source.id,
      sourceName: source.name,
      type: 'date_range',
      startDate: options.startDate,
      endDate: options.endDate,
      filesCount: files.length,
      totalSize,
      bytesDownloaded: 0,
      status: files.length === 0 ? 'completed' : 'queued',
      checkpointApplied: Boolean(options.updateCheckpoint),
      checkpointTimestamp,
      createdAt: Date.now(),
      completedAt: files.length === 0 ? Date.now() : undefined,
    };

    downloadRepo.createBatch(batch);

    if (options.updateCheckpoint && checkpointTimestamp) {
      sourceRepo.updateCheckpoint(source.id, checkpointTimestamp);
    }

    const tasks: DownloadTask[] = [];
    for (const file of files) {
      const task = this.enqueue(source.id, file.key, options.destinationDir, batchId);
      tasks.push(task);
    }

    return { batch, tasks };
  }

  /**
   * Enqueue all missing files as a sync batch
   */
  public enqueueAllMissing(sourceId: string): { batch: DownloadBatch; tasks: DownloadTask[] } {
    const source = sourceRepo.getById(sourceId);
    if (!source) throw new Error('Source not found');

    const result = fileRepo.getBySource(sourceId, { limit: 10000 });
    const missing = result.files.filter((f) => f.localStatus === 'missing');

    const batchId = `batch-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const totalSize = missing.reduce((acc, f) => acc + f.size, 0);

    const batch: DownloadBatch = {
      id: batchId,
      sourceId: source.id,
      sourceName: source.name,
      type: 'sync_all',
      filesCount: missing.length,
      totalSize,
      bytesDownloaded: 0,
      status: missing.length === 0 ? 'completed' : 'queued',
      checkpointApplied: false,
      createdAt: Date.now(),
      completedAt: missing.length === 0 ? Date.now() : undefined,
    };

    downloadRepo.createBatch(batch);

    const tasks = missing.map((f) => this.enqueue(sourceId, f.key, undefined, batchId));
    return { batch, tasks };
  }

  public cancel(taskId: string): boolean {
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(taskId);
      downloadRepo.finish(taskId, 'failed', 'Cancelled by user');
      return true;
    }

    const idx = this.queue.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      downloadRepo.finish(taskId, 'failed', 'Cancelled by user');
      return true;
    }
    return false;
  }

  private async processQueue(): Promise<void> {
    if (this.activeCount >= this.maxConcurrency || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    this.activeCount++;
    this.executeDownload(task).finally(() => {
      this.activeCount--;
      this.processQueue();
    });
  }

  private async executeDownload(task: DownloadTask): Promise<void> {
    const source = sourceRepo.getById(task.sourceId);
    if (!source) {
      downloadRepo.finish(task.id, 'failed', 'Source not found');
      return;
    }

    const controller = new AbortController();
    this.abortControllers.set(task.id, controller);

    // Exact folder structure creation: ensure directory hierarchy exists
    const destDir = path.dirname(task.destinationPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const tempFilePath = `${task.destinationPath}.dl-tmp-${Date.now()}`;
    downloadRepo.updateProgress(task.id, 0, 0, 'downloading');

    let downloaded = 0;
    let lastTime = Date.now();
    let lastDownloaded = 0;
    let speedBps = 0;

    try {
      const { stream, contentLength } = await storageService.getObjectStream(source, task.fileKey);
      const totalSize = contentLength || task.size;
      const writeStream = fs.createWriteStream(tempFilePath);

      // Track progress
      stream.on('data', (chunk) => {
        downloaded += chunk.length;
        const now = Date.now();
        const deltaMs = now - lastTime;

        if (deltaMs >= 500) {
          const deltaBytes = downloaded - lastDownloaded;
          speedBps = Math.round((deltaBytes / deltaMs) * 1000);
          lastTime = now;
          lastDownloaded = downloaded;

          downloadRepo.updateProgress(task.id, downloaded, speedBps);
          this.broadcast({
            taskId: task.id,
            batchId: task.batchId,
            sourceId: task.sourceId,
            fileKey: task.fileKey,
            bytesDownloaded: downloaded,
            totalSize,
            speedBps,
            status: 'downloading',
          });
        }
      });

      await pipeline(stream, writeStream);

      // Move temp file to final destination
      if (fs.existsSync(task.destinationPath)) {
        fs.unlinkSync(task.destinationPath);
      }
      fs.renameSync(tempFilePath, task.destinationPath);

      // Update task in DB
      downloadRepo.finish(task.id, 'completed');

      // Update file's local status in DB
      const fileId = `${source.id}:${task.fileKey}`;
      const stat = fs.statSync(task.destinationPath);
      fileRepo.updateLocalStatus(fileId, 'synced', stat.size, Math.floor(stat.mtimeMs));

      this.broadcast({
        taskId: task.id,
        batchId: task.batchId,
        sourceId: task.sourceId,
        fileKey: task.fileKey,
        bytesDownloaded: downloaded,
        totalSize: downloaded,
        speedBps: 0,
        status: 'completed',
      });
    } catch (err: any) {
      if (fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch {}
      }
      const errorMsg = err.message || 'Download error';
      downloadRepo.finish(task.id, 'failed', errorMsg);
      this.broadcast({
        taskId: task.id,
        batchId: task.batchId,
        sourceId: task.sourceId,
        fileKey: task.fileKey,
        bytesDownloaded: downloaded,
        totalSize: task.size,
        speedBps: 0,
        status: 'failed',
        error: errorMsg,
      });
    } finally {
      this.abortControllers.delete(task.id);
    }
  }
}

export const downloadService = new DownloadService();
