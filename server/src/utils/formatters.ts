import { FileCategory } from '../types.js';

export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const safeI = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, safeI)).toFixed(dm))} ${sizes[safeI]}`;
}

export function formatDuration(totalSeconds: number): string {
  if (!totalSeconds || isNaN(totalSeconds) || totalSeconds <= 0) return '0s';
  const sec = Math.floor(totalSeconds);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const remainingSeconds = sec % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
  parts.push(`${remainingSeconds}s`);

  return parts.join(' ');
}

export function formatClockTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '00:00';
  const sec = Math.floor(seconds);
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const remainingSecs = sec % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(remainingSecs)}`;
  }
  return `${pad(minutes)}:${pad(remainingSecs)}`;
}

export function detectCategory(key: string, contentType?: string): { category: FileCategory; extension: string } {
  const parts = key.split('.');
  const extension = parts.length > 1 ? parts.pop()!.toLowerCase() : '';

  const videoExts = new Set(['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', 'wmv', 'm4v', '3gp', 'ts', 'ogv']);
  const imageExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico', 'tiff']);
  const audioExts = new Set(['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus']);
  const docExts = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'txt', 'rtf', 'csv']);
  const archiveExts = new Set(['zip', 'tar', 'gz', 'bz2', '7z', 'rar', 'xz', 'iso', 'zst']);
  const codeExts = new Set(['json', 'js', 'jsx', 'ts', 'tsx', 'html', 'css', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'sh', 'sql', 'yaml', 'yml', 'xml', 'md']);

  if (videoExts.has(extension) || contentType?.startsWith('video/')) {
    return { category: 'video', extension };
  }
  if (imageExts.has(extension) || contentType?.startsWith('image/')) {
    return { category: 'image', extension };
  }
  if (audioExts.has(extension) || contentType?.startsWith('audio/')) {
    return { category: 'audio', extension };
  }
  if (docExts.has(extension) || contentType === 'application/pdf') {
    return { category: 'document', extension };
  }
  if (archiveExts.has(extension) || contentType?.includes('compressed') || contentType?.includes('zip')) {
    return { category: 'archive', extension };
  }
  if (codeExts.has(extension) || contentType?.includes('json') || contentType?.includes('javascript')) {
    return { category: 'code', extension };
  }

  return { category: 'other', extension };
}
