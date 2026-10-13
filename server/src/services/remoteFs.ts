import path from 'node:path';
import { Readable } from 'node:stream';
import { _Object } from '@aws-sdk/client-s3';
import { StorageSource } from '../types.js';
import { BadRequestError } from '../errors.js';

/**
 * Shared pieces for sources that are file servers (FTP/FTPS/SFTP) rather than S3 buckets.
 * Their endpoint is stored as "<protocol>://host:port"; the bucket field is the folder to mirror.
 */
export type FileProtocol = 'ftps' | 'ftp' | 'sftp';

export interface FileServerBackend {
  testConnection(source: StorageSource): Promise<{ success: boolean; message: string; sampleCount?: number }>;
  listPage(
    source: StorageSource,
    continuationToken?: string,
    prefix?: string,
    maxKeys?: number
  ): Promise<{ objects: _Object[]; nextContinuationToken?: string; isTruncated: boolean }>;
  getObjectStream(
    source: StorageSource,
    key: string,
    range?: string
  ): Promise<{ stream: Readable; contentLength?: number; contentRange?: string; acceptRanges?: string }>;
}

/** Providers reached as a file server instead of through the S3 API. */
export const isFileServerSource = (source: StorageSource): boolean => source.provider === 'keycdn';

/**
 * Parse "ftps://host:21", "sftp://host:22", "host:port" or "host". No scheme means FTPS,
 * which is what KeyCDN storage zones use.
 */
export function parseFileEndpoint(endpoint: string | undefined): { protocol: FileProtocol; host: string; port: number } {
  let raw = (endpoint || '').trim();
  const scheme = raw.match(/^(ftps|ftp|sftp):\/\//i);
  const protocol = (scheme?.[1].toLowerCase() as FileProtocol) || 'ftps';
  raw = raw.slice(scheme?.[0].length ?? 0).replace(/\/+$/, '');
  if (!raw) throw new BadRequestError('Server host is required');
  const match = raw.match(/^(.+?)(?::(\d+))?$/);
  const host = match?.[1] || raw;
  const port = match?.[2] ? parseInt(match[2], 10) : protocol === 'sftp' ? 22 : 21;
  return { protocol, host, port };
}

/**
 * What a connection depends on. Pools and cached connections are rebuilt only when this changes,
 * not on every source update (a finished scan updates the source too).
 */
export const connectionSignature = (source: StorageSource): string =>
  JSON.stringify([source.endpoint, source.accessKey, source.secretKey]);

/** Remote folder all keys are relative to: the bucket field, or the login directory. */
export const rootDir = (source: StorageSource): string => source.bucket?.trim().replace(/\/+$/, '') || '.';

export function remotePath(source: StorageSource, key: string): string {
  const relative = path.posix.normalize(key || '.');
  if (relative === '..' || relative.startsWith('../') || relative.startsWith('/')) {
    throw new BadRequestError(`File key escapes the storage folder: ${key}`);
  }
  return path.posix.join(rootDir(source), relative);
}

/**
 * Parse an HTTP Range header against a known size. Returns inclusive byte offsets.
 */
export function parseRange(range: string, size: number): { start: number; end: number } | undefined {
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return undefined;
  let start: number;
  let end: number;
  if (!match[1]) {
    // Suffix range: the last N bytes
    start = Math.max(0, size - parseInt(match[2], 10));
    end = size - 1;
  } else {
    start = parseInt(match[1], 10);
    end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1;
  }
  if (start > end || start >= size) return undefined;
  return { start, end };
}

/** The continuation token carries the folders still to visit in a breadth-first walk. */
export const encodeToken = (dirs: string[]): string => Buffer.from(JSON.stringify(dirs)).toString('base64url');
export const decodeToken = (token: string): string[] => JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));

/** SFTP/FTP have no ETag; size + mtime is enough to notice a changed file. */
export const syntheticEtag = (size: number, mtime: number): string => `${size.toString(16)}-${mtime.toString(16)}`;
