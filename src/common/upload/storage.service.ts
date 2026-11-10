import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Minimal shape of an uploaded file, so this module does not depend on multer types. */
export interface UploadedImageFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
}

/** What the app stores about an image: never expose `publicId` through the API. */
export interface StoredImage {
  url: string;
  publicId: string;
  width: number;
  height: number;
}

interface CloudinaryCredentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

interface CloudinaryUploadResponse {
  secure_url: string;
  public_id: string;
  width: number;
  height: number;
}

/** BR-13: every whiteboard image lives under this class-specific folder. */
export function buildWhiteboardFolder(classId: string): string {
  return `kelasku/${classId}/whiteboard`;
}

/** Parses the `cloudinary://<key>:<secret>@<cloud>` env value. */
export function parseCloudinaryUrl(url: string): CloudinaryCredentials {
  const match = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(url);
  if (!match) {
    throw new Error(
      'CLOUDINARY_URL must look like cloudinary://key:secret@cloud',
    );
  }
  return { apiKey: match[1], apiSecret: match[2], cloudName: match[3] };
}

/** Cloudinary signs the sorted parameter string with SHA-1 of the API secret. */
export function signCloudinaryParams(
  params: Record<string, string | number>,
  apiSecret: string,
): string {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return createHash('sha1').update(`${toSign}${apiSecret}`).digest('hex');
}

/**
 * Cloudinary image transport. Credentials are read lazily, so a missing upload
 * config never fails boot; the caller handles delivery failures.
 */
@Injectable()
export class StorageService {
  constructor(private readonly config: ConfigService) {}

  async uploadImage(
    file: UploadedImageFile,
    folder: string,
  ): Promise<StoredImage> {
    const credentials = this.credentials();
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signCloudinaryParams(
      { folder, timestamp },
      credentials.apiSecret,
    );

    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
      file.originalname ?? 'whiteboard',
    );
    form.append('api_key', credentials.apiKey);
    form.append('timestamp', String(timestamp));
    form.append('folder', folder);
    form.append('signature', signature);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${credentials.cloudName}/image/upload`,
      { method: 'POST', body: form },
    );
    if (!response.ok) {
      // The body can echo internal details, so only the status is reported.
      throw new Error(`Cloudinary upload failed with ${response.status}`);
    }

    const body = (await response.json()) as CloudinaryUploadResponse;
    return {
      url: body.secure_url,
      publicId: body.public_id,
      width: body.width,
      height: body.height,
    };
  }

  /** Deletes one image. Failures reject, so the caller decides how to log them. */
  async deleteImage(publicId: string): Promise<void> {
    const credentials = this.credentials();
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signCloudinaryParams(
      { public_id: publicId, timestamp },
      credentials.apiSecret,
    );

    const form = new FormData();
    form.append('public_id', publicId);
    form.append('api_key', credentials.apiKey);
    form.append('timestamp', String(timestamp));
    form.append('signature', signature);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${credentials.cloudName}/image/destroy`,
      { method: 'POST', body: form },
    );
    if (!response.ok) {
      throw new Error(`Cloudinary delete failed with ${response.status}`);
    }
  }

  private credentials(): CloudinaryCredentials {
    return parseCloudinaryUrl(this.config.getOrThrow<string>('CLOUDINARY_URL'));
  }
}
