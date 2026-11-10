import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClassRole } from '../../generated/prisma/client';
import { StorageService } from '../common/upload/storage.service';
import type { UploadedImageFile } from '../common/upload/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueryWhiteboardDto } from './dto/query-whiteboard.dto';
import {
  jakartaToday,
  MAX_WHITEBOARD_FILE_SIZE,
  parseDateOnly,
  whiteboardDetailSelect,
  whiteboardNoteSelect,
  WhiteboardsService,
} from './whiteboards.service';

interface StoredImageRow {
  id: string;
  url: string;
  width: number;
  height: number;
  position: number;
}

interface WhiteboardNoteRow {
  id: string;
  classId: string;
  subjectId: string;
  uploaderId: string;
  date: Date;
  caption: string | null;
  createdAt: Date;
  updatedAt: Date;
  subject: { id: string; name: string; color: string | null };
  uploader: { id: string; name: string; avatarUrl: string | null };
  images: StoredImageRow[];
}

function whiteboardRow(
  overrides: Partial<WhiteboardNoteRow> = {},
): WhiteboardNoteRow {
  return {
    id: 'n1',
    classId: 'c1',
    subjectId: 's1',
    uploaderId: 'u1',
    date: parseDateOnly('2026-11-11'),
    caption: null,
    createdAt: new Date('2026-11-11T00:00:00.000Z'),
    updatedAt: new Date('2026-11-11T00:00:00.000Z'),
    subject: { id: 's1', name: 'Matematika', color: null },
    uploader: { id: 'u1', name: 'Budi', avatarUrl: null },
    images: [
      {
        id: 'img1',
        url: 'https://img/1',
        width: 100,
        height: 200,
        position: 0,
      },
    ],
    ...overrides,
  };
}

function uploadFile(mimetype = 'image/jpeg', size = 1024): UploadedImageFile {
  return { buffer: Buffer.from('image'), mimetype, size };
}

interface WhiteboardTx {
  whiteboardNote: {
    create: jest.Mock;
    findUniqueOrThrow: jest.Mock;
  };
  whiteboardImage: { createMany: jest.Mock };
}

