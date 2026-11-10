import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClassRole, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLessonScheduleDto } from './dto/create-lesson-schedule.dto';
import { QueryLessonScheduleDto } from './dto/query-lesson-schedule.dto';
import { ReplaceDayLessonScheduleDto } from './dto/replace-day-lesson-schedule.dto';

const SCHEDULE_NOT_FOUND = 'Schedule slot not found';
const CLASS_NOT_FOUND = 'Classroom not found';
const SUBJECT_NOT_FOUND = 'Subject not found';
const MANAGE_FORBIDDEN =
  'Only the homeroom teacher or the class president can manage the schedule';
const INVALID_RANGE = 'startTime must be before endTime';
const INVALID_DAY = 'dayOfWeek must be between 1 and 7';
const OVERLAP = 'Schedule slot overlaps an existing slot';

/** Jakarta is the school timezone for weekdays and clock times (BR-11b). */
const JAKARTA_TIME_ZONE = 'Asia/Jakarta';
const WEEKDAY_TO_NUMBER: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** Slot shape; includes the subject label/color the timetable renders. */
export const lessonScheduleSelect = {
  id: true,
  classId: true,
  subjectId: true,
  dayOfWeek: true,
  startTime: true,
  endTime: true,
  room: true,
  createdAt: true,
  updatedAt: true,
  subject: { select: { id: true, name: true, color: true } },
} satisfies Prisma.LessonScheduleSelect;

type ScheduleRow = Prisma.LessonScheduleGetPayload<{
  select: typeof lessonScheduleSelect;
}>;

interface TimeRange {
  startTime: string;
  endTime: string;
}

/** Today's weekday (1..7) in Asia/Jakarta, regardless of the server timezone. */
export function dayOfWeekInJakarta(now: Date): number {
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: JAKARTA_TIME_ZONE,
    weekday: 'short',
  }).format(now);
  return WEEKDAY_TO_NUMBER[label] ?? 1;
}

function assertValidRange(range: TimeRange): void {
  // Both are zero-padded "HH:mm", so lexicographic order equals clock order.
  if (range.startTime >= range.endTime) {
    throw new BadRequestException(INVALID_RANGE);
  }
}

function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.startTime < b.endTime && b.startTime < a.endTime;
}

function assertNoOverlap(slots: TimeRange[]): void {
  const sorted = [...slots].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );
  for (let i = 1; i < sorted.length; i += 1) {
    if (overlaps(sorted[i - 1], sorted[i]))
      throw new ConflictException(OVERLAP);
  }
}

@Injectable()
export class LessonSchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(classId: string, userId: string, dto: CreateLessonScheduleDto) {
    await this.assertCanManage(classId, userId);
    assertValidRange(dto);
    await this.assertSubjectInClass(classId, dto.subjectId);

    const existing = await this.prisma.lessonSchedule.findMany({
      where: { classId, dayOfWeek: dto.dayOfWeek },
      select: { startTime: true, endTime: true },
    });
    if (existing.some((slot) => overlaps(dto, slot))) {
      throw new ConflictException(OVERLAP);
    }

