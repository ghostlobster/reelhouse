import fs from 'node:fs';
import path from 'node:path';
import { storageService } from './storageService.js';
import { query, sourceRepo, fileRepo } from '../db.js';
import { StorageSource, StorageFile } from '../types.js';
import { detectCategory } from '../utils/formatters.js';
import { inspectMediaBuffer, inspectLocalMediaFile } from '../utils/mediaInspector.js';

export interface ScanProgressEvent {
  sourceId: string;
  status: 'scanning' | 'completed' | 'failed';
  scannedFiles: number;
  totalSize: number;
  totalVideoDuration: number;
  currentKey?: string;
  progressPercent?: number;
  message?: string;
}

export type ScanProgressCallback = (event: ScanProgressEvent) => void;

export class ScannerService {
  private activeScans = new Set<string>();
  private listeners: ScanProgressCallback[] = [];

  public onProgress(cb: ScanProgressCallback): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private broadcast(event: ScanProgressEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in progress listener:', err);
      }
    }
  }

  public isScanning(sourceId: string): boolean {
    return this.activeScans.has(sourceId);
  }

  public async startScan(source: StorageSource, options: { deepMediaScan?: boolean } = {}): Promise<void> {
    if (this.activeScans.has(source.id)) {
      throw new Error(`Scan already running for source ${source.name}`);
    }

    this.activeScans.add(source.id);

    const scanStartTime = Date.now();
    let scannedFiles = 0;
    let totalSize = 0;
    let totalVideoDuration = 0;
    let batch: StorageFile[] = [];
    const discoveredKeys: string[] = [];

    const historyId = `scan-${Date.now()}`;
    try {
      await sourceRepo.updateScanStatus(source.id, 'scanning');
      await query(`INSERT INTO scan_history (id, source_id, started_at, status) VALUES (?, ?, ?, 'running')`, [
        historyId,
        source.id,
        scanStartTime,
      ]);
    } catch (err) {
      // Release the source, or it would look "already scanning" forever
      this.activeScans.delete(source.id);
      throw err;
    }

    try {
      this.broadcast({
        sourceId: source.id,
        status: 'scanning',
        scannedFiles: 0,
        totalSize: 0,
        totalVideoDuration: 0,
        message: 'Initializing bucket crawler...',
      });

      let continuationToken: string | undefined = undefined;
      const deepScan = options.deepMediaScan !== false; // Default to true for full metrics

      do {
        const page = await storageService.listPage(source, continuationToken, undefined, 1000);
        continuationToken = page.nextContinuationToken;
        // Existing rows for this page in one query, instead of one lookup per file
        const existingByKey = await fileRepo.getByKeys(
          source.id,
          page.objects.map((o) => o.Key).filter((k): k is string => Boolean(k))
        );

        for (const obj of page.objects) {
          if (!obj.Key || obj.Key.endsWith('/')) {
            // Skip directory marker objects
            continue;
          }

          const key = obj.Key;
          const size = obj.Size || 0;
          const etag = obj.ETag?.replace(/"/g, '');
          const lastModified = obj.LastModified ? new Date(obj.LastModified).getTime() : Date.now();
          const { category, extension } = detectCategory(key);

          scannedFiles++;
          totalSize += size;
          discoveredKeys.push(key);

          // Check on-premise local disk sync status
          let localStatus: StorageFile['localStatus'] = 'missing';
          let localSize: number | undefined = undefined;
          let localMtime: number | undefined = undefined;
          let localFilePath: string | undefined = undefined;

          const existingFile = existingByKey.get(key);

          // Prefer the source's default directory, then wherever the file was last downloaded to
          const candidatePaths = [
            source.localPath ? path.join(source.localPath, key) : undefined,
            existingFile?.localFilePath,
          ].filter((p): p is string => Boolean(p));

          for (const candidate of candidatePaths) {
            try {
              if (fs.existsSync(candidate)) {
                const stat = fs.statSync(candidate);
                localSize = stat.size;
                localMtime = Math.floor(stat.mtimeMs);
                localStatus = stat.size === size ? 'synced' : 'mismatch';
                localFilePath = candidate;
                break;
              }
            } catch {}
          }

          // Video / Audio Play Time & Dimension Extraction
          let duration: number | undefined = undefined;
          let width: number | undefined = undefined;
          let height: number | undefined = undefined;
          let codec: string | undefined = undefined;
          let bitrate: number | undefined = undefined;

          // Check if we already inspected this file before and size hasn't changed
          if (existingFile && existingFile.duration && existingFile.duration > 0 && existingFile.size === size) {
            duration = existingFile.duration;
            width = existingFile.width;
            height = existingFile.height;
            codec = existingFile.codec;
            bitrate = existingFile.bitrate;
          } else if (deepScan && (category === 'video' || category === 'audio')) {
            // Extract media info
            try {
              if (localStatus === 'synced' && localFilePath) {
                // If local file is synced, parse directly from local disk (fastest!)
                const info = await inspectLocalMediaFile(localFilePath);
                duration = info.duration;
                width = info.width;
                height = info.height;
                codec = info.codec;
                bitrate = info.bitrate;
              } else {
                // Remote range probe: read head (first 512KB)
                const probeSize = Math.min(size, 512 * 1024);
                if (probeSize > 0) {
                  const headBuffer = await storageService.getObjectRangeBuffer(
                    source,
                    key,
                    `bytes=0-${probeSize - 1}`
                  );
                  let info = await inspectMediaBuffer(headBuffer, undefined, size);

                  // If MP4 without duration in head, moov might be at tail; probe tail 512KB
                  if (!info.duration && size > 512 * 1024 && (extension === 'mp4' || extension === 'mov')) {
                    const tailStart = Math.max(0, size - 512 * 1024);
                    const tailBuffer = await storageService.getObjectRangeBuffer(
                      source,
                      key,
                      `bytes=${tailStart}-${size - 1}`
                    );
                    const tailInfo = await inspectMediaBuffer(tailBuffer, undefined, size);
                    if (tailInfo.duration) {
                      info = { ...info, ...tailInfo };
                    }
                  }

                  duration = info.duration;
                  width = info.width;
                  height = info.height;
                  codec = info.codec;
                  bitrate = info.bitrate;
                }
              }
            } catch (mediaErr) {
              // Silently continue if range inspection fails for a specific file
            }
          }

          if (duration && duration > 0) {
            totalVideoDuration += duration;
          }

          const fileItem: StorageFile = {
            id: `${source.id}:${key}`,
            sourceId: source.id,
            key,
            size,
            etag,
            lastModified,
            contentType: (obj as any).ContentType || `application/${extension || 'octet-stream'}`,
            extension,
            category,
            duration,
            width,
            height,
            codec,
            bitrate,
            localStatus,
            localSize,
            localMtime,
            // Keep the recorded location when it's temporarily unreachable (e.g. an unplugged drive)
            localFilePath: localFilePath ?? existingFile?.localFilePath,
            scannedAt: Date.now(),
          };

          batch.push(fileItem);

          if (batch.length >= 250) {
            await fileRepo.upsertBatch(batch);
            batch = [];
          }

          if (scannedFiles % 50 === 0) {
            this.broadcast({
              sourceId: source.id,
              status: 'scanning',
              scannedFiles,
              totalSize,
              totalVideoDuration,
              currentKey: key,
            });
          }
        }

        // Report after every page too: file-server listings return small pages while walking folders
        this.broadcast({
          sourceId: source.id,
          status: 'scanning',
          scannedFiles,
          totalSize,
          totalVideoDuration,
        });
      } while (continuationToken);

      // Flush remaining batch
      if (batch.length > 0) {
        await fileRepo.upsertBatch(batch);
        batch = [];
      }

      // Update source statistics (only the totals: settings may have been edited during the scan)
      await sourceRepo.finishScan(source.id, {
        totalFiles: scannedFiles,
        totalSize,
        totalVideoDuration,
        lastScannedAt: Date.now(),
      });

      // Finish history
      await query(
        `UPDATE scan_history
        SET completed_at = ?, status = 'completed', files_count = ?, total_size = ?, video_duration_seconds = ?
        WHERE id = ?`,
        [Date.now(), scannedFiles, totalSize, totalVideoDuration, historyId]
      );

      this.broadcast({
        sourceId: source.id,
        status: 'completed',
        scannedFiles,
        totalSize,
        totalVideoDuration,
        message: `Scan finished successfully. Indexed ${scannedFiles} files.`,
      });
    } catch (err: any) {
      console.error(`Scan failed for source ${source.name}:`, err);
      // Don't let a database error here hide the scan error
      await sourceRepo.updateScanStatus(source.id, 'failed').catch(() => {});
      await query(`UPDATE scan_history SET completed_at = ?, status = 'failed', error = ? WHERE id = ?`, [
        Date.now(),
        err.message || 'Scan error',
        historyId,
      ]).catch(() => {});

      this.broadcast({
        sourceId: source.id,
        status: 'failed',
        scannedFiles,
        totalSize,
        totalVideoDuration,
        message: err.message || 'Scan failed',
      });
      throw err;
    } finally {
      this.activeScans.delete(source.id);
    }
  }
}

export const scannerService = new ScannerService();
