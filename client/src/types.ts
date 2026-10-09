export type StorageProvider =
  | 'aws'
  | 'r2'
  | 'minio'
  | 'keycdn'
  | 'wasabi'
  | 'b2'
  | 'generic_s3'
  | 'http_origin';

export type FileCategory =
  | 'video'
  | 'image'
  | 'audio'
  | 'document'
  | 'archive'
  | 'code'
  | 'other';

export type LocalSyncStatus = 'missing' | 'synced' | 'mismatch';

export interface StorageSource {
  id: string;
  name: string;
  provider: StorageProvider;
  endpoint: string;
  bucket: string;
  region?: string;
  accessKey?: string;
  secretKey?: string;
  forcePathStyle?: boolean;
  cdnUrl?: string;
  localPath: string;
  readOnly: boolean;
  createdAt: number;
  updatedAt: number;
  lastScannedAt?: number;
  scanStatus: 'idle' | 'scanning' | 'completed' | 'failed';
  totalFiles: number;
  totalSize: number;
  totalVideoDuration: number;
  lastCheckpointMtime?: number;
}

export interface StorageFile {
  id: string;
  sourceId: string;
  key: string;
  size: number;
  etag?: string;
  lastModified: number;
  contentType: string;
  extension: string;
  category: FileCategory;
  duration?: number;
  width?: number;
  height?: number;
  codec?: string;
  bitrate?: number;
  localStatus: LocalSyncStatus;
  localSize?: number;
  localMtime?: number;
  scannedAt: number;
}

export interface VideoMetrics {
  totalVideoDuration: number;
  totalVideoDurationFormatted: string;
  videoCount: number;
  totalVideoSize: number;
  avgVideoDuration: number;
  resolutionBuckets: {
    '4K UHD (2160p)': number;
    '2K QHD (1440p)': number;
    'Full HD (1080p)': number;
    'HD (720p)': number;
    'SD (480p/360p)': number;
    'Audio / Unknown': number;
  };
  durationBuckets: {
    '< 1 min': number;
    '1 - 5 mins': number;
    '5 - 15 mins': number;
    '15 - 30 mins': number;
    '30 - 60 mins': number;
    '> 1 hour': number;
  };
  containerFormats: Record<string, { count: number; totalSize: number }>;
  videoCodecs: Record<string, { count: number; totalSize: number }>;
}

export interface CategoryMetric {
  count: number;
  totalSize: number;
  formattedSize: string;
  percentSize: number;
  percentCount: number;
}

export interface ScanMetrics {
  sourceId: string;
  sourceName: string;
  provider: StorageProvider;
  totalFiles: number;
  totalSize: number;
  formattedTotalSize: string;
  avgFileSize: number;
  medianFileSize: number;
  video: VideoMetrics;
  categories: Record<FileCategory, CategoryMetric>;
  topExtensions: Array<{ extension: string; count: number; totalSize: number }>;
  sizeBuckets: {
    '< 100 KB': number;
    '100 KB - 1 MB': number;
    '1 MB - 10 MB': number;
    '10 MB - 100 MB': number;
    '100 MB - 1 GB': number;
    '1 GB - 10 GB': number;
    '> 10 GB': number;
  };
  ageBuckets: {
    'Past 24 Hours': number;
    'Past 7 Days': number;
    'Past 30 Days': number;
    '1 - 3 Months': number;
    '3 - 6 Months': number;
    '6 - 12 Months': number;
    '> 1 Year': number;
  };
  monthlyIngestion: Array<{ month: string; count: number; totalSize: number }>;
  oldestFile?: { key: string; date: number; size: number };
  newestFile?: { key: string; date: number; size: number };
  largestFiles: StorageFile[];
  longestVideos: StorageFile[];
  recentlyModified: StorageFile[];
  onPremSync: {
    localTargetDirectory: string;
    totalRemoteFiles: number;
    totalRemoteSize: number;
    syncedFilesCount: number;
    syncedSize: number;
    missingLocalCount: number;
    missingLocalSize: number;
    mismatchedCount: number;
    syncPercentage: number;
    localDiskFreeSpace?: number;
  };
  costEstimates: {
    monthlyStorageEstimateUSD: number;
    costRatePerGB: number;
  };
}

export interface DownloadBatch {
  id: string;
  sourceId: string;
  sourceName: string;
  type: 'date_range' | 'manual_batch' | 'sync_all' | 'single';
  startDate?: number;
  endDate?: number;
  filesCount: number;
  totalSize: number;
  bytesDownloaded: number;
  status: 'queued' | 'downloading' | 'completed' | 'failed' | 'partial';
  checkpointApplied: boolean;
  checkpointTimestamp?: number;
  createdAt: number;
  completedAt?: number;
}

export interface DownloadTask {
  id: string;
  batchId?: string;
  sourceId: string;
  fileKey: string;
  destinationPath: string;
  size: number;
  bytesDownloaded: number;
  speedBps: number;
  status: 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface DateRangeDownloadRequest {
  sourceId: string;
  startDate?: number;
  endDate?: number;
  onlyMissing?: boolean;
  updateCheckpoint?: boolean;
  destinationDir?: string;
}
