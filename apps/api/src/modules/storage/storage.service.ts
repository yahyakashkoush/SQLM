import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export interface StoredFile {
  buffer: Buffer;
  contentType: string;
}

/** Keys under this prefix are world-readable (product/category images, payment QR codes). */
export const PUBLIC_PREFIX = 'public/';

interface StorageBackend {
  verify?(): Promise<void>;
  upload(key: string, body: Buffer, contentType: string): Promise<void>;
  read(key: string): Promise<StoredFile | null>;
  getPresignedUrl(key: string, expiresInSeconds: number): Promise<string>;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private backend: StorageBackend;
  private readonly logger = new Logger(StorageService.name);
  private readonly apiBaseUrl: string;
  private publicBaseUrl: string | undefined;
  private readonly signingKey: string;

  constructor(private readonly config: ConfigService) {
    this.apiBaseUrl = (this.config.get<string>('API_BASE_URL') || 'http://localhost:4000').replace(/\/$/, '');
    this.signingKey = crypto
      .createHash('sha256')
      .update(`local-storage:${this.config.getOrThrow<string>('JWT_ACCESS_SECRET')}`)
      .digest('hex');

    if (this.s3Configured()) {
      this.backend = new S3Backend(config);
      this.publicBaseUrl = this.config.get<string>('S3_PUBLIC_URL')?.replace(/\/$/, '') || undefined;
      this.logger.log('Storage: S3-compatible backend');
    } else {
      this.backend = this.localBackend();
    }
  }

  /**
   * A half-filled or unreachable S3 config would otherwise turn every
   * upload into a 500; fall back to the local volume and say so loudly.
   */
  async onModuleInit(): Promise<void> {
    if (!this.backend.verify || this.config.get<string>('NODE_ENV') === 'test') return;
    try {
      await this.backend.verify();
    } catch (err) {
      this.logger.error(
        `S3 bucket is not usable (${err instanceof Error ? err.message : err}) — falling back to local storage`,
      );
      this.backend = this.localBackend();
      this.publicBaseUrl = undefined;
    }
  }

  private s3Configured(): boolean {
    const endpoint = this.config.get<string>('S3_ENDPOINT') ?? '';
    return (
      /^https?:\/\//.test(endpoint) &&
      Boolean(this.config.get<string>('S3_BUCKET')) &&
      Boolean(this.config.get<string>('S3_ACCESS_KEY_ID')) &&
      Boolean(this.config.get<string>('S3_SECRET_ACCESS_KEY'))
    );
  }

  private localBackend(): LocalBackend {
    const dir = this.config.get<string>('LOCAL_STORAGE_DIR') || path.resolve(process.cwd(), 'storage-data');
    this.logger.warn(`Storage: local filesystem at ${dir}`);
    return new LocalBackend(dir, this.apiBaseUrl, (key, expires) => this.sign(key, expires));
  }

  upload(key: string, body: Buffer, contentType: string): Promise<void> {
    return this.backend.upload(key, body, contentType);
  }

  read(key: string): Promise<StoredFile | null> {
    return this.backend.read(key);
  }

  getPresignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    return this.backend.getPresignedUrl(key, expiresInSeconds);
  }

  /** Stable, unauthenticated URL for a key under PUBLIC_PREFIX. */
  publicUrl(key: string): string {
    if (this.publicBaseUrl) return `${this.publicBaseUrl}/${key}`;
    return `${this.apiBaseUrl}/api/v1/storage/${key}`;
  }

  sign(key: string, expires: number): string {
    return crypto
      .createHmac('sha256', this.signingKey)
      .update(`${key}:${expires}`)
      .digest('hex')
      .slice(0, 32);
  }

  verifySignature(key: string, expires: number, token: string): boolean {
    const expected = Buffer.from(this.sign(key, expires));
    const given = Buffer.from(token ?? '');
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  }
}

class S3Backend implements StorageBackend {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    this.client = new S3Client({
      endpoint: config.getOrThrow<string>('S3_ENDPOINT'),
      region: config.get<string>('S3_REGION', 'us-east-1'),
      forcePathStyle: config.get<boolean>('S3_FORCE_PATH_STYLE', true),
      credentials: {
        accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('S3_SECRET_ACCESS_KEY'),
      },
    });
  }

  async verify(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }), {
      abortSignal: AbortSignal.timeout(5000),
    });
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async read(key: string): Promise<StoredFile | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) return null;
      const bytes = await res.Body.transformToByteArray();
      return { buffer: Buffer.from(bytes), contentType: res.ContentType ?? 'application/octet-stream' };
    } catch {
      return null;
    }
  }

  async getPresignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}

const META_EXT = '.meta';

class LocalBackend implements StorageBackend {
  constructor(
    private readonly dir: string,
    private readonly apiBaseUrl: string,
    private readonly sign: (key: string, expires: number) => string,
  ) {}

  private resolve(key: string): string | null {
    const filePath = path.resolve(this.dir, key);
    // Keys come from URLs on the read path; never let one escape the storage root.
    return filePath.startsWith(this.dir + path.sep) ? filePath : null;
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    const filePath = this.resolve(key);
    if (!filePath) throw new Error(`Invalid storage key: ${key}`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body);
    await fs.writeFile(filePath + META_EXT, JSON.stringify({ contentType }));
  }

  async read(key: string): Promise<StoredFile | null> {
    const filePath = this.resolve(key);
    if (!filePath || filePath.endsWith(META_EXT)) return null;
    try {
      const buffer = await fs.readFile(filePath);
      let contentType = 'application/octet-stream';
      try {
        const meta = JSON.parse(await fs.readFile(filePath + META_EXT, 'utf-8')) as { contentType?: string };
        contentType = meta.contentType ?? contentType;
      } catch {
        /* no metadata sidecar */
      }
      return { buffer, contentType };
    } catch {
      return null;
    }
  }

  async getPresignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const expires = Date.now() + expiresInSeconds * 1000;
    return `${this.apiBaseUrl}/api/v1/storage/${key}?expires=${expires}&token=${this.sign(key, expires)}`;
  }
}
