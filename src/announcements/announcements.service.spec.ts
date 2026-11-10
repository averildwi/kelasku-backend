import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClassRole } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  announcementSelect,
  AnnouncementsService,
} from './announcements.service';
import { QueryAnnouncementDto } from './dto/query-announcement.dto';

interface AnnouncementRow {
  id: string;
  classId: string;
  authorId: string;
  title: string;
  content: string;
  isPinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; name: string; avatarUrl: string | null };
}

interface UpdateCallArgs {
  where: { id: string };
  data: { deletedAt: Date };
  select: { id: boolean };
}

function announcementRow(
  overrides: Partial<AnnouncementRow> = {},
): AnnouncementRow {
  return {
    id: 'a1',
    classId: 'c1',
    authorId: 'm1',
    title: 'Meeting moved',
    content: 'It is now on Friday',
    isPinned: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    author: { id: 'm1', name: 'Ketua', avatarUrl: null },
    ...overrides,
  };
}

describe('AnnouncementsService', () => {
  let service: AnnouncementsService;
  let prisma: {
    classroom: { findUnique: jest.Mock };
    announcement: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    announcementRead: { upsert: jest.Mock; findMany: jest.Mock };
    classMember: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      classroom: { findUnique: jest.fn() },
      announcement: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      announcementRead: { upsert: jest.fn(), findMany: jest.fn() },
      classMember: { findMany: jest.fn() },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AnnouncementsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(AnnouncementsService);
  });

  describe('AnnouncementsService.create', () => {
    it('creates an announcement when the caller is the homeroom teacher', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.announcement.create.mockResolvedValue(announcementRow());

      const result = await service.create('c1', 'w1', {
        title: 'Meeting moved',
        content: 'It is now on Friday',
      });

      expect(prisma.announcement.create).toHaveBeenCalledWith({
        data: {
          classId: 'c1',
          authorId: 'w1',
          title: 'Meeting moved',
          content: 'It is now on Friday',
          isPinned: false,
        },
        select: announcementSelect,
      });
      expect(result).toMatchObject({ id: 'a1' });
    });

    it('creates an announcement when the caller is an active KETUA', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ role: ClassRole.KETUA }],
      });
      prisma.announcement.create.mockResolvedValue(announcementRow());

      await service.create('c1', 'm1', {
        title: 'Meeting moved',
        content: 'It is now on Friday',
        isPinned: true,
      });

      expect(prisma.announcement.create).toHaveBeenCalledWith({
        data: {
          classId: 'c1',
          authorId: 'm1',
          title: 'Meeting moved',
          content: 'It is now on Friday',
          isPinned: true,
        },
        select: announcementSelect,
      });
    });

    it('throws ForbiddenException for an active MEMBER and writes nothing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ role: ClassRole.MEMBER }],
      });

      await expect(
        service.create('c1', 'u2', { title: 'T', content: 'C' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.announcement.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for a user who is not a member', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });

      await expect(
        service.create('c1', 'u9', { title: 'T', content: 'C' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.announcement.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the classroom does not exist', async () => {
      prisma.classroom.findUnique.mockResolvedValue(null);

      await expect(
        service.create('c1', 'w1', { title: 'T', content: 'C' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.announcement.create).not.toHaveBeenCalled();
    });
  });

  describe('AnnouncementsService.findAll', () => {
    it('scopes to the class, hides deleted rows, and marks isRead per caller', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.announcement.findMany.mockResolvedValue([
        { ...announcementRow(), reads: [{ readAt: new Date() }] },
      ]);
      prisma.announcement.count.mockResolvedValue(1);

      const result = await service.findAll(
        'c1',
        'w1',
        new QueryAnnouncementDto(),
      );

      expect(prisma.announcement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { classId: 'c1', deletedAt: null },
          orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
          skip: 0,
          take: 20,
        }),
      );
      expect(result.data[0]).toMatchObject({ id: 'a1', isRead: true });
      expect(result.data[0]).not.toHaveProperty('reads');
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('applies the isPinned filter and reports unread items', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ id: 'm1' }],
      });
      prisma.announcement.findMany.mockResolvedValue([
        { ...announcementRow(), reads: [] },
      ]);
      prisma.announcement.count.mockResolvedValue(1);

      const query = new QueryAnnouncementDto();
      query.isPinned = true;

      const result = await service.findAll('c1', 'm1', query);

      expect(prisma.announcement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { classId: 'c1', deletedAt: null, isPinned: true },
        }),
      );
      expect(result.data[0]).toMatchObject({ isRead: false });
    });

    it('throws ForbiddenException for a non-member and reads nothing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });

      await expect(
        service.findAll('c1', 'u9', new QueryAnnouncementDto()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.announcement.findMany).not.toHaveBeenCalled();
    });
  });

  describe('AnnouncementsService.findOne', () => {
    it('returns the detail with myReadAt null when unread', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ id: 'm1' }],
      });
      prisma.announcement.findFirst.mockResolvedValue({
        ...announcementRow(),
        reads: [],
      });

      const result = await service.findOne('c1', 'a1', 'm1');

      expect(prisma.announcement.findFirst).toHaveBeenCalledWith({
        where: { id: 'a1', classId: 'c1', deletedAt: null },
        select: {
          ...announcementSelect,
          reads: { where: { userId: 'm1' }, select: { readAt: true }, take: 1 },
        },
      });
      expect(result).toMatchObject({ id: 'a1', myReadAt: null });
    });

    it('returns myReadAt when the caller has read it', async () => {
      const readAt = new Date('2026-02-01T10:00:00.000Z');
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ id: 'm1' }],
      });
      prisma.announcement.findFirst.mockResolvedValue({
        ...announcementRow(),
        reads: [{ readAt }],
      });

      const result = await service.findOne('c1', 'a1', 'm1');

      expect(result).toMatchObject({ myReadAt: readAt });
    });

    it('throws NotFoundException when the announcement is missing or deleted', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.announcement.findFirst.mockResolvedValue(null);

      await expect(service.findOne('c1', 'a1', 'w1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('AnnouncementsService.update', () => {
    it('lets the author update only the provided fields', async () => {
      prisma.announcement.findFirst.mockResolvedValue({
        id: 'a1',
        authorId: 'm1',
        classroom: { homeroomTeacherId: 'w1' },
      });
      prisma.announcement.update.mockResolvedValue({
        ...announcementRow({ title: 'New title' }),
        reads: [],
      });

      const result = await service.update('c1', 'a1', 'm1', {
        title: 'New title',
      });

      expect(prisma.announcement.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { title: 'New title' },
        select: {
          ...announcementSelect,
          reads: { where: { userId: 'm1' }, select: { readAt: true }, take: 1 },
        },
      });
      expect(result).toMatchObject({ title: 'New title', myReadAt: null });
    });

    it('lets the homeroom teacher update another author announcement', async () => {
      prisma.announcement.findFirst.mockResolvedValue({
        id: 'a1',
        authorId: 'm1',
        classroom: { homeroomTeacherId: 'w1' },
      });
      prisma.announcement.update.mockResolvedValue({
        ...announcementRow(),
        reads: [],
      });

      await service.update('c1', 'a1', 'w1', { isPinned: true });

      expect(prisma.announcement.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { isPinned: true },
        select: {
          ...announcementSelect,
          reads: { where: { userId: 'w1' }, select: { readAt: true }, take: 1 },
        },
      });
    });

    it('throws ForbiddenException for a non-author non-homeroom caller and writes nothing', async () => {
      prisma.announcement.findFirst.mockResolvedValue({
        id: 'a1',
        authorId: 'm1',
        classroom: { homeroomTeacherId: 'w1' },
      });

      await expect(
        service.update('c1', 'a1', 'u9', { title: 'New title' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.announcement.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the announcement is missing', async () => {
      prisma.announcement.findFirst.mockResolvedValue(null);

      await expect(
        service.update('c1', 'a1', 'w1', { title: 'New title' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.announcement.update).not.toHaveBeenCalled();
    });
  });

  describe('AnnouncementsService.remove', () => {
    it('soft deletes for the author and keeps the row', async () => {
      prisma.announcement.findFirst.mockResolvedValue({
        id: 'a1',
        authorId: 'm1',
        classroom: { homeroomTeacherId: 'w1' },
      });
      prisma.announcement.update.mockResolvedValue({ id: 'a1' });

      await service.remove('c1', 'a1', 'm1');

      expect(prisma.announcement.update).toHaveBeenCalledTimes(1);
      const updateCalls = prisma.announcement.update.mock
        .calls as unknown as UpdateCallArgs[][];
      const updateArgs = updateCalls[0][0];
      expect(updateArgs.where).toEqual({ id: 'a1' });
      expect(updateArgs.data.deletedAt).toBeInstanceOf(Date);
      expect(updateArgs.select).toEqual({ id: true });
    });

    it('lets the homeroom teacher delete another author announcement', async () => {
      prisma.announcement.findFirst.mockResolvedValue({
        id: 'a1',
        authorId: 'm1',
        classroom: { homeroomTeacherId: 'w1' },
      });
      prisma.announcement.update.mockResolvedValue({ id: 'a1' });

      await service.remove('c1', 'a1', 'w1');

      expect(prisma.announcement.update).toHaveBeenCalledTimes(1);
    });

    it('throws ForbiddenException for a non-author non-homeroom caller and writes nothing', async () => {
      prisma.announcement.findFirst.mockResolvedValue({
        id: 'a1',
        authorId: 'm1',
        classroom: { homeroomTeacherId: 'w1' },
      });

      await expect(service.remove('c1', 'a1', 'u9')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.announcement.update).not.toHaveBeenCalled();
    });
  });

  describe('AnnouncementsService.markRead', () => {
    it('upserts without overwriting readAt so a repeat call is idempotent', async () => {
      const readAt = new Date('2026-03-01T08:00:00.000Z');
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ id: 'm1' }],
      });
      prisma.announcement.findFirst.mockResolvedValue({ id: 'a1' });
      prisma.announcementRead.upsert.mockResolvedValue({ readAt });

      const first = await service.markRead('c1', 'a1', 'm1');
      const second = await service.markRead('c1', 'a1', 'm1');

      expect(prisma.announcementRead.upsert).toHaveBeenCalledWith({
        where: {
          announcementId_userId: { announcementId: 'a1', userId: 'm1' },
        },
        create: { announcementId: 'a1', userId: 'm1' },
        update: {},
        select: { readAt: true },
      });
      expect(prisma.announcementRead.upsert).toHaveBeenCalledTimes(2);
      expect(first).toEqual({ readAt });
      expect(second).toEqual({ readAt });
    });

    it('throws NotFoundException when the announcement is missing and writes nothing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ id: 'm1' }],
      });
      prisma.announcement.findFirst.mockResolvedValue(null);

      await expect(service.markRead('c1', 'a1', 'm1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.announcementRead.upsert).not.toHaveBeenCalled();
    });
  });

  describe('AnnouncementsService.getReadReceipts', () => {
    it('partitions current active members into read and unread', async () => {
      const readAt = new Date('2026-03-02T09:00:00.000Z');
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.announcement.findFirst.mockResolvedValue({ id: 'a1' });
      prisma.classMember.findMany.mockResolvedValue([
        { userId: 'm1', user: { id: 'm1', name: 'Budi', avatarUrl: null } },
        { userId: 'm2', user: { id: 'm2', name: 'Siti', avatarUrl: null } },
      ]);
      prisma.announcementRead.findMany.mockResolvedValue([
        { userId: 'm1', readAt },
        // A receipt from someone no longer on the roster is ignored.
        { userId: 'gone', readAt: new Date('2026-03-01T00:00:00.000Z') },
      ]);

      const result = await service.getReadReceipts('c1', 'a1', 'w1');

      expect(result.readCount).toBe(1);
      expect(result.unreadCount).toBe(1);
      expect(result.read).toEqual([
        { userId: 'm1', name: 'Budi', avatarUrl: null, readAt },
      ]);
      expect(result.unread).toEqual([
        { userId: 'm2', name: 'Siti', avatarUrl: null },
      ]);
    });

    it('throws ForbiddenException for a MEMBER and reads no receipts', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ role: ClassRole.MEMBER }],
      });

      await expect(
        service.getReadReceipts('c1', 'a1', 'u2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.announcement.findFirst).not.toHaveBeenCalled();
      expect(prisma.announcementRead.findMany).not.toHaveBeenCalled();
    });

    it('allows an active KETUA to see receipts', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ role: ClassRole.KETUA }],
      });
      prisma.announcement.findFirst.mockResolvedValue({ id: 'a1' });
      prisma.classMember.findMany.mockResolvedValue([]);
      prisma.announcementRead.findMany.mockResolvedValue([]);

      await expect(service.getReadReceipts('c1', 'a1', 'm1')).resolves.toEqual({
        readCount: 0,
        unreadCount: 0,
        read: [],
        unread: [],
      });
    });
  });
});