    return this.prisma.lessonSchedule.create({
      data: {
        classId,
        subjectId: dto.subjectId,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        room: dto.room ?? null,
      },
      select: lessonScheduleSelect,
    });
  }

  /** F-SCHED-1: the weekly timetable grouped by day; optionally one day. */
  async findAll(
    classId: string,
    userId: string,
    query: QueryLessonScheduleDto,
  ) {
    await this.assertClassAccess(classId, userId);

    const where: Prisma.LessonScheduleWhereInput = {
      classId,
      ...(query.day !== undefined ? { dayOfWeek: query.day } : {}),
    };
    const rows = await this.prisma.lessonSchedule.findMany({
      where,
      select: lessonScheduleSelect,
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return this.groupByDay(rows);
  }

  /** F-SCHED-1: today's slots, evaluated in Asia/Jakarta. */
  async findToday(classId: string, userId: string) {
    await this.assertClassAccess(classId, userId);
    return this.prisma.lessonSchedule.findMany({
      where: { classId, dayOfWeek: dayOfWeekInJakarta(new Date()) },
      select: lessonScheduleSelect,
      orderBy: { startTime: 'asc' },
    });
  }

  /**
   * F-SCHED-1/BR-11: replaces a whole day's slots in one transaction. Overlap is
   * checked against the incoming set only, because the day's old slots are gone.
   */
  async replaceDay(
    classId: string,
    userId: string,
    day: number,
    dto: ReplaceDayLessonScheduleDto,
  ) {
    this.assertValidDay(day);
    await this.assertCanManage(classId, userId);

    const slots = dto.slots;
    for (const slot of slots) assertValidRange(slot);
    assertNoOverlap(slots);
    await this.assertSubjectsInClass(
      classId,
      slots.map((slot) => slot.subjectId),
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.lessonSchedule.deleteMany({
        where: { classId, dayOfWeek: day },
      });
      if (slots.length > 0) {
        await tx.lessonSchedule.createMany({
          data: slots.map((slot) => ({
            classId,
            subjectId: slot.subjectId,
            dayOfWeek: day,
            startTime: slot.startTime,
            endTime: slot.endTime,
            room: slot.room ?? null,
          })),
        });
      }
      return tx.lessonSchedule.findMany({
        where: { classId, dayOfWeek: day },
        select: lessonScheduleSelect,
        orderBy: { startTime: 'asc' },
      });
    });
  }

  /** F-SCHED-1: slots are hard-deleted; they carry no history of their own. */
  async remove(
    classId: string,
    scheduleId: string,
    userId: string,
  ): Promise<void> {
    await this.assertCanManage(classId, userId);
    const slot = await this.prisma.lessonSchedule.findFirst({
      where: { id: scheduleId, classId },
      select: { id: true },
    });
    if (!slot) throw new NotFoundException(SCHEDULE_NOT_FOUND);
    await this.prisma.lessonSchedule.delete({ where: { id: slot.id } });
  }

  private groupByDay(rows: ScheduleRow[]) {
    const groups = new Map<number, ScheduleRow[]>();
    for (const row of rows) {
      const slots = groups.get(row.dayOfWeek) ?? [];
      slots.push(row);
      groups.set(row.dayOfWeek, slots);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a - b)
      .map(([dayOfWeek, slots]) => ({ dayOfWeek, slots }));
  }

  private assertValidDay(day: number): void {
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      throw new BadRequestException(INVALID_DAY);
    }
  }

  private async assertSubjectInClass(
    classId: string,
    subjectId: string,
  ): Promise<void> {
    const subject = await this.prisma.subject.findFirst({
      where: { id: subjectId, classId, deletedAt: null },
      select: { id: true },
    });
    if (!subject) throw new NotFoundException(SUBJECT_NOT_FOUND);
  }

  private async assertSubjectsInClass(
    classId: string,
    subjectIds: string[],
  ): Promise<void> {
    const uniqueIds = [...new Set(subjectIds)];
    if (uniqueIds.length === 0) return;
    const found = await this.prisma.subject.findMany({
      where: { id: { in: uniqueIds }, classId, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== uniqueIds.length) {
      throw new NotFoundException(SUBJECT_NOT_FOUND);
    }
  }

  /** The homeroom teacher or an active KETUA may manage the schedule. */
  private async assertCanManage(
    classId: string,
    userId: string,
  ): Promise<void> {
    const classroom = await this.prisma.classroom.findUnique({
      where: { id: classId },
      select: {
        homeroomTeacherId: true,
        members: {
          where: { userId, isActive: true },
          select: { role: true },
          take: 1,
        },
      },
    });
    if (!classroom) throw new NotFoundException(CLASS_NOT_FOUND);
    if (classroom.homeroomTeacherId === userId) return;
    if (classroom.members[0]?.role === ClassRole.KETUA) return;
    throw new ForbiddenException(MANAGE_FORBIDDEN);
  }

  /** Read endpoints: the homeroom teacher or an ACTIVE member only. */
  private async assertClassAccess(
    classId: string,
    userId: string,
  ): Promise<void> {
    const classroom = await this.prisma.classroom.findUnique({
      where: { id: classId },
      select: {
        homeroomTeacherId: true,
        members: {
          where: { userId, isActive: true },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!classroom) throw new NotFoundException(CLASS_NOT_FOUND);
    if (
      classroom.homeroomTeacherId !== userId &&
      classroom.members.length === 0
    ) {
      throw new ForbiddenException('You are not allowed to view this class');
    }
  }
}
