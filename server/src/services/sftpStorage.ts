import SftpClient from 'ssh2-sftp-client';
import { Readable } from 'node:stream';
import { _Object } from '@aws-sdk/client-s3';
import { StorageSource } from '../types.js';
import {
  FileServerBackend,
  parseFileEndpoint,
  rootDir,
  remotePath,
  parseRange,
  encodeToken,
  decodeToken,
  syntheticEtag,
  connectionSignature,
} from './remoteFs.js';

export class SftpStorage implements FileServerBackend {
  // One shared connection per source; SFTP multiplexes concurrent requests over it
  private connections = new Map<string, { signature: string; pending: Promise<SftpClient> }>();

  private connect(source: StorageSource): Promise<SftpClient> {
    const { host, port } = parseFileEndpoint(source.endpoint);
    const client = new SftpClient(`reelhouse-${source.id}`);
    return client
      .connect({
        host,
        port,
        username: source.accessKey?.trim(),
        password: source.secretKey || undefined,
        readyTimeout: 15000,
        keepaliveInterval: 30000,
      })
      .then(() => client);
  }

  private getClient(source: StorageSource): Promise<SftpClient> {
    const signature = connectionSignature(source);
    const cached = this.connections.get(source.id);
    if (cached?.signature === signature) return cached.pending;

    // Connection settings changed: close the old session
    cached?.pending.then((old) => old.end()).catch(() => {});

    const entry = { signature, pending: this.connect(source) };
    const drop = () => {
      if (this.connections.get(source.id) === entry) this.connections.delete(source.id);
    };
    entry.pending.then((client) => {
      client.on('end', drop);
      client.on('close', drop);
      client.on('error', drop);
    }, drop);
    this.connections.set(source.id, entry);
    return entry.pending;
  }

  public async testConnection(source: StorageSource): Promise<{ success: boolean; message: string; sampleCount?: number }> {
    let client: SftpClient | undefined;
    try {
      client = await this.connect(source);
      const entries = await client.list(rootDir(source));
      return {
        success: true,
        message: `Connected over SFTP. Folder "${rootDir(source)}" has ${entries.length} entries.`,
        sampleCount: entries.length,
      };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to connect over SFTP.' };
    } finally {
      await client?.end().catch(() => {});
    }
  }

  /**
   * Walk the folder tree breadth-first. The continuation token carries the folders
   * still to visit, so the scanner can page through it like an S3 listing.
   */
  public async listPage(
    source: StorageSource,
    continuationToken?: string,
    prefix?: string,
    maxKeys: number = 1000
  ): Promise<{ objects: _Object[]; nextContinuationToken?: string; isTruncated: boolean }> {
    const client = await this.getClient(source);
    const queue = continuationToken ? decodeToken(continuationToken) : [(prefix || '').replace(/\/+$/, '')];
    const objects: _Object[] = [];

    while (queue.length > 0 && objects.length < maxKeys) {
      const dir = queue.shift()!;
      const entries = await client.list(remotePath(source, dir));
      for (const entry of entries) {
        const key = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.type === 'd') {
          queue.push(key);
        } else if (entry.type === '-') {
          objects.push({
            Key: key,
            Size: entry.size,
            LastModified: new Date(entry.modifyTime),
            ETag: syntheticEtag(entry.size, entry.modifyTime),
          });
        }
      }
    }

    return {
      objects,
      nextContinuationToken: queue.length > 0 ? encodeToken(queue) : undefined,
      isTruncated: queue.length > 0,
    };
  }

  public async getObjectStream(
    source: StorageSource,
    key: string,
    range?: string
  ): Promise<{ stream: Readable; contentLength?: number; contentRange?: string; acceptRanges?: string }> {
    const client = await this.getClient(source);
    const filePath = remotePath(source, key);
    const { size } = await client.stat(filePath);

    const bounds = range ? parseRange(range, size) : undefined;
    if (bounds) {
      return {
        stream: client.createReadStream(filePath, { start: bounds.start, end: bounds.end }) as unknown as Readable,
        contentLength: bounds.end - bounds.start + 1,
        contentRange: `bytes ${bounds.start}-${bounds.end}/${size}`,
        acceptRanges: 'bytes',
      };
    }
    return {
      stream: client.createReadStream(filePath) as unknown as Readable,
      contentLength: size,
      acceptRanges: 'bytes',
    };
  }
}

export const sftpStorage = new SftpStorage();
