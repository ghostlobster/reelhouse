import fs from 'node:fs';
import path from 'node:path';
import { query, queryOne, sourceRepo } from '../db.js';
import { StorageSource, ScanMetrics, FileCategory, StorageFile } from '../types.js';
import { formatBytes, formatDuration } from '../utils/formatters.js';

export class MetricsService {
  public async computeMetrics(sourceId: string): Promise<ScanMetrics | null> {
    const source = await sourceRepo.getById(sourceId);
    if (!source) return null;

    // 1. Overall stats
    const statsRow = (await queryOne(`
      SELECT
        COUNT(*) as total_files,
        COALESCE(SUM(size), 0) as total_size,
        COALESCE(AVG(size), 0) as avg_size
      FROM files
      WHERE source_id = ?
    `, [sourceId])) as any;

    const totalFiles = statsRow.total_files || 0;
    const totalSize = statsRow.total_size || 0;
    const avgFileSize = Math.round(statsRow.avg_size || 0);

    // Median size
    let medianFileSize = 0;
    if (totalFiles > 0) {
      const MEDIAN_OFFSET = Math.floor(totalFiles / 2);
      const medianRow = (await queryOne(`
        SELECT size FROM files
        WHERE source_id = ?
        ORDER BY size ASC
        LIMIT 1 OFFSET ?
      `, [sourceId, MEDIAN_OFFSET])) as any;
      if (medianRow) medianFileSize = medianRow.size;
    }

    // 2. Video Metrics (Duration, Resolutions, Codecs, Buckets)
    const videoStatsRow = (await queryOne(`
      SELECT
        COUNT(*) as video_count,
        COALESCE(SUM(size), 0) as total_video_size,
        COALESCE(SUM(duration), 0) as total_video_duration,
        COALESCE(AVG(duration), 0) as avg_video_duration
      FROM files
      WHERE source_id = ? AND category = 'video'
    `, [sourceId])) as any;

    const totalVideoDuration = videoStatsRow.total_video_duration || 0;
    const videoCount = videoStatsRow.video_count || 0;
    const totalVideoSize = videoStatsRow.total_video_size || 0;
    const avgVideoDuration = Math.round(videoStatsRow.avg_video_duration || 0);

    // Resolution buckets for video
    const videoResolutionRows = (await query(`
      SELECT width, height FROM files
      WHERE source_id = ? AND category = 'video' AND width IS NOT NULL AND height IS NOT NULL
    `, [sourceId])) as Array<{ width: number; height: number }>;

    const resolutionBuckets = {
      '4K UHD (2160p)': 0,
      '2K QHD (1440p)': 0,
      'Full HD (1080p)': 0,
      'HD (720p)': 0,
      'SD (480p/360p)': 0,
      'Audio / Unknown': 0,
    };

    let classifiedResCount = 0;
    for (const item of videoResolutionRows) {
      classifiedResCount++;
      const maxDim = Math.max(item.width, item.height);
      const minDim = Math.min(item.width, item.height);

      if (maxDim >= 3840 || minDim >= 2160) {
        resolutionBuckets['4K UHD (2160p)']++;
      } else if (maxDim >= 2560 || minDim >= 1440) {
        resolutionBuckets['2K QHD (1440p)']++;
      } else if (maxDim >= 1920 || minDim >= 1080) {
        resolutionBuckets['Full HD (1080p)']++;
      } else if (maxDim >= 1280 || minDim >= 720) {
        resolutionBuckets['HD (720p)']++;
      } else {
        resolutionBuckets['SD (480p/360p)']++;
      }
    }
    resolutionBuckets['Audio / Unknown'] = Math.max(0, videoCount - classifiedResCount);

    // Video duration buckets
    const durationBuckets = {
      '< 1 min': 0,
      '1 - 5 mins': 0,
      '5 - 15 mins': 0,
      '15 - 30 mins': 0,
      '30 - 60 mins': 0,
      '> 1 hour': 0,
    };

    const videoDurations = (await query(`
      SELECT duration FROM files
      WHERE source_id = ? AND category = 'video' AND duration > 0
    `, [sourceId])) as Array<{ duration: number }>;

    for (const { duration } of videoDurations) {
      if (duration < 60) durationBuckets['< 1 min']++;
      else if (duration < 300) durationBuckets['1 - 5 mins']++;
      else if (duration < 900) durationBuckets['5 - 15 mins']++;
      else if (duration < 1800) durationBuckets['15 - 30 mins']++;
      else if (duration < 3600) durationBuckets['30 - 60 mins']++;
      else durationBuckets['> 1 hour']++;
    }

    // Video container formats
    const videoFormatsRows = (await query(`
      SELECT extension, COUNT(*) as count, SUM(size) as total_size
      FROM files
      WHERE source_id = ? AND category = 'video'
      GROUP BY extension
      ORDER BY count DESC
    `, [sourceId])) as Array<{ extension: string; count: number; total_size: number }>;

    const containerFormats: Record<string, { count: number; totalSize: number }> = {};
    for (const r of videoFormatsRows) {
      const ext = r.extension ? `.${r.extension.toLowerCase()}` : '.unknown';
      containerFormats[ext] = { count: r.count, totalSize: r.total_size };
    }

    // Video codecs
    const videoCodecRows = (await query(`
      SELECT COALESCE(codec, 'Unknown') as codec, COUNT(*) as count, SUM(size) as total_size
      FROM files
      WHERE source_id = ? AND category = 'video'
      GROUP BY codec
      ORDER BY count DESC
    `, [sourceId])) as Array<{ codec: string; count: number; total_size: number }>;

    const videoCodecs: Record<string, { count: number; totalSize: number }> = {};
    for (const r of videoCodecRows) {
      videoCodecs[r.codec] = { count: r.count, totalSize: r.total_size };
    }

    // 3. Category Distribution
    const categoryRows = (await query(`
      SELECT category, COUNT(*) as count, COALESCE(SUM(size), 0) as total_size
      FROM files
      WHERE source_id = ?
      GROUP BY category
    `, [sourceId])) as Array<{ category: FileCategory; count: number; total_size: number }>;

    const categories: Record<FileCategory, any> = {
      video: { count: 0, totalSize: 0, formattedSize: '0 B', percentSize: 0, percentCount: 0 },
      image: { count: 0, totalSize: 0, formattedSize: '0 B', percentSize: 0, percentCount: 0 },
      audio: { count: 0, totalSize: 0, formattedSize: '0 B', percentSize: 0, percentCount: 0 },
      document: { count: 0, totalSize: 0, formattedSize: '0 B', percentSize: 0, percentCount: 0 },
      archive: { count: 0, totalSize: 0, formattedSize: '0 B', percentSize: 0, percentCount: 0 },
      code: { count: 0, totalSize: 0, formattedSize: '0 B', percentSize: 0, percentCount: 0 },
      other: { count: 0, totalSize: 0, formattedSize: '0 B', percentSize: 0, percentCount: 0 },
    };

    for (const row of categoryRows) {
      if (categories[row.category]) {
        categories[row.category] = {
          count: row.count,
          totalSize: row.total_size,
          formattedSize: formatBytes(row.total_size),
          percentSize: totalSize > 0 ? parseFloat(((row.total_size / totalSize) * 100).toFixed(1)) : 0,
          percentCount: totalFiles > 0 ? parseFloat(((row.count / totalFiles) * 100).toFixed(1)) : 0,
        };
      }
    }

    // 4. File extension distribution
    const topExtensionsRows = (await query(`
      SELECT extension, COUNT(*) as count, SUM(size) as total_size
      FROM files
      WHERE source_id = ?
      GROUP BY extension
      ORDER BY total_size DESC
      LIMIT 10
    `, [sourceId])) as Array<{ extension: string; count: number; total_size: number }>;

    const topExtensions = topExtensionsRows.map((r) => ({
      extension: r.extension || 'none',
      count: r.count,
      totalSize: r.total_size,
    }));

    // 5. Size Distribution Buckets
    const sizeBuckets = {
      '< 100 KB': 0,
      '100 KB - 1 MB': 0,
      '1 MB - 10 MB': 0,
      '10 MB - 100 MB': 0,
      '100 MB - 1 GB': 0,
      '1 GB - 10 GB': 0,
      '> 10 GB': 0,
    };

    const sizeRows = (await query('SELECT size FROM files WHERE source_id = ?', [sourceId])) as Array<{ size: number }>;
    for (const { size } of sizeRows) {
      if (size < 100 * 1024) sizeBuckets['< 100 KB']++;
      else if (size < 1024 * 1024) sizeBuckets['100 KB - 1 MB']++;
      else if (size < 10 * 1024 * 1024) sizeBuckets['1 MB - 10 MB']++;
      else if (size < 100 * 1024 * 1024) sizeBuckets['10 MB - 100 MB']++;
      else if (size < 1024 * 1024 * 1024) sizeBuckets['100 MB - 1 GB']++;
      else if (size < 10 * 1024 * 1024 * 1024) sizeBuckets['1 GB - 10 GB']++;
      else sizeBuckets['> 10 GB']++;
    }

    // 6. Time & Ingestion Metrics
    const now = Date.now();
    const day = 24 * 3600 * 1000;
    const ageBuckets = {
      'Past 24 Hours': 0,
      'Past 7 Days': 0,
      'Past 30 Days': 0,
      '1 - 3 Months': 0,
      '3 - 6 Months': 0,
      '6 - 12 Months': 0,
      '> 1 Year': 0,
    };

    const mtimeRows = (await query('SELECT last_modified FROM files WHERE source_id = ?', [sourceId])) as Array<{ last_modified: number }>;
    for (const { last_modified } of mtimeRows) {
      const ageMs = now - last_modified;
      if (ageMs < day) ageBuckets['Past 24 Hours']++;
      else if (ageMs < 7 * day) ageBuckets['Past 7 Days']++;
      else if (ageMs < 30 * day) ageBuckets['Past 30 Days']++;
      else if (ageMs < 90 * day) ageBuckets['1 - 3 Months']++;
      else if (ageMs < 180 * day) ageBuckets['3 - 6 Months']++;
      else if (ageMs < 365 * day) ageBuckets['6 - 12 Months']++;
      else ageBuckets['> 1 Year']++;
    }

    // Monthly ingestion timeline (formatted YYYY-MM)
    const monthlyMap = new Map<string, { count: number; totalSize: number }>();
    const filesWithMtime = (await query('SELECT last_modified, size FROM files WHERE source_id = ? ORDER BY last_modified ASC', [sourceId])) as Array<{ last_modified: number; size: number }>;

    for (const item of filesWithMtime) {
      const date = new Date(item.last_modified);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const entry = monthlyMap.get(key) || { count: 0, totalSize: 0 };
      entry.count++;
      entry.totalSize += item.size;
      monthlyMap.set(key, entry);
    }

    const monthlyIngestion = Array.from(monthlyMap.entries()).map(([month, data]) => ({
      month,
      count: data.count,
      totalSize: data.totalSize,
    }));

    // Oldest and Newest file
    const oldestRow = (await queryOne('SELECT key, last_modified, size FROM files WHERE source_id = ? ORDER BY last_modified ASC LIMIT 1', [sourceId])) as any;
    const newestRow = (await queryOne('SELECT key, last_modified, size FROM files WHERE source_id = ? ORDER BY last_modified DESC LIMIT 1', [sourceId])) as any;

    const oldestFile = oldestRow ? { key: oldestRow.key, date: oldestRow.last_modified, size: oldestRow.size } : undefined;
    const newestFile = newestRow ? { key: newestRow.key, date: newestRow.last_modified, size: newestRow.size } : undefined;

    // 7. Top Lists
    const largestFilesRows = (await query('SELECT * FROM files WHERE source_id = ? ORDER BY size DESC LIMIT 15', [sourceId])) as any[];
    const longestVideosRows = (await query("SELECT * FROM files WHERE source_id = ? AND category = 'video' AND duration > 0 ORDER BY duration DESC LIMIT 15", [sourceId])) as any[];
    const recentlyModifiedRows = (await query('SELECT * FROM files WHERE source_id = ? ORDER BY last_modified DESC LIMIT 15', [sourceId])) as any[];

    // 8. On-Premise Box Synchronization
    const syncRows = (await query(`
      SELECT local_status, COUNT(*) as count, COALESCE(SUM(size), 0) as total_size
      FROM files
      WHERE source_id = ?
      GROUP BY local_status
    `, [sourceId])) as Array<{ local_status: string; count: number; total_size: number }>;

    let syncedFilesCount = 0;
    let syncedSize = 0;
    let missingLocalCount = 0;
    let missingLocalSize = 0;
    let mismatchedCount = 0;

    for (const r of syncRows) {
      if (r.local_status === 'synced') {
        syncedFilesCount = r.count;
        syncedSize = r.total_size;
      } else if (r.local_status === 'missing') {
        missingLocalCount = r.count;
        missingLocalSize = r.total_size;
      } else if (r.local_status === 'mismatch') {
        mismatchedCount = r.count;
      }
    }

    const syncPercentage = totalFiles > 0 ? parseFloat(((syncedFilesCount / totalFiles) * 100).toFixed(1)) : 0;

    // Local Disk Free Space on On-Premise Box
    let localDiskFreeSpace: number | undefined = undefined;
    if (source.localPath && fs.existsSync(source.localPath)) {
      try {
        const stats = (fs as any).statfsSync ? (fs as any).statfsSync(source.localPath) : null;
        if (stats) {
          localDiskFreeSpace = stats.bavail * stats.bsize;
        }
      } catch {}
    }

    // 9. Cost Estimates
    // Industry average storage rates per GB/month:
    // AWS S3 Standard: $0.023
    // Wasabi: $0.0059
    // Cloudflare R2: $0.015
    // Backblaze B2: $0.006
    // MinIO / On-Premise: $0.00
    const costRatePerGBMap: Record<string, number> = {
      aws: 0.023,
      r2: 0.015,
      wasabi: 0.0059,
      b2: 0.006,
      keycdn: 0.01,
      minio: 0.0,
      generic_s3: 0.015,
      http_origin: 0.0,
    };
    const rate = costRatePerGBMap[source.provider] ?? 0.015;
    const gigabytes = totalSize / (1024 * 1024 * 1024);
    const monthlyStorageEstimateUSD = parseFloat((gigabytes * rate).toFixed(2));

    return {
      sourceId: source.id,
      sourceName: source.name,
      provider: source.provider,
      totalFiles,
      totalSize,
      formattedTotalSize: formatBytes(totalSize),
      avgFileSize,
      medianFileSize,
      video: {
        totalVideoDuration,
        totalVideoDurationFormatted: formatDuration(totalVideoDuration),
        videoCount,
        totalVideoSize,
        avgVideoDuration,
        resolutionBuckets,
        durationBuckets,
        containerFormats,
        videoCodecs,
      },
      categories,
      topExtensions,
      sizeBuckets,
      ageBuckets,
      monthlyIngestion,
      oldestFile,
      newestFile,
      largestFiles: largestFilesRows.map((r) => ({
        id: r.id,
        sourceId: r.source_id,
        key: r.key,
        size: r.size,
        etag: r.etag,
        lastModified: r.last_modified,
        contentType: r.content_type,
        extension: r.extension,
        category: r.category,
        duration: r.duration,
        width: r.width,
        height: r.height,
        codec: r.codec,
        bitrate: r.bitrate,
        localStatus: r.local_status,
        localSize: r.local_size,
        localMtime: r.local_mtime,
        scannedAt: r.scanned_at,
      })),
      longestVideos: longestVideosRows.map((r) => ({
        id: r.id,
        sourceId: r.source_id,
        key: r.key,
        size: r.size,
        etag: r.etag,
        lastModified: r.last_modified,
        contentType: r.content_type,
        extension: r.extension,
        category: r.category,
        duration: r.duration,
        width: r.width,
        height: r.height,
        codec: r.codec,
        bitrate: r.bitrate,
        localStatus: r.local_status,
        localSize: r.local_size,
        localMtime: r.local_mtime,
        scannedAt: r.scanned_at,
      })),
      recentlyModified: recentlyModifiedRows.map((r) => ({
        id: r.id,
        sourceId: r.source_id,
        key: r.key,
        size: r.size,
        etag: r.etag,
        lastModified: r.last_modified,
        contentType: r.content_type,
        extension: r.extension,
        category: r.category,
        duration: r.duration,
        width: r.width,
        height: r.height,
        codec: r.codec,
        bitrate: r.bitrate,
        localStatus: r.local_status,
        localSize: r.local_size,
        localMtime: r.local_mtime,
        scannedAt: r.scanned_at,
      })),
      onPremSync: {
        localTargetDirectory: source.localPath,
        totalRemoteFiles: totalFiles,
        totalRemoteSize: totalSize,
        syncedFilesCount,
        syncedSize,
        missingLocalCount,
        missingLocalSize,
        mismatchedCount,
        syncPercentage,
        localDiskFreeSpace,
      },
      costEstimates: {
        monthlyStorageEstimateUSD,
        costRatePerGB: rate,
      },
    };
  }
}

export const metricsService = new MetricsService();
