import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

interface StorageBackend {
  upload(key: string, body: Buffer, contentType: string): Promise<void>;
  getPresignedUrl(key: string, expiresInSeconds: number): Promise<string>;
}

@Injectable()
export class StorageService {
  private readonly backend: StorageBackend;
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.get<string>('S3_ENDPOINT');
    if (endpoint) {
      this.backend = new S3Backend(config);
      this.logger.log('Storage: S3-compatible backend');
    } else {
      const apiUrl = this.config.get<string>('API_BASE_URL', 'http://localhost:4000');
      this.backend = new LocalBackend(apiUrl);
      this.logger.warn('Storage: local filesystem fallback (S3 not configured)');
    }
  }

  upload(key: string, body: Buffer, contentType: string): Promise<void> {
    return this.backend.upload(key, body, contentType);
  }

  getPresignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    return this.backend.getPresignedUrl(key, expiresInSeconds);
  }

  async getLocalFile(key: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    if (!(this.backend instanceof LocalBackend)) return null;
    return this.backend.readFile(key);
  }

  get isLocal(): boolean {
    return this.backend instanceof LocalBackend;
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

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getPresignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}

const STORAGE_DIR = path.resolve(process.cwd(), 'storage-data');
const META_EXT = '.meta';

class LocalBackend implements StorageBackend {
  constructor(private readonly apiBaseUrl: string) {}

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    const filePath = path.join(STORAGE_DIR, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body);
    await fs.writeFile(filePath + META_EXT, JSON.stringify({ contentType }));
  }

  async getPresignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const expires = Date.now() + expiresInSeconds * 1000;
    const token = crypto
      .createHmac('sha256', 'local-storage-key')
      .update(`${key}:${expires}`)
      .digest('hex')
      .slice(0, 32);
    return `${this.apiBaseUrl}/api/v1/storage/local/${encodeURIComponent(key)}?expires=${expires}&token=${token}`;
  }

  async readFile(key: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    const filePath = path.join(STORAGE_DIR, key);
    try {
      const buffer = await fs.readFile(filePath);
      let contentType = 'application/octet-stream';
      try {
        const meta = JSON.parse(await fs.readFile(filePath + META_EXT, 'utf-8'));
        contentType = meta.contentType ?? contentType;
      } catch { /* no meta */ }
      return { buffer, contentType };
    } catch {
      return null;
    }
  }
}
