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
  cdnUrl?: string; // Optional custom public CDN or pull zone domain (e.g., https://cdn.example.com)
  localPath: string; // Target path on on-premise box
  readOnly: boolean;
  createdAt: number;
  updatedAt: number;
  lastScannedAt?: number;
  scanStatus: 'idle' | 'scanning' | 'completed' | 'failed';
  totalFiles: number;
  totalSize: number;
  totalVideoDuration: number; // In seconds
  lastCheckpointMtime?: number; // Last download date checkpoint (Unix ms)
}

export interface StorageFile {
  id: string;
  sourceId: string;
  key: string;
  size: number;
  etag?: string;
  lastModified: number; // Unix ms
  contentType: string;
  extension: string;
  category: FileCategory;
  duration?: number; // Video or audio play time in seconds
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
  totalVideoDuration: number; // Total seconds
  totalVideoDurationFormatted: string; // e.g., "3d 14h 22m 10s"
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
  
  // Video Metrics (User's primary requirement)
  video: VideoMetrics;

  // Category Distribution
  categories: Record<FileCategory, CategoryMetric>;

  // File Extension Distribution
  topExtensions: Array<{ extension: string; count: number; totalSize: number }>;

  // Size Distribution Buckets
  sizeBuckets: {
    '< 100 KB': number;
    '100 KB - 1 MB': number;
    '1 MB - 10 MB': number;
    '10 MB - 100 MB': number;
    '100 MB - 1 GB': number;
    '1 GB - 10 GB': number;
    '> 10 GB': number;
  };

  // Time & Ingestion Metrics
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

  // Top Lists
  largestFiles: StorageFile[];
  longestVideos: StorageFile[];
  recentlyModified: StorageFile[];

  // On-Premise Box Synchronization
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

  // Cost estimates
  costEstimates: {
    monthlyStorageEstimateUSD: number;
    costRatePerGB: number;
  };
}

export interface DownloadBatch {
  id: string;
  sourceId: string;
  sourceName: string;
  type: 'date_range' | 'manual_batch' | 'sync_all' | 'single' | 'folder';
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

export interface HierarchyFolder {
  name: string;
  prefix: string;
  fileCount: number;
  totalSize: number;
  videoDuration: number;
}

export interface HierarchyBreadcrumb {
  name: string;
  prefix: string;
}

export interface HierarchyResponse {
  currentPrefix: string;
  parentPrefix: string | null;
  breadcrumbs: HierarchyBreadcrumb[];
  folders: HierarchyFolder[];
  files: StorageFile[];
  totalFolders: number;
  totalFiles: number;
  totalSize: number;
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
  startDate?: number; // Unix ms
  endDate?: number; // Unix ms
  onlyMissing?: boolean;
  updateCheckpoint?: boolean;
  destinationDir?: string;
}

