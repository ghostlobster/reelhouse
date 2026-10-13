import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { storageService } from './storageService.js';
import { sourceRepo, fileRepo, downloadRepo } from '../db.js';
import { DownloadTask, DownloadBatch, DateRangeDownloadRequest, StorageSource } from '../types.js';
import { BadRequestError, NotFoundError } from '../errors.js';

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
   * Build a task for one file, preserving folder structure under the destination.
   */
  private buildTask(source: StorageSource, fileKey: string, size: number, customDestDir?: string, batchId?: string): DownloadTask {
    const baseDir = customDestDir || source.localPath || path.join(process.cwd(), 'downloads', source.name);
    // Robust folder structure preservation: remove leading slashes and map path segments
    const normalizedRelativePath = fileKey.replace(/^[/\\]+/, '').split('/').join(path.sep);
    const resolvedBase = path.resolve(baseDir);
    const destinationPath = path.resolve(resolvedBase, normalizedRelativePath);
    // Reject keys like "../../x" that would escape the destination directory
    if (!destinationPath.startsWith(resolvedBase + path.sep)) {
      throw new BadRequestError(`File key escapes destination directory: ${fileKey}`);
    }

    return {
      id: `dl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      batchId,
      sourceId: source.id,
      fileKey,
      destinationPath,
      size,
      bytesDownloaded: 0,
      speedBps: 0,
      status: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * Save the batch (if any) and its tasks, then queue them. Every key is validated
   * before anything is written, so a bad key can't leave an empty batch in the history.
   */
  private async enqueueFiles(
    source: StorageSource,
    files: Array<{ key: string; size: number }>,
    customDestDir?: string,
    batch?: DownloadBatch
  ): Promise<DownloadTask[]> {
    const tasks = files.map((f) => this.buildTask(source, f.key, f.size, customDestDir, batch?.id));
    if (batch) await downloadRepo.createBatch(batch);
    await downloadRepo.createMany(tasks);
    for (const task of tasks) {
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
    }
    // Start up to maxConcurrency downloads
    for (let i = 0; i < this.maxConcurrency; i++) this.processQueue();
    return tasks;
  }

  private newBatch(
    source: StorageSource,
    type: DownloadBatch['type'],
    files: Array<{ size: number }>,
    extra: Partial<DownloadBatch> = {}
  ): DownloadBatch {
    return {
      id: `batch-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      sourceId: source.id,
      sourceName: source.name,
      type,
      filesCount: files.length,
      totalSize: files.reduce((acc, f) => acc + f.size, 0),
      bytesDownloaded: 0,
      status: files.length === 0 ? 'completed' : 'queued',
      checkpointApplied: false,
      createdAt: Date.now(),
      completedAt: files.length === 0 ? Date.now() : undefined,
      ...extra,
    };
  }

  private async requireSource(sourceId: string): Promise<StorageSource> {
    const source = await sourceRepo.getById(sourceId);
    if (!source) throw new NotFoundError('Source not found');
    return source;
  }

  /**
   * Enqueue a single file download, preserving folder structure
   */
  public async enqueue(sourceId: string, fileKey: string, customDestDir?: string): Promise<DownloadTask> {
    const source = await this.requireSource(sourceId);
    const file = await fileRepo.getByKey(sourceId, fileKey);
    const [task] = await this.enqueueFiles(source, [{ key: fileKey, size: file ? file.size : 0 }], customDestDir);
    return task;
  }

  /**
   * Enqueue a batch of file keys, logging the session batch
   */
  public async enqueueBatch(
    sourceId: string,
    fileKeys: string[],
    customDestDir?: string
  ): Promise<{ batch: DownloadBatch; tasks: DownloadTask[] }> {
    const source = await this.requireSource(sourceId);
    const known = await fileRepo.getByKeys(sourceId, fileKeys);
    const files = fileKeys.map((key) => ({ key, size: known.get(key)?.size ?? 0 }));

    const batch = this.newBatch(source, 'manual_batch', files);
    const tasks = await this.enqueueFiles(source, files, customDestDir, batch);
    return { batch, tasks };
  }

  /**
   * Enqueue download based on date range, creating checkpoint and session history
   */
  public async enqueueDateRange(options: DateRangeDownloadRequest): Promise<{ batch: DownloadBatch; tasks: DownloadTask[] }> {
    const source = await this.requireSource(options.sourceId);

    const files = await fileRepo.getByDateRange(options.sourceId, {
      startDate: options.startDate,
      endDate: options.endDate,
      onlyMissing: options.onlyMissing,
    });

    // If updating checkpoint, set checkpoint timestamp to the upper bound (endDate or now)
    const checkpointTimestamp = options.updateCheckpoint
      ? (options.endDate && options.endDate < Date.now() ? options.endDate : Date.now())
      : undefined;

    const batch = this.newBatch(source, 'date_range', files, {
      startDate: options.startDate,
      endDate: options.endDate,
      checkpointApplied: Boolean(options.updateCheckpoint),
      checkpointTimestamp,
    });

    const tasks = await this.enqueueFiles(source, files, options.destinationDir, batch);

    if (options.updateCheckpoint && checkpointTimestamp) {
      await sourceRepo.updateCheckpoint(source.id, checkpointTimestamp);
    }
    return { batch, tasks };
  }

  /**
   * Enqueue all missing files as a sync batch
   */
  public async enqueueAllMissing(
    sourceId: string,
    customDestDir?: string
  ): Promise<{ batch: DownloadBatch; tasks: DownloadTask[] }> {
    const source = await this.requireSource(sourceId);
    const missing = await fileRepo.listForDownload(sourceId, { onlyMissing: true });

    const batch = this.newBatch(source, 'sync_all', missing);
    const tasks = await this.enqueueFiles(source, missing, customDestDir, batch);
    return { batch, tasks };
  }

  /**
   * Enqueue download for an entire folder prefix, preserving folder structure
   */
  public async enqueueFolder(
    sourceId: string,
    folderPrefix: string,
    onlyMissing: boolean = true,
    customDestDir?: string
  ): Promise<{ batch: DownloadBatch; tasks: DownloadTask[] }> {
    const source = await this.requireSource(sourceId);
    const targetFiles = await fileRepo.listForDownload(sourceId, { prefix: folderPrefix, excludeSynced: onlyMissing });

    const batch = this.newBatch(source, 'folder', targetFiles);
    const tasks = await this.enqueueFiles(source, targetFiles, customDestDir, batch);
    return { batch, tasks };
  }

  public async cancel(taskId: string): Promise<boolean> {
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(taskId);
      await downloadRepo.finish(taskId, 'failed', 'Cancelled by user');
      return true;
    }

    const idx = this.queue.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      await downloadRepo.finish(taskId, 'failed', 'Cancelled by user');
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
    const source = await sourceRepo.getById(task.sourceId);
    if (!source) {
      await downloadRepo.finish(task.id, 'failed', 'Source not found');
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
    await downloadRepo.updateProgress(task.id, 0, 0, 'downloading');

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

          // Not awaited: don't stall the transfer on a progress write
          downloadRepo
            .updateProgress(task.id, downloaded, speedBps)
            .catch((err) => console.error('Failed to save download progress:', err.message));
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
      await downloadRepo.finish(task.id, 'completed');

      // Update file's local status in DB
      const fileId = `${source.id}:${task.fileKey}`;
      const stat = fs.statSync(task.destinationPath);
      // Remember the actual path so scans and previews find copies saved outside source.localPath
      await fileRepo.updateLocalStatus(fileId, 'synced', stat.size, Math.floor(stat.mtimeMs), task.destinationPath);

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
      await downloadRepo.finish(task.id, 'failed', errorMsg).catch((dbErr) => {
        console.error('Failed to record download failure:', dbErr.message);
      });
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
