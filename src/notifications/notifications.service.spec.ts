import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { QueryNotificationDto } from './dto/query-notification.dto';
import {
  notificationSelect,
  NotificationsService,
} from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    notification: {
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      notification: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(NotificationsService);
  });

  describe('NotificationsService.findAll', () => {
    it('scopes to the caller and returns one page newest first', async () => {
      prisma.notification.findMany.mockResolvedValue([
        { id: 'n1', readAt: null },
      ]);
      prisma.notification.count.mockResolvedValue(1);

      const result = await service.findAll(
        'user-1',
        new QueryNotificationDto(),
      );

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: notificationSelect,
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      });
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('filters unread and by classId', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.notification.count.mockResolvedValue(0);
      const query = new QueryNotificationDto();
      query.unread = true;
      query.classId = 'class-1';

      await service.findAll('user-1', query);

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', readAt: null, classId: 'class-1' },
        }),
      );
    });
  });

  describe('NotificationsService.unreadCount', () => {
    it('counts only the caller unread notifications', async () => {
      prisma.notification.count.mockResolvedValue(3);

      await expect(service.unreadCount('user-1')).resolves.toEqual({
        count: 3,
      });
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null },
      });
    });
  });

  describe('NotificationsService.markRead', () => {
    it('keeps the first readAt so a repeat call is idempotent', async () => {
      const readAt = new Date('2026-04-01T00:00:00.000Z');
      prisma.notification.findFirst.mockResolvedValue({ id: 'n1', readAt });
      prisma.notification.update.mockResolvedValue({ readAt });

      const result = await service.markRead('user-1', 'n1');

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { readAt },
        select: { readAt: true },
      });
      expect(result).toEqual({ readAt });
    });

    it('sets readAt now when the notification was unread', async () => {
      prisma.notification.findFirst.mockResolvedValue({
        id: 'n1',
        readAt: null,
      });
      prisma.notification.update.mockResolvedValue({ readAt: new Date() });

      await service.markRead('user-1', 'n1');

      const calls = prisma.notification.update.mock.calls as unknown as [
        { data: { readAt: Date } },
      ][];
      expect(calls[0][0].data.readAt).toBeInstanceOf(Date);
    });

    it('throws NotFoundException when the notification is not the caller and writes nothing', async () => {
      prisma.notification.findFirst.mockResolvedValue(null);

      await expect(service.markRead('user-1', 'n9')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });
  });

  describe('NotificationsService.markAllRead', () => {
    it('marks only the caller unread notifications as read', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 2 });

      await service.markAllRead('user-1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null },
        data: { readAt: expect.any(Date) as Date },
      });
    });
  });
});
