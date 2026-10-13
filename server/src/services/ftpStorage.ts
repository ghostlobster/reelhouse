import { Client, FileType } from 'basic-ftp';
import { PassThrough, Readable, Writable } from 'node:stream';
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

// An FTP connection runs one command at a time, so each source gets a small pool
const MAX_CONNECTIONS = 3;
// Log out idle connections so they don't count against the server's per-user login limit
const IDLE_TIMEOUT_MS = 30000;
const PAGE_TIME_BUDGET_MS = 2000;
// FTP replies meaning "try again": too many users, can't open data connection, transfer aborted, file busy
const TRANSIENT_FTP_CODES = new Set([421, 425, 426, 450]);

class FtpPool {
  private idle: Array<{ client: Client; timer: NodeJS.Timeout }> = [];
  private open = 0;
  private waiters: Array<() => void> = [];
  private retired = false;

  constructor(
    private source: StorageSource,
    readonly signature: string
  ) {}

  async acquire(): Promise<Client> {
    for (;;) {
      const entry = this.idle.pop();
      if (entry) {
        clearTimeout(entry.timer);
        if (!entry.client.closed) return entry.client;
        this.open--;
        continue;
      }
      if (this.open < MAX_CONNECTIONS) {
        this.open++;
        try {
          return await connectWithRetry(this.source);
        } catch (err) {
          this.open--;
          this.wake();
          throw err;
        }
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  release(client: Client): void {
    if (client.closed || this.retired) {
      if (!client.closed) client.close();
      this.open--;
    } else {
      const timer = setTimeout(() => {
        this.idle = this.idle.filter((e) => e.client !== client);
        client.close();
        this.open--;
      }, IDLE_TIMEOUT_MS);
      timer.unref();
      this.idle.push({ client, timer });
    }
    this.wake();
  }

  /** Drop a connection that was interrupted mid-transfer and can't be reused. */
  discard(client: Client): void {
    client.close();
    this.open--;
    this.wake();
  }

  /** Connection settings changed: log out idle connections, and busy ones as they finish. */
  retire(): void {
    this.retired = true;
    for (const { client, timer } of this.idle) {
      clearTimeout(timer);
      client.close();
      this.open--;
    }
    this.idle = [];
  }

  private wake(): void {
    this.waiters.shift()?.();
  }
}

async function connectFtp(source: StorageSource): Promise<Client> {
  const { protocol, host, port } = parseFileEndpoint(source.endpoint);
  const client = new Client(30000);
  try {
    await client.access({
      host,
      port,
      user: source.accessKey?.trim(),
      password: source.secretKey || undefined,
      secure: protocol === 'ftps',
    });
    return client;
  } catch (err) {
    client.close();
    throw err;
  }
}

/**
 * A connection we just closed (e.g. after a cut-off range read) can still count against the
 * server's login limit for a moment, so "421 too many users" is retried with a short backoff.
 */
async function connectWithRetry(source: StorageSource): Promise<Client> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await connectFtp(source);
    } catch (err: any) {
      if (err?.code !== 421 || attempt >= 3) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

export class FtpStorage implements FileServerBackend {
  private pools = new Map<string, FtpPool>();

  private pool(source: StorageSource): FtpPool {
    const signature = connectionSignature(source);
    let pool = this.pools.get(source.id);
    if (!pool || pool.signature !== signature) {
      pool?.retire();
      pool = new FtpPool(source, signature);
      this.pools.set(source.id, pool);
    }
    return pool;
  }

  /**
   * Run one command on a pooled connection. Retries when the server had dropped an idle
   * connection, or answered with a temporary (4xx) error such as a busy data port.
   */
  private async withClient<T>(source: StorageSource, fn: (client: Client) => Promise<T>): Promise<T> {
    const pool = this.pool(source);
    for (let attempt = 0; ; attempt++) {
      const client = await pool.acquire();
      try {
        const result = await fn(client);
        pool.release(client);
        return result;
      } catch (err: any) {
        const dropped = client.closed;
        pool.release(client);
        const transient = dropped || TRANSIENT_FTP_CODES.has(err?.code);
        if (!transient || attempt >= 2) throw err;
        if (!dropped) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }

  public async testConnection(source: StorageSource): Promise<{ success: boolean; message: string; sampleCount?: number }> {
    let client: Client | undefined;
    try {
      const { protocol } = parseFileEndpoint(source.endpoint);
      client = await connectFtp(source);
      const entries = await client.list(rootDir(source));
      return {
        success: true,
        message: `Connected over ${protocol.toUpperCase()}. Folder "${rootDir(source)}" has ${entries.length} entries.`,
        sampleCount: entries.length,
      };
    } catch (err: any) {
      // TLS failures (e.g. an untrusted certificate) carry only a code
      return { success: false, message: err.message || err.code || 'Failed to connect to the FTP server.' };
    } finally {
      client?.close();
    }
  }

  public async listPage(
    source: StorageSource,
    continuationToken?: string,
    prefix?: string,
    maxKeys: number = 1000
  ): Promise<{ objects: _Object[]; nextContinuationToken?: string; isTruncated: boolean }> {
    const queue = continuationToken ? decodeToken(continuationToken) : [(prefix || '').replace(/\/+$/, '')];
    const objects: _Object[] = [];
    const startedAt = Date.now();

    // List several folders at once (one per pooled connection). Hand back a page every
    // couple of seconds even if it isn't full, so the scanner can report progress.
    while (queue.length > 0 && objects.length < maxKeys && Date.now() - startedAt < PAGE_TIME_BUDGET_MS) {
      const dirs = queue.splice(0, MAX_CONNECTIONS);
      const listings = await Promise.all(
        dirs.map((dir) => this.withClient(source, (client) => client.list(remotePath(source, dir))))
      );
      listings.forEach((entries, i) => {
        const dir = dirs[i];
        for (const entry of entries) {
          if (entry.name === '.' || entry.name === '..') continue;
          const key = dir ? `${dir}/${entry.name}` : entry.name;
          if (entry.type === FileType.Directory) {
            queue.push(key);
          } else if (entry.type === FileType.File) {
            const mtime = entry.modifiedAt?.getTime() ?? Date.parse(entry.rawModifiedAt);
            objects.push({
              Key: key,
              Size: entry.size,
              LastModified: Number.isNaN(mtime) ? undefined : new Date(mtime),
              ETag: syntheticEtag(entry.size, Number.isNaN(mtime) ? 0 : mtime),
            });
          }
        }
      });
    }

    return {
      objects,
      nextContinuationToken: queue.length > 0 ? encodeToken(queue) : undefined,
      isTruncated: queue.length > 0,
    };
  }

  /**
   * FTP can resume from an offset (REST) but can't stop at one, so a ranged read
   * cuts the transfer off by closing that connection once it has enough bytes.
   */
  public async getObjectStream(
    source: StorageSource,
    key: string,
    range?: string
  ): Promise<{ stream: Readable; contentLength?: number; contentRange?: string; acceptRanges?: string }> {
    const filePath = remotePath(source, key);
    const size = await this.withClient(source, (client) => client.size(filePath));
    const bounds = range ? parseRange(range, size) : undefined;
    const start = bounds?.start ?? 0;
    const length = bounds ? bounds.end - bounds.start + 1 : size;

    const pool = this.pool(source);
    const client = await pool.acquire();
    const out = new PassThrough();
    let remaining = length;
    let settled = false;
    const settle = (reusable: boolean) => {
      if (settled) return;
      settled = true;
      reusable ? pool.release(client) : pool.discard(client);
    };

    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        if (remaining <= 0) return callback();
        const part = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        remaining -= part.length;
        const flowing = out.write(part);
        if (remaining <= 0) {
          out.end();
          // Range satisfied before end of file: abandon the rest of the transfer
          if (start + length < size) settle(false);
          return callback();
        }
        flowing ? callback() : out.once('drain', () => callback());
      },
    });

    // Reader went away (e.g. the browser cancelled a request): stop downloading
    out.on('close', () => {
      if (remaining > 0) settle(false);
    });

    client
      .downloadTo(sink, filePath, start)
      .then(() => {
        out.end();
        settle(true);
      })
      .catch((err) => {
        if (!settled) out.destroy(err);
        settle(false);
      });

    return {
      stream: out,
      contentLength: length,
      contentRange: bounds ? `bytes ${bounds.start}-${bounds.end}/${size}` : undefined,
      acceptRanges: 'bytes',
    };
  }
}

export const ftpStorage = new FtpStorage();
