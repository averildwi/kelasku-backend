import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ClassRole,
  NotificationType,
  Prisma,
} from '../../generated/prisma/client';
import { PushSenderService } from '../common/notifications/push-sender.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReplacePicketDayDto } from './dto/replace-picket-day.dto';

const CLASS_NOT_FOUND = 'Classroom not found';
const GROUP_NOT_FOUND = 'Picket group not found';
const MANAGE_FORBIDDEN =
  'Only the homeroom teacher or the class president can manage the picket schedule';
const INVALID_DAY = 'dayOfWeek must be between 1 and 7';
const INVALID_MEMBERS = 'Every member must be an active member of this class';

/** Jakarta is the school timezone; both the cron and the weekday math use it. */
export const JAKARTA_TIME_ZONE = 'Asia/Jakarta';
const WEEKDAY_TO_NUMBER: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** Weekday (1..7) of `date` in Asia/Jakarta, regardless of the server timezone. */
export function dayOfWeekInJakarta(date: Date): number {
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: JAKARTA_TIME_ZONE,
    weekday: 'short',
  }).format(date);
  return WEEKDAY_TO_NUMBER[label] ?? 1;
}

/** F-PICKET-2: the cron looks one day ahead. Jakarta has no DST, so +24h is safe. */
export function tomorrowDayOfWeekInJakarta(now: Date): number {
  return dayOfWeekInJakarta(new Date(now.getTime() + 24 * 60 * 60 * 1000));
}

/** Group shape shared by every endpoint; seats flattened, no internal columns. */
export const picketGroupSelect = {
  id: true,
  classId: true,
  dayOfWeek: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  seats: {
    select: {
      memberId: true,
      member: {
        select: {
          userId: true,
          user: { select: { name: true, avatarUrl: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.PicketGroupSelect;

type PicketGroupRow = Prisma.PicketGroupGetPayload<{
  select: typeof picketGroupSelect;
}>;

function toPicketGroupResponse(row: PicketGroupRow) {
  const { seats, ...rest } = row;
  return {
    ...rest,
    members: seats.map((seat) => ({
      memberId: seat.memberId,
      userId: seat.member.userId,
      name: seat.member.user.name,
      avatarUrl: seat.member.user.avatarUrl,
    })),
  };
}

@Injectable()
export class PicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushSenderService,
  ) {}

  /** F-PICKET-1: the whole week's groups (≤ 7), ordered by weekday. */
  async findWeek(classId: string, userId: string) {
    await this.assertClassAccess(classId, userId);
    const rows = await this.prisma.picketGroup.findMany({
      where: { classId },
      select: picketGroupSelect,
      orderBy: { dayOfWeek: 'asc' },
    });
    return rows.map(toPicketGroupResponse);
  }

  /** F-PICKET-1: the weekdays the current member is on duty for this class. */
  async myDays(classId: string, userId: string): Promise<{ days: number[] }> {
    await this.assertClassAccess(classId, userId);
    const member = await this.prisma.classMember.findFirst({
      where: { classId, userId, isActive: true },
      select: { id: true },
    });
    if (!member) return { days: [] };

    const seats = await this.prisma.picketMember.findMany({
      where: { memberId: member.id, group: { classId } },
      select: { group: { select: { dayOfWeek: true } } },
    });
    const days = [...new Set(seats.map((seat) => seat.group.dayOfWeek))].sort(
      (a, b) => a - b,
    );
    return { days };
  }

  /** F-PICKET-1: replaces a whole day's group and its seats in one transaction. */
  async replaceDay(
    classId: string,
    userId: string,
    day: number,
    dto: ReplacePicketDayDto,
  ) {
    this.assertValidDay(day);
    await this.assertCanManage(classId, userId);
    const memberIds = [...new Set(dto.memberIds)];
    await this.assertActiveMembers(classId, memberIds);

    return this.prisma.$transaction(async (tx) => {
      const group = await tx.picketGroup.upsert({
        where: { classId_dayOfWeek: { classId, dayOfWeek: day } },
        create: { classId, dayOfWeek: day, name: dto.name ?? null },
        update: { name: dto.name ?? null },
        select: { id: true },
      });
      await tx.picketMember.deleteMany({ where: { groupId: group.id } });
      if (memberIds.length > 0) {
        await tx.picketMember.createMany({
          data: memberIds.map((memberId) => ({
            groupId: group.id,
            memberId,
          })),
        });
      }
      const row = await tx.picketGroup.findUniqueOrThrow({
        where: { id: group.id },
        select: picketGroupSelect,
      });
      return toPicketGroupResponse(row);
    });
  }

  /** F-PICKET-1: deletes a day's group; its seats cascade away. */
  async removeDay(classId: string, userId: string, day: number): Promise<void> {
    this.assertValidDay(day);
    await this.assertCanManage(classId, userId);
    const group = await this.prisma.picketGroup.findFirst({
      where: { classId, dayOfWeek: day },
      select: { id: true },
    });
    if (!group) throw new NotFoundException(GROUP_NOT_FOUND);
    await this.prisma.picketGroup.delete({ where: { id: group.id } });
  }

  /**
   * F-PICKET-2/BR-16: pushes a reminder to the active members of tomorrow's
   * groups. The (type, refId, user, day) claim inside PushSenderService makes a
   * re-run of the cron idempotent.
   */
  async sendTomorrowReminders(now: Date = new Date()): Promise<void> {
    const dayOfWeek = tomorrowDayOfWeekInJakarta(now);
    const groups = await this.prisma.picketGroup.findMany({
      where: { dayOfWeek, seats: { some: { member: { isActive: true } } } },
      select: {
        id: true,
        classId: true,
        classroom: { select: { name: true } },
        seats: {
          where: { member: { isActive: true } },
          select: { member: { select: { userId: true } } },
        },
      },
    });

    await Promise.all(
      groups.map((group) =>
        this.push.send({
          type: NotificationType.PICKET_REMINDER,
          refId: group.id,
          classId: group.classId,
          title: 'Picket duty tomorrow',
          body: `You are on picket duty tomorrow in ${group.classroom.name}`,
          userIds: [...new Set(group.seats.map((seat) => seat.member.userId))],
          data: { classId: group.classId, groupId: group.id, dayOfWeek },
        }),
      ),
    );
  }

  private assertValidDay(day: number): void {
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      throw new BadRequestException(INVALID_DAY);
    }
  }

  /** Every seat must point at an ACTIVE member of this class. */
  private async assertActiveMembers(
    classId: string,
    memberIds: string[],
  ): Promise<void> {
    if (memberIds.length === 0) return;
    const found = await this.prisma.classMember.findMany({
      where: { id: { in: memberIds }, classId, isActive: true },
      select: { id: true },
    });
    if (found.length !== memberIds.length) {
      throw new BadRequestException(INVALID_MEMBERS);
    }
  }

  /** The homeroom teacher or an active KETUA may manage the picket schedule. */
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
