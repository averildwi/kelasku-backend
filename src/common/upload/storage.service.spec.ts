import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  buildWhiteboardFolder,
  parseCloudinaryUrl,
  signCloudinaryParams,
  StorageService,
} from './storage.service';

const CLOUDINARY_URL = 'cloudinary://key:secret@demo-cloud';

function jsonResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

describe('StorageService helpers', () => {
  it('builds the class-specific whiteboard folder', () => {
    expect(buildWhiteboardFolder('class-1')).toBe('kelasku/class-1/whiteboard');
  });

  it('parses the cloudinary url into its parts', () => {
    expect(parseCloudinaryUrl(CLOUDINARY_URL)).toEqual({
      apiKey: 'key',
      apiSecret: 'secret',
      cloudName: 'demo-cloud',
    });
  });

  it('rejects a malformed cloudinary url', () => {
    expect(() => parseCloudinaryUrl('https://example.com')).toThrow();
  });

  it('signs the same params regardless of key order', () => {
    expect(signCloudinaryParams({ b: '2', a: '1' }, 'secret')).toBe(
      signCloudinaryParams({ a: '1', b: '2' }, 'secret'),
    );
    expect(signCloudinaryParams({ a: '1' }, 'secret')).not.toBe(
      signCloudinaryParams({ a: '1' }, 'other'),
    );
  });
});

describe('StorageService', () => {
  let service: StorageService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');

    const moduleRef = await Test.createTestingModule({
      providers: [
        StorageService,
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue(CLOUDINARY_URL) },
        },
      ],
    }).compile();

    service = moduleRef.get(StorageService);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('StorageService.uploadImage', () => {
    it('uploads to the given folder and maps the Cloudinary response', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse({
          secure_url: 'https://res.cloudinary.com/demo/image/upload/wb.jpg',
          public_id: 'kelasku/class-1/whiteboard/wb',
          width: 1200,
          height: 900,
        }),
      );

      const result = await service.uploadImage(
        {
          buffer: Buffer.from('image'),
          mimetype: 'image/jpeg',
          size: 5,
          originalname: 'wb.jpg',
        },
        buildWhiteboardFolder('class-1'),
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://api.cloudinary.com/v1_1/demo-cloud/image/upload',
      );
      expect(init.method).toBe('POST');
      const form = init.body as FormData;
      expect(form.get('folder')).toBe('kelasku/class-1/whiteboard');
      expect(form.get('api_key')).toBe('key');
      expect(form.get('signature')).toEqual(expect.any(String));
      expect(result).toEqual({
        url: 'https://res.cloudinary.com/demo/image/upload/wb.jpg',
        publicId: 'kelasku/class-1/whiteboard/wb',
        width: 1200,
        height: 900,
      });
    });

    it('throws when Cloudinary rejects the upload', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({}, false, 500));

      await expect(
        service.uploadImage(
          {
            buffer: Buffer.from('image'),
            mimetype: 'image/png',
            size: 5,
          },
          'kelasku/class-1/whiteboard',
        ),
      ).rejects.toThrow('Cloudinary upload failed with 500');
    });
  });

  describe('StorageService.deleteImage', () => {
    it('destroys the image by public id', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ result: 'ok' }));

      await service.deleteImage('kelasku/class-1/whiteboard/wb');

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://api.cloudinary.com/v1_1/demo-cloud/image/destroy',
      );
      const form = init.body as FormData;
      expect(form.get('public_id')).toBe('kelasku/class-1/whiteboard/wb');
      expect(form.get('api_key')).toBe('key');
    });

    it('does not swallow a failed delete', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({}, false, 500));

      await expect(
        service.deleteImage('kelasku/class-1/whiteboard/wb'),
      ).rejects.toThrow('Cloudinary delete failed with 500');
    });
  });
});
