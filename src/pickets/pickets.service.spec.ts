import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClassRole } from '../../generated/prisma/client';
import { PushSenderService } from '../common/notifications/push-sender.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  PicketsService,
  picketGroupSelect,
  tomorrowDayOfWeekInJakarta,
} from './pickets.service';

interface GroupSeat {
  memberId: string;
  member: {
    userId: string;
    user: { name: string; avatarUrl: string | null };
  };
}

interface GroupRow {
  id: string;
  classId: string;
  dayOfWeek: number;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
  seats: GroupSeat[];
}

function groupRow(overrides: Partial<GroupRow> = {}): GroupRow {
  return {
    id: 'pg1',
    classId: 'c1',
    dayOfWeek: 1,
    name: 'Monday crew',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    seats: [
      {
        memberId: 'm1',
        member: {
          userId: 'u1',
          user: { name: 'Ana', avatarUrl: null },
        },
      },
    ],
    ...overrides,
  };
}

describe('PicketsService', () => {
  let service: PicketsService;
  let tx: {
    picketGroup: { upsert: jest.Mock; findUniqueOrThrow: jest.Mock };
    picketMember: { deleteMany: jest.Mock; createMany: jest.Mock };
  };
  let prisma: {
    classroom: { findUnique: jest.Mock };
    classMember: { findFirst: jest.Mock; findMany: jest.Mock };
    picketGroup: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      delete: jest.Mock;
    };
    picketMember: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let push: { send: jest.Mock };

  beforeEach(async () => {
    tx = {
      picketGroup: { upsert: jest.fn(), findUniqueOrThrow: jest.fn() },
      picketMember: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
    prisma = {
      classroom: { findUnique: jest.fn() },
      classMember: { findFirst: jest.fn(), findMany: jest.fn() },
      picketGroup: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        delete: jest.fn(),
      },
      picketMember: { findMany: jest.fn() },
      $transaction: jest.fn((cb: (client: typeof tx) => Promise<unknown>) =>
        cb(tx),
      ),
    };
    push = { send: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PushSenderService, useValue: push },
      ],
    }).compile();

    service = moduleRef.get(PicketsService);
  });

  describe('tomorrowDayOfWeekInJakarta', () => {
    it('returns the next weekday for a Monday early in Jakarta', () => {
      // 2026-11-09T00:00Z is Monday 07:00 in Jakarta.
      expect(
        tomorrowDayOfWeekInJakarta(new Date('2026-11-09T00:00:00.000Z')),
      ).toBe(2);
    });

    it('wraps Sunday to Monday', () => {
      expect(
        tomorrowDayOfWeekInJakarta(new Date('2026-11-08T00:00:00.000Z')),
      ).toBe(1);
    });
  });

  describe('PicketsService.findWeek', () => {
    it('returns the week groups with flattened members', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.picketGroup.findMany.mockResolvedValue([groupRow()]);

      const result = await service.findWeek('c1', 'w1');

      expect(prisma.picketGroup.findMany).toHaveBeenCalledWith({
        where: { classId: 'c1' },
        select: picketGroupSelect,
        orderBy: { dayOfWeek: 'asc' },
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'pg1',
        dayOfWeek: 1,
        members: [{ memberId: 'm1', userId: 'u1', name: 'Ana' }],
      });
    });

    it('throws ForbiddenException for a non-member and reads nothing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });

      await expect(service.findWeek('c1', 'u9')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.picketGroup.findMany).not.toHaveBeenCalled();
    });
  });

  describe('PicketsService.myDays', () => {
    it('returns the sorted duty weekdays of the active member', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ id: 'm1' }],
      });
      prisma.classMember.findFirst.mockResolvedValue({ id: 'm1' });
      prisma.picketMember.findMany.mockResolvedValue([
        { group: { dayOfWeek: 3 } },
        { group: { dayOfWeek: 1 } },
        { group: { dayOfWeek: 3 } },
      ]);

      const result = await service.myDays('c1', 'u1');

      expect(prisma.picketMember.findMany).toHaveBeenCalledWith({
        where: { memberId: 'm1', group: { classId: 'c1' } },
        select: { group: { select: { dayOfWeek: true } } },
      });
      expect(result).toEqual({ days: [1, 3] });
    });

    it('returns no days when the caller has no membership row', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.classMember.findFirst.mockResolvedValue(null);

      await expect(service.myDays('c1', 'w1')).resolves.toEqual({ days: [] });
      expect(prisma.picketMember.findMany).not.toHaveBeenCalled();
    });
  });

  describe('PicketsService.replaceDay', () => {
    it('replaces the group and its seats in one transaction', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.classMember.findMany.mockResolvedValue([{ id: 'm1' }]);
      tx.picketGroup.upsert.mockResolvedValue({ id: 'pg1' });
      tx.picketMember.deleteMany.mockResolvedValue({ count: 1 });
      tx.picketMember.createMany.mockResolvedValue({ count: 1 });
      tx.picketGroup.findUniqueOrThrow.mockResolvedValue(
        groupRow({ dayOfWeek: 2, name: null }),
      );

      const result = await service.replaceDay('c1', 'w1', 2, {
        memberIds: ['m1'],
      });

      expect(tx.picketGroup.upsert).toHaveBeenCalledWith({
        where: { classId_dayOfWeek: { classId: 'c1', dayOfWeek: 2 } },
        create: { classId: 'c1', dayOfWeek: 2, name: null },
        update: { name: null },
        select: { id: true },
      });
      expect(tx.picketMember.deleteMany).toHaveBeenCalledWith({
        where: { groupId: 'pg1' },
      });
      expect(tx.picketMember.createMany).toHaveBeenCalledWith({
        data: [{ groupId: 'pg1', memberId: 'm1' }],
      });
      expect(result).toMatchObject({ dayOfWeek: 2 });
    });

    it('keeps the group but clears its seats for an empty member list', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      tx.picketGroup.upsert.mockResolvedValue({ id: 'pg1' });
      tx.picketMember.deleteMany.mockResolvedValue({ count: 3 });
      tx.picketGroup.findUniqueOrThrow.mockResolvedValue(
        groupRow({ seats: [] }),
      );

      await service.replaceDay('c1', 'w1', 1, { memberIds: [] });

      expect(prisma.classMember.findMany).not.toHaveBeenCalled();
      expect(tx.picketMember.deleteMany).toHaveBeenCalledWith({
        where: { groupId: 'pg1' },
      });
      expect(tx.picketMember.createMany).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for a day outside 1..7 and starts no transaction', async () => {
      await expect(
        service.replaceDay('c1', 'w1', 8, { memberIds: [] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when a seat is not an active member and starts no transaction', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.classMember.findMany.mockResolvedValue([]);

      await expect(
        service.replaceDay('c1', 'w1', 1, { memberIds: ['m9'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for an active MEMBER and starts no transaction', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ role: ClassRole.MEMBER }],
      });

      await expect(
        service.replaceDay('c1', 'u2', 1, { memberIds: [] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('PicketsService.removeDay', () => {
    it('deletes the day group for the homeroom teacher', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.picketGroup.findFirst.mockResolvedValue({ id: 'pg1' });
      prisma.picketGroup.delete.mockResolvedValue({ id: 'pg1' });

      await service.removeDay('c1', 'w1', 2);

      expect(prisma.picketGroup.delete).toHaveBeenCalledWith({
        where: { id: 'pg1' },
      });
    });

    it('throws NotFoundException when the group is gone and deletes nothing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.picketGroup.findFirst.mockResolvedValue(null);

      await expect(service.removeDay('c1', 'w1', 2)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.picketGroup.delete).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for an active MEMBER and deletes nothing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ role: ClassRole.MEMBER }],
      });

      await expect(service.removeDay('c1', 'u2', 2)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.picketGroup.delete).not.toHaveBeenCalled();
    });
  });

  describe('PicketsService.sendTomorrowReminders', () => {
    it('pushes a picket reminder to the unique active members of tomorrow groups', async () => {
      prisma.picketGroup.findMany.mockResolvedValue([
        {
          id: 'pg1',
          classId: 'c1',
          classroom: { name: 'XI RPL 1' },
          seats: [
            { member: { userId: 'u1' } },
            { member: { userId: 'u1' } },
            { member: { userId: 'u2' } },
          ],
        },
      ]);

      // 2026-11-09T00:00Z is Monday in Jakarta, so tomorrow is day 2.
      await service.sendTomorrowReminders(new Date('2026-11-09T00:00:00.000Z'));

      expect(prisma.picketGroup.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ dayOfWeek: 2 }) as object,
        }),
      );
      expect(push.send).toHaveBeenCalledTimes(1);
      expect(push.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PICKET_REMINDER',
          refId: 'pg1',
          classId: 'c1',
          userIds: ['u1', 'u2'],
        }),
      );
    });

    it('sends nothing when no group is on duty tomorrow', async () => {
      prisma.picketGroup.findMany.mockResolvedValue([]);

      await service.sendTomorrowReminders(new Date('2026-11-09T00:00:00.000Z'));

      expect(push.send).not.toHaveBeenCalled();
    });
  });
});
