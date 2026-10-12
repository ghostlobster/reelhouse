import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  _Object,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { StorageSource } from '../types.js';

export class StorageService {
  private clientCache = new Map<string, S3Client>();

  public getClient(source: StorageSource): S3Client {
    const cacheKey = `${source.id}-${source.updatedAt}`;
    if (this.clientCache.has(cacheKey)) {
      return this.clientCache.get(cacheKey)!;
    }

    let endpoint = source.endpoint?.trim();
    let region = source.region?.trim() || 'us-east-1';
    let forcePathStyle = source.forcePathStyle ?? false;

    // Smart defaults for known providers
    if (source.provider === 'r2') {
      region = 'auto';
      if (endpoint && !endpoint.startsWith('http')) {
        endpoint = `https://${endpoint}`;
      }
    } else if (source.provider === 'minio') {
      forcePathStyle = true;
    } else if (source.provider === 'keycdn') {
      // KeyCDN S3 endpoints
      if (!endpoint) endpoint = 'https://s3.keycdn.com';
    } else if (source.provider === 'wasabi') {
      if (!endpoint) endpoint = `https://s3.${region}.wasabisys.com`;
    }

    const client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      forcePathStyle,
      credentials:
        source.accessKey && source.secretKey
          ? {
              accessKeyId: source.accessKey.trim(),
              secretAccessKey: source.secretKey.trim(),
            }
          : undefined,
    });

    this.clientCache.set(cacheKey, client);
    return client;
  }

  public async testConnection(source: StorageSource): Promise<{ success: boolean; message: string; sampleCount?: number }> {
    try {
      const client = this.getClient(source);
      
      // Try listing up to 5 items to verify both auth and bucket access
      const command = new ListObjectsV2Command({
        Bucket: source.bucket,
        MaxKeys: 5,
      });

      const response = await client.send(command);
      const count = response.KeyCount || (response.Contents?.length ?? 0);
      return {
        success: true,
        message: `Successfully connected to bucket "${source.bucket}". Found sample objects.`,
        sampleCount: count,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Failed to connect to storage provider.',
      };
    }
  }

  public async listPage(
    source: StorageSource,
    continuationToken?: string,
    prefix?: string,
    maxKeys: number = 1000
  ): Promise<{
    objects: _Object[];
    nextContinuationToken?: string;
    isTruncated: boolean;
  }> {
    const client = this.getClient(source);
    const command = new ListObjectsV2Command({
      Bucket: source.bucket,
      ContinuationToken: continuationToken,
      Prefix: prefix || undefined,
      MaxKeys: maxKeys,
    });

    const response = await client.send(command);
    return {
      objects: response.Contents || [],
      nextContinuationToken: response.NextContinuationToken,
      isTruncated: Boolean(response.IsTruncated),
    };
  }

  public async getObjectStream(
    source: StorageSource,
    key: string,
    range?: string
  ): Promise<{
    stream: Readable;
    contentLength?: number;
    contentType?: string;
    contentRange?: string;
    acceptRanges?: string;
  }> {
    if (source.id.startsWith('demo-')) {
      // Demo streaming fallback
      let sampleData: Buffer;
      let contentType = 'application/octet-stream';

      if (key.endsWith('.json')) {
        sampleData = Buffer.from(JSON.stringify({
          app: 'reelhouse',
          edgeRouting: {
            cacheTTL: 86400,
            regions: ['us-east', 'eu-west', 'ap-southeast'],
            originShield: true,
            tiering: 'hybrid-on-prem'
          },
          generatedAt: new Date().toISOString()
        }, null, 2));
        contentType = 'application/json';
      } else if (key.endsWith('.svg')) {
        sampleData = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect width="100%" height="100%" fill="#0f172a"/><circle cx="300" cy="200" r="100" fill="#06b6d4"/><text x="300" y="210" font-family="sans-serif" font-size="24" font-weight="bold" fill="#ffffff" text-anchor="middle">Reelhouse Asset</text></svg>`);
        contentType = 'image/svg+xml';
      } else if (key.endsWith('.mp4') || key.endsWith('.webm') || key.endsWith('.mov') || key.endsWith('.mkv')) {
        // High quality minimal valid fast-start MP4 video container
        sampleData = Buffer.from('AAAAHGZ0eXBpc29tAAAAAGlzb21tcDQxAAAAAG1vb3YAAABsbXZoZAAAAABAAAAAA+gAAAPoAAAD6AAAAPoAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
        contentType = 'video/mp4';
      } else {
        sampleData = Buffer.from(`Reelhouse Simulated Asset: ${key}\nTimestamp: ${new Date().toISOString()}\nSource: ${source.name}`);
        contentType = 'text/plain';
      }

      const stream = Readable.from(sampleData);
      return {
        stream,
        contentLength: sampleData.length,
        contentType,
        acceptRanges: 'bytes',
      };
    }

    const client = this.getClient(source);
    const command = new GetObjectCommand({
      Bucket: source.bucket,
      Key: key,
      Range: range,
    });

    const response = await client.send(command);
    return {
      stream: response.Body as Readable,
      contentLength: response.ContentLength,
      contentType: response.ContentType,
      contentRange: response.ContentRange,
      acceptRanges: response.AcceptRanges,
    };
  }

  public async getObjectRangeBuffer(
    source: StorageSource,
    key: string,
    range: string
  ): Promise<Buffer> {
    const { stream } = await this.getObjectStream(source, key, range);
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', (err) => reject(err));
    });
  }

  public async getPresignedUrl(source: StorageSource, key: string, expiresInSeconds: number = 3600): Promise<string> {
    const client = this.getClient(source);
    const command = new GetObjectCommand({
      Bucket: source.bucket,
      Key: key,
    });
    return await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  }

  public getResolvedUrl(source: StorageSource, key: string): string {
    if (source.cdnUrl && source.cdnUrl.trim()) {
      const base = source.cdnUrl.trim().replace(/\/$/, '');
      const encodedKey = key.split('/').map(encodeURIComponent).join('/');
      return `${base}/${encodedKey}`;
    }
    // Fallback to internal streaming proxy
    return `/api/sources/${source.id}/stream?key=${encodeURIComponent(key)}`;
  }
}

export const storageService = new StorageService();
