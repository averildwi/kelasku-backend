import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClassRole } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryLessonScheduleDto } from './dto/query-lesson-schedule.dto';
import {
  dayOfWeekInJakarta,
  lessonScheduleSelect,
  LessonSchedulesService,
} from './lesson-schedules.service';

interface ScheduleRow {
  id: string;
  classId: string;
  subjectId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room: string | null;
  createdAt: Date;
  updatedAt: Date;
  subject: { id: string; name: string; color: string | null };
}

function scheduleRow(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    id: 'ls1',
    classId: 'c1',
    subjectId: 's1',
    dayOfWeek: 1,
    startTime: '07:30',
    endTime: '09:00',
    room: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    subject: { id: 's1', name: 'Matematika', color: null },
    ...overrides,
  };
}

describe('LessonSchedulesService', () => {
  let service: LessonSchedulesService;
  let tx: {
    lessonSchedule: {
      deleteMany: jest.Mock;
      createMany: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let prisma: {
    classroom: { findUnique: jest.Mock };
    subject: { findFirst: jest.Mock; findMany: jest.Mock };
    lessonSchedule: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    tx = {
      lessonSchedule: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn(),
      },
    };
    prisma = {
      classroom: { findUnique: jest.fn() },
      subject: { findFirst: jest.fn(), findMany: jest.fn() },
      lessonSchedule: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn((cb: (client: typeof tx) => Promise<unknown>) =>
        cb(tx),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LessonSchedulesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(LessonSchedulesService);
  });

  describe('dayOfWeekInJakarta', () => {
    it('returns 1 for Monday 07:00 Jakarta', () => {
      expect(dayOfWeekInJakarta(new Date('2026-11-09T00:00:00.000Z'))).toBe(1);
    });

    it('rolls over to the next day when UTC is still the previous evening', () => {
      // 20:00 UTC is 03:00 the next day in Jakarta (UTC+7).
      expect(dayOfWeekInJakarta(new Date('2026-11-09T20:00:00.000Z'))).toBe(2);
    });
  });

  describe('LessonSchedulesService.create', () => {
    it('creates a slot for the homeroom teacher when there is no overlap', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.subject.findFirst.mockResolvedValue({ id: 's1' });
      prisma.lessonSchedule.findMany.mockResolvedValue([]);
      prisma.lessonSchedule.create.mockResolvedValue(scheduleRow());

      const result = await service.create('c1', 'w1', {
        subjectId: 's1',
        dayOfWeek: 1,
        startTime: '07:30',
        endTime: '09:00',
      });

      expect(prisma.lessonSchedule.create).toHaveBeenCalledWith({
        data: {
          classId: 'c1',
          subjectId: 's1',
          dayOfWeek: 1,
          startTime: '07:30',
          endTime: '09:00',
          room: null,
        },
        select: lessonScheduleSelect,
      });
      expect(result).toMatchObject({ id: 'ls1' });
    });

    it('throws BadRequestException when startTime is not before endTime', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });

      await expect(
        service.create('c1', 'w1', {
          subjectId: 's1',
          dayOfWeek: 1,
          startTime: '09:00',
          endTime: '09:00',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.lessonSchedule.create).not.toHaveBeenCalled();
      expect(prisma.subject.findFirst).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the slot overlaps another slot that day', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.subject.findFirst.mockResolvedValue({ id: 's1' });
      prisma.lessonSchedule.findMany.mockResolvedValue([
        { startTime: '08:00', endTime: '10:00' },
      ]);

      await expect(
        service.create('c1', 'w1', {
          subjectId: 's1',
          dayOfWeek: 1,
          startTime: '09:00',
          endTime: '11:00',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.lessonSchedule.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the subject is missing or soft-deleted', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.subject.findFirst.mockResolvedValue(null);

      await expect(
        service.create('c1', 'w1', {
          subjectId: 's1',
          dayOfWeek: 1,
          startTime: '07:30',
          endTime: '09:00',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.lessonSchedule.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for an active MEMBER and writes nothing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ role: ClassRole.MEMBER }],
      });

      await expect(
        service.create('c1', 'u2', {
          subjectId: 's1',
          dayOfWeek: 1,
          startTime: '07:30',
          endTime: '09:00',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.lessonSchedule.create).not.toHaveBeenCalled();
    });
  });

  describe('LessonSchedulesService.findAll', () => {
    it('groups the weekly schedule by day in order', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.lessonSchedule.findMany.mockResolvedValue([
        scheduleRow({ id: 'a', dayOfWeek: 1, startTime: '07:30' }),
        scheduleRow({ id: 'b', dayOfWeek: 1, startTime: '09:00' }),
        scheduleRow({ id: 'c', dayOfWeek: 2, startTime: '07:30' }),
      ]);

      const result = await service.findAll(
        'c1',
        'w1',
        new QueryLessonScheduleDto(),
      );

      expect(prisma.lessonSchedule.findMany).toHaveBeenCalledWith({
        where: { classId: 'c1' },
        select: lessonScheduleSelect,
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ dayOfWeek: 1 });
      expect(result[0].slots).toHaveLength(2);
      expect(result[1]).toMatchObject({ dayOfWeek: 2 });
    });

    it('filters to one day when requested', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.lessonSchedule.findMany.mockResolvedValue([]);

      const query = new QueryLessonScheduleDto();
      query.day = 3;

      await service.findAll('c1', 'w1', query);

      expect(prisma.lessonSchedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { classId: 'c1', dayOfWeek: 3 },
        }),
      );
    });

    it('throws ForbiddenException for a non-member and reads nothing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });

      await expect(
        service.findAll('c1', 'u9', new QueryLessonScheduleDto()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.lessonSchedule.findMany).not.toHaveBeenCalled();
    });
  });

  describe('LessonSchedulesService.findToday', () => {
    it("queries today's Jakarta weekday for an active member", async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ id: 'm1' }],
      });
      prisma.lessonSchedule.findMany.mockResolvedValue([]);

      const result = await service.findToday('c1', 'm1');

      expect(prisma.lessonSchedule.findMany).toHaveBeenCalledWith({
        where: { classId: 'c1', dayOfWeek: dayOfWeekInJakarta(new Date()) },
        select: lessonScheduleSelect,
        orderBy: { startTime: 'asc' },
      });
      expect(result).toEqual([]);
    });
  });

  describe('LessonSchedulesService.replaceDay', () => {
    it('replaces the whole day inside one transaction', async () => {
      const replaced = [scheduleRow({ dayOfWeek: 2, startTime: '07:30' })];
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.subject.findMany.mockResolvedValue([{ id: 's1' }]);
      tx.lessonSchedule.deleteMany.mockResolvedValue({ count: 1 });
      tx.lessonSchedule.createMany.mockResolvedValue({ count: 1 });
      tx.lessonSchedule.findMany.mockResolvedValue(replaced);

      const result = await service.replaceDay('c1', 'w1', 2, {
        slots: [{ subjectId: 's1', startTime: '07:30', endTime: '09:00' }],
      });

      expect(prisma.subject.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['s1'] }, classId: 'c1', deletedAt: null },
        select: { id: true },
      });
      expect(tx.lessonSchedule.deleteMany).toHaveBeenCalledWith({
        where: { classId: 'c1', dayOfWeek: 2 },
      });
      expect(tx.lessonSchedule.createMany).toHaveBeenCalledWith({
        data: [
          {
            classId: 'c1',
            subjectId: 's1',
            dayOfWeek: 2,
            startTime: '07:30',
            endTime: '09:00',
            room: null,
          },
        ],
      });
      expect(result).toBe(replaced);
    });

    it('clears the day when the slot list is empty', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      tx.lessonSchedule.deleteMany.mockResolvedValue({ count: 2 });
      tx.lessonSchedule.findMany.mockResolvedValue([]);

      const result = await service.replaceDay('c1', 'w1', 4, { slots: [] });

      expect(tx.lessonSchedule.deleteMany).toHaveBeenCalledWith({
        where: { classId: 'c1', dayOfWeek: 4 },
      });
      expect(tx.lessonSchedule.createMany).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('throws BadRequestException for a day outside 1..7 and starts no transaction', async () => {
      await expect(
        service.replaceDay('c1', 'w1', 8, { slots: [] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when a slot has startTime >= endTime', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });

      await expect(
        service.replaceDay('c1', 'w1', 1, {
          slots: [{ subjectId: 's1', startTime: '10:00', endTime: '09:00' }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the incoming slots overlap', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });

      await expect(
        service.replaceDay('c1', 'w1', 1, {
          slots: [
            { subjectId: 's1', startTime: '07:00', endTime: '09:00' },
            { subjectId: 's2', startTime: '08:00', endTime: '10:00' },
          ],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when a subject is not in the class', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.subject.findMany.mockResolvedValue([]);

      await expect(
        service.replaceDay('c1', 'w1', 1, {
          slots: [{ subjectId: 's1', startTime: '07:30', endTime: '09:00' }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for an active MEMBER and starts no transaction', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ role: ClassRole.MEMBER }],
      });

      await expect(
        service.replaceDay('c1', 'u2', 1, { slots: [] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('LessonSchedulesService.remove', () => {
    it('hard deletes the slot for the homeroom teacher', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.lessonSchedule.findFirst.mockResolvedValue({ id: 'ls1' });
      prisma.lessonSchedule.delete.mockResolvedValue({ id: 'ls1' });

      await service.remove('c1', 'ls1', 'w1');

      expect(prisma.lessonSchedule.delete).toHaveBeenCalledWith({
        where: { id: 'ls1' },
      });
    });

    it('throws NotFoundException when the slot is gone and deletes nothing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.lessonSchedule.findFirst.mockResolvedValue(null);

      await expect(service.remove('c1', 'ls1', 'w1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.lessonSchedule.delete).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for an active MEMBER and deletes nothing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ role: ClassRole.MEMBER }],
      });

      await expect(service.remove('c1', 'ls1', 'u2')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.lessonSchedule.delete).not.toHaveBeenCalled();
    });
  });
});