describe('WhiteboardsService', () => {
  let service: WhiteboardsService;
  let tx: WhiteboardTx;
  let prisma: {
    classroom: { findUnique: jest.Mock };
    subject: { findFirst: jest.Mock };
    whiteboardNote: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let storage: { uploadImage: jest.Mock; deleteImage: jest.Mock };

  beforeEach(async () => {
    tx = {
      whiteboardNote: { create: jest.fn(), findUniqueOrThrow: jest.fn() },
      whiteboardImage: { createMany: jest.fn() },
    };
    prisma = {
      classroom: { findUnique: jest.fn() },
      subject: { findFirst: jest.fn() },
      whiteboardNote: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      // Both forms are used: interactive for create, batch for list + count.
      $transaction: jest.fn((arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (client: WhiteboardTx) => Promise<unknown>)(tx);
        }
        return Promise.all(arg as Promise<unknown>[]);
      }),
    };
    storage = {
      uploadImage: jest.fn(),
      deleteImage: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WhiteboardsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = moduleRef.get(WhiteboardsService);
  });

  describe('whiteboard date helpers', () => {
    it('parses a calendar date as midnight UTC', () => {
      expect(parseDateOnly('2026-11-11').toISOString()).toBe(
        '2026-11-11T00:00:00.000Z',
      );
    });

    it('rolls over to the Jakarta date when UTC is still the previous evening', () => {
      expect(jakartaToday(new Date('2026-11-10T20:00:00.000Z'))).toBe(
        '2026-11-11',
      );
    });
  });

  describe('WhiteboardsService.create', () => {
    beforeEach(() => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
    });

    it('uploads to the class folder and creates the note with its images', async () => {
      const files = [uploadFile('image/jpeg'), uploadFile('image/png')];
      const note = whiteboardRow();
      prisma.subject.findFirst.mockResolvedValue({ id: 's1' });
      storage.uploadImage
        .mockResolvedValueOnce({
          url: 'https://img/1',
          publicId: 'p1',
          width: 100,
          height: 200,
        })
        .mockResolvedValueOnce({
          url: 'https://img/2',
          publicId: 'p2',
          width: 300,
          height: 400,
        });
      tx.whiteboardNote.create.mockResolvedValue({ id: 'n1' });
      tx.whiteboardImage.createMany.mockResolvedValue({ count: 2 });
      tx.whiteboardNote.findUniqueOrThrow.mockResolvedValue(note);

      const result = await service.create(
        'c1',
        'w1',
        {
          subjectId: 's1',
          date: '2026-11-11',
          caption: 'Algebra',
        },
        files,
      );

      expect(storage.uploadImage).toHaveBeenNthCalledWith(
        1,
        files[0],
        'kelasku/c1/whiteboard',
      );
      expect(tx.whiteboardNote.create).toHaveBeenCalledWith({
        data: {
          classId: 'c1',
          subjectId: 's1',
          uploaderId: 'w1',
          date: parseDateOnly('2026-11-11'),
          caption: 'Algebra',
        },
        select: whiteboardNoteSelect,
      });
      expect(tx.whiteboardImage.createMany).toHaveBeenCalledWith({
        data: [
          {
            noteId: 'n1',
            url: 'https://img/1',
            cloudinaryPublicId: 'p1',
            width: 100,
            height: 200,
            position: 0,
          },
          {
            noteId: 'n1',
            url: 'https://img/2',
            cloudinaryPublicId: 'p2',
            width: 300,
            height: 400,
            position: 1,
          },
        ],
      });
      expect(result).toBe(note);
    });

    it('rejects an empty upload with BadRequest and uploads nothing', async () => {
      await expect(
        service.create('c1', 'w1', { subjectId: 's1', date: '2026-11-11' }, []),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.uploadImage).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects more than five images with BadRequest', async () => {
      const files = Array.from({ length: 6 }, () => uploadFile());

      await expect(
        service.create(
          'c1',
          'w1',
          { subjectId: 's1', date: '2026-11-11' },
          files,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.uploadImage).not.toHaveBeenCalled();
    });

    it('rejects an unsupported mime type with BadRequest', async () => {
      await expect(
        service.create('c1', 'w1', { subjectId: 's1', date: '2026-11-11' }, [
          uploadFile('image/gif'),
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.uploadImage).not.toHaveBeenCalled();
    });

    it('rejects a file larger than 5 MB with BadRequest', async () => {
      await expect(
        service.create('c1', 'w1', { subjectId: 's1', date: '2026-11-11' }, [
          uploadFile('image/jpeg', MAX_WHITEBOARD_FILE_SIZE + 1),
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.uploadImage).not.toHaveBeenCalled();
    });

    it('rejects a future date with BadRequest', async () => {
      await expect(
        service.create('c1', 'w1', { subjectId: 's1', date: '2999-01-01' }, [
          uploadFile(),
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.uploadImage).not.toHaveBeenCalled();
    });

    it('rejects a subject that is not in the class', async () => {
      prisma.subject.findFirst.mockResolvedValue(null);

      await expect(
        service.create('c1', 'w1', { subjectId: 's9', date: '2026-11-11' }, [
          uploadFile(),
        ]),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.uploadImage).not.toHaveBeenCalled();
    });

    it('rejects a non-member with Forbidden and uploads nothing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });

      await expect(
        service.create('c1', 'u9', { subjectId: 's1', date: '2026-11-11' }, [
          uploadFile(),
        ]),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(storage.uploadImage).not.toHaveBeenCalled();
    });

    it('cleans up already-uploaded images when a later upload fails', async () => {
      prisma.subject.findFirst.mockResolvedValue({ id: 's1' });
      storage.uploadImage
        .mockResolvedValueOnce({
          url: 'https://img/1',
          publicId: 'p1',
          width: 100,
          height: 200,
        })
        .mockRejectedValueOnce(new Error('upload down'));

      await expect(
        service.create('c1', 'w1', { subjectId: 's1', date: '2026-11-11' }, [
          uploadFile(),
          uploadFile(),
        ]),
      ).rejects.toThrow('upload down');
      expect(storage.deleteImage).toHaveBeenCalledWith('p1');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('WhiteboardsService.findAll', () => {
    beforeEach(() => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
    });

    it('lists non-deleted notes with a shared where and pagination meta', async () => {
      const rows = [whiteboardRow()];
      prisma.whiteboardNote.findMany.mockResolvedValue(rows);
      prisma.whiteboardNote.count.mockResolvedValue(1);
      const query = new QueryWhiteboardDto();
      query.subjectId = 's1';
      query.from = '2026-11-01';
      query.to = '2026-11-30';

      const result = await service.findAll('c1', 'w1', query);

      expect(prisma.whiteboardNote.findMany).toHaveBeenCalledWith({
        where: {
          classId: 'c1',
          deletedAt: null,
          subjectId: 's1',
          date: {
            gte: parseDateOnly('2026-11-01'),
            lte: parseDateOnly('2026-11-30'),
          },
        },
        select: whiteboardDetailSelect,
        skip: 0,
        take: 20,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      });
      expect(prisma.whiteboardNote.count).toHaveBeenCalledWith({
        where: {
          classId: 'c1',
          deletedAt: null,
          subjectId: 's1',
          date: {
            gte: parseDateOnly('2026-11-01'),
            lte: parseDateOnly('2026-11-30'),
          },
        },
      });
      expect(result).toEqual({
        data: rows,
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      });
    });

    it('filters by an exact date when one is given', async () => {
      prisma.whiteboardNote.findMany.mockResolvedValue([]);
      prisma.whiteboardNote.count.mockResolvedValue(0);
      const query = new QueryWhiteboardDto();
      query.date = '2026-11-11';

      await service.findAll('c1', 'w1', query);

      expect(prisma.whiteboardNote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            classId: 'c1',
            deletedAt: null,
            date: { equals: parseDateOnly('2026-11-11') },
          },
        }),
      );
    });

    it('rejects a non-member and reads nothing', async () => {
      await expect(
        service.findAll('c1', 'u9', new QueryWhiteboardDto()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.whiteboardNote.findMany).not.toHaveBeenCalled();
    });
  });

  describe('WhiteboardsService.findOne', () => {
    it('returns the note detail for an active member', async () => {
      const note = whiteboardRow();
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ id: 'm1' }],
      });
      prisma.whiteboardNote.findFirst.mockResolvedValue(note);

      await expect(service.findOne('c1', 'n1', 'u1')).resolves.toBe(note);
      expect(prisma.whiteboardNote.findFirst).toHaveBeenCalledWith({
        where: { id: 'n1', classId: 'c1', deletedAt: null },
        select: whiteboardDetailSelect,
      });
    });

    it('throws NotFoundException when the note is missing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.whiteboardNote.findFirst.mockResolvedValue(null);

      await expect(service.findOne('c1', 'n1', 'w1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('WhiteboardsService.update', () => {
    it('updates the note for its uploader', async () => {
      const updated = whiteboardRow({ caption: 'New caption' });
      prisma.whiteboardNote.findFirst.mockResolvedValue({
        id: 'n1',
        uploaderId: 'u1',
      });
      prisma.whiteboardNote.update.mockResolvedValue(updated);

      const result = await service.update('c1', 'n1', 'u1', {
        caption: 'New caption',
      });

      expect(prisma.whiteboardNote.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { caption: 'New caption' },
        select: whiteboardDetailSelect,
      });
      expect(result).toBe(updated);
    });

    it('validates the new subject belongs to the class', async () => {
      prisma.whiteboardNote.findFirst.mockResolvedValue({
        id: 'n1',
        uploaderId: 'u1',
      });
      prisma.subject.findFirst.mockResolvedValue({ id: 's2' });
      prisma.whiteboardNote.update.mockResolvedValue(whiteboardRow());

      await service.update('c1', 'n1', 'u1', { subjectId: 's2' });

      expect(prisma.subject.findFirst).toHaveBeenCalledWith({
        where: { id: 's2', classId: 'c1', deletedAt: null },
        select: { id: true },
      });
    });

    it('rejects a non-uploader with Forbidden and writes nothing', async () => {
      prisma.whiteboardNote.findFirst.mockResolvedValue({
        id: 'n1',
        uploaderId: 'u1',
      });

      await expect(
        service.update('c1', 'n1', 'u2', { caption: 'Nope' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.whiteboardNote.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the note is missing', async () => {
      prisma.whiteboardNote.findFirst.mockResolvedValue(null);

      await expect(
        service.update('c1', 'n1', 'u1', { caption: 'Nope' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.whiteboardNote.update).not.toHaveBeenCalled();
    });

    it('rejects a future date with BadRequest and writes nothing', async () => {
      prisma.whiteboardNote.findFirst.mockResolvedValue({
        id: 'n1',
        uploaderId: 'u1',
      });

      await expect(
        service.update('c1', 'n1', 'u1', { date: '2999-01-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.whiteboardNote.update).not.toHaveBeenCalled();
    });
  });

  describe('WhiteboardsService.remove', () => {
    it('soft-deletes the note and cleans up its images for the uploader', async () => {
      prisma.whiteboardNote.findFirst.mockResolvedValue({
        id: 'n1',
        uploaderId: 'u1',
        images: [{ cloudinaryPublicId: 'p1' }],
        classroom: { homeroomTeacherId: 'w1', members: [] },
      });
      prisma.whiteboardNote.update.mockResolvedValue({ id: 'n1' });

      await service.remove('c1', 'n1', 'u1');

      const [updateArgs] = prisma.whiteboardNote.update.mock.calls[0] as [
        {
          where: { id: string };
          data: { deletedAt: Date };
          select: { id: boolean };
        },
      ];
      expect(updateArgs.where).toEqual({ id: 'n1' });
      expect(updateArgs.data.deletedAt).toBeInstanceOf(Date);
      expect(updateArgs.select).toEqual({ id: true });
      expect(storage.deleteImage).toHaveBeenCalledWith('p1');
    });

    it('allows an active KETUA to delete another member note', async () => {
      prisma.whiteboardNote.findFirst.mockResolvedValue({
        id: 'n1',
        uploaderId: 'u1',
        images: [],
        classroom: {
          homeroomTeacherId: 'w1',
          members: [{ role: ClassRole.KETUA }],
        },
      });
      prisma.whiteboardNote.update.mockResolvedValue({ id: 'n1' });

      await service.remove('c1', 'n1', 'u2');

      expect(prisma.whiteboardNote.update).toHaveBeenCalled();
    });

    it('allows the homeroom teacher to delete another member note', async () => {
      prisma.whiteboardNote.findFirst.mockResolvedValue({
        id: 'n1',
        uploaderId: 'u1',
        images: [],
        classroom: { homeroomTeacherId: 'w1', members: [] },
      });
      prisma.whiteboardNote.update.mockResolvedValue({ id: 'n1' });

      await service.remove('c1', 'n1', 'w1');

      expect(prisma.whiteboardNote.update).toHaveBeenCalled();
    });

    it('rejects a regular member deleting another note and writes nothing', async () => {
      prisma.whiteboardNote.findFirst.mockResolvedValue({
        id: 'n1',
        uploaderId: 'u1',
        images: [{ cloudinaryPublicId: 'p1' }],
        classroom: {
          homeroomTeacherId: 'w1',
          members: [{ role: ClassRole.MEMBER }],
        },
      });

      await expect(service.remove('c1', 'n1', 'u2')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.whiteboardNote.update).not.toHaveBeenCalled();
      expect(storage.deleteImage).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the note is missing', async () => {
      prisma.whiteboardNote.findFirst.mockResolvedValue(null);

      await expect(service.remove('c1', 'n1', 'u1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.whiteboardNote.update).not.toHaveBeenCalled();
    });

    it('does not fail the request when Cloudinary cleanup fails', async () => {
      prisma.whiteboardNote.findFirst.mockResolvedValue({
        id: 'n1',
        uploaderId: 'u1',
        images: [{ cloudinaryPublicId: 'p1' }],
        classroom: { homeroomTeacherId: 'w1', members: [] },
      });
      prisma.whiteboardNote.update.mockResolvedValue({ id: 'n1' });
      storage.deleteImage.mockRejectedValue(new Error('cloudinary down'));

      await expect(service.remove('c1', 'n1', 'u1')).resolves.toBeUndefined();
      expect(storage.deleteImage).toHaveBeenCalledWith('p1');
    });
  });
});
