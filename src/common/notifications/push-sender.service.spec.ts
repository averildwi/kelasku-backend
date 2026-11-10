import { Test } from '@nestjs/testing';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FirebaseService } from './firebase.service';
import { PushSenderService } from './push-sender.service';
import type { PushMessage } from './push-sender.service';

interface LogCreateArgs {
  data: { type: string; refId: string; userId: string; sentDate: Date };
}

interface TxMock {
  notificationLog: { create: jest.Mock };
  notification: { create: jest.Mock };
}

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function baseMessage(overrides: Partial<PushMessage> = {}): PushMessage {
  return {
    type: 'ANNOUNCEMENT_NEW',
    refId: 'announcement-1',
    classId: 'class-1',
    title: 'New announcement',
    body: 'The meeting moved to Friday',
    userIds: ['user-1', 'user-2'],
    ...overrides,
  };
}

describe('PushSenderService', () => {
  let service: PushSenderService;
  let prisma: {
    $transaction: jest.Mock;
    deviceToken: { findMany: jest.Mock; deleteMany: jest.Mock };
  };
  let firebase: { sendToTokens: jest.Mock };
  let tx: TxMock;
  let claimed: Set<string>;

  beforeEach(async () => {
    claimed = new Set<string>();
    tx = {
      notificationLog: {
        create: jest.fn((args: LogCreateArgs) => {
          const { type, refId, userId, sentDate } = args.data;
          const key = `${type}|${refId}|${userId}|${sentDate.toISOString()}`;
          if (claimed.has(key)) return Promise.reject(uniqueViolation());
          claimed.add(key);
          return Promise.resolve({ id: `log-${userId}` });
        }),
      },
      notification: {
        create: jest.fn().mockResolvedValue({ id: 'notification-1' }),
      },
    };
    prisma = {
      $transaction: jest.fn((cb: (client: TxMock) => Promise<unknown>) =>
        cb(tx),
      ),
      deviceToken: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    firebase = { sendToTokens: jest.fn().mockResolvedValue([]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PushSenderService,
        { provide: PrismaService, useValue: prisma },
        { provide: FirebaseService, useValue: firebase },
      ],
    }).compile();

    service = moduleRef.get(PushSenderService);
  });

  describe('PushSenderService.send', () => {
    it('writes one log row and one inbox row per recipient', async () => {
      await service.send(baseMessage());

      expect(tx.notificationLog.create).toHaveBeenCalledTimes(2);
      expect(tx.notification.create).toHaveBeenCalledTimes(2);
      expect(tx.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          classId: 'class-1',
          type: 'ANNOUNCEMENT_NEW',
          title: 'New announcement',
          body: 'The meeting moved to Friday',
        },
        select: { id: true },
      });
      expect(tx.notificationLog.create).toHaveBeenCalledWith({
        data: {
          type: 'ANNOUNCEMENT_NEW',
          refId: 'announcement-1',
          userId: 'user-1',
          sentDate: expect.any(Date) as Date,
        },
        select: { id: true },
      });
    });

    it('keeps exactly one inbox and one log row when the same push runs in parallel (BR-16)', async () => {
      const message = baseMessage({ userIds: ['user-1'] });

      await Promise.all([service.send(message), service.send(message)]);

      expect(tx.notification.create).toHaveBeenCalledTimes(1);
      expect(claimed.size).toBe(1);
      // The loser lost the claim and never reached the device push.
      expect(prisma.deviceToken.findMany).toHaveBeenCalledTimes(1);
    });

    it('prunes device tokens FCM reports as unregistered', async () => {
      prisma.deviceToken.findMany.mockResolvedValue([
        { token: 'token-1' },
        { token: 'token-2' },
      ]);
      firebase.sendToTokens.mockResolvedValue(['token-1']);

      await service.send(baseMessage({ userIds: ['user-1'] }));

      expect(firebase.sendToTokens).toHaveBeenCalledWith(
        ['token-1', 'token-2'],
        expect.objectContaining({ title: 'New announcement' }),
      );
      expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({
        where: { token: { in: ['token-1'] } },
      });
    });

    it('never rejects when FCM delivery fails and still keeps the inbox row', async () => {
      prisma.deviceToken.findMany.mockResolvedValue([{ token: 'token-1' }]);
      firebase.sendToTokens.mockRejectedValue(new Error('FCM is down'));

      await expect(
        service.send(baseMessage({ userIds: ['user-1'] })),
      ).resolves.toBeUndefined();

      expect(tx.notification.create).toHaveBeenCalledTimes(1);
    });
  });
});
