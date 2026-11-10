import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClassRole, MemberStatus, Prisma } from '../../generated/prisma/client';
import { paginate } from '../common/helpers/paginate.helper';
import { PrismaService } from '../prisma/prisma.service';
import { AssignRoleDto } from './dto/assign-role.dto';
import { JoinClassroomDto } from './dto/join-classroom.dto';
import { KickMemberDto } from './dto/kick-member.dto';
import { QueryMemberDto } from './dto/query-member.dto';

/** Distinct join rejections (BR-3); the client shows the message as-is. */
const CLASS_NOT_FOUND = 'Class not found';
const ALREADY_IN_CLASS = 'You already belong to a class';
const CLASS_LOCKED = 'This class is locked';
const CLASS_FULL = 'This class is full';
const KICKED_BEFORE =
  'You were removed from this class, ask the homeroom teacher to restore you';

/** Member shape shared by every membership endpoint. */
export const memberSelect = {
  id: true,
  userId: true,
  role: true,
  status: true,
  joinedAt: true,
  leftAt: true,
  kickReason: true,
  user: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.ClassMemberSelect;

type MemberRow = Prisma.ClassMemberGetPayload<{ select: typeof memberSelect }>;

/** Flattens `user` and renames `role` to `classRole`; never leaks other columns. */
export function toMemberResponse(row: MemberRow) {
  const { user, role, ...rest } = row;
  return {
    ...rest,
    name: user.name,
    avatarUrl: user.avatarUrl,
    classRole: role,
  };
}

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * BR-2/BR-3/BR-4/BR-12: a student joins at most one class by code. The
   * classroom row is locked so parallel joins of the last seat cannot exceed
   * `maxStudents`; an advisory lock on the student serializes cross-class joins.
   */
  async join(dto: JoinClassroomDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const classroom = await tx.classroom.findUnique({
        where: { code: dto.code },
        select: { id: true, name: true, isLocked: true, maxStudents: true },
      });
      if (!classroom) throw new NotFoundException(CLASS_NOT_FOUND);

      await this.lockClassroom(tx, classroom.id);
      await this.lockUser(tx, userId);

      const active = await tx.classMember.findFirst({
        where: { userId, isActive: true },
        select: { id: true },
      });
      if (active) throw new ConflictException(ALREADY_IN_CLASS);
      if (classroom.isLocked) throw new ForbiddenException(CLASS_LOCKED);

      await this.assertSeatAvailable(tx, classroom.id, classroom.maxStudents);

      const existing = await tx.classMember.findUnique({
        where: { classId_userId: { classId: classroom.id, userId } },
        select: { id: true, status: true },
      });
      if (existing?.status === MemberStatus.KICKED) {
        throw new ForbiddenException(KICKED_BEFORE);
      }

      if (existing) {
        // Re-join after LEAVE reactivates the same row (F-CLASS-6).
        const member = await tx.classMember.update({
          where: { id: existing.id },
          data: {
            role: ClassRole.MEMBER,
            status: MemberStatus.ACTIVE,
            isActive: true,
            joinedAt: new Date(),
            leftAt: null,
          },
          select: memberSelect,
        });
        return {
          classId: classroom.id,
          name: classroom.name,
          classRole: member.role,
        };
      }

      const member = await tx.classMember.create({
        data: { classId: classroom.id, userId, role: ClassRole.MEMBER },
        select: memberSelect,
      });
      return {
        classId: classroom.id,
        name: classroom.name,
        classRole: member.role,
      };
    });
  }

  /** BR-8: the leaver reverts to MEMBER; the row is kept as LEFT, never deleted. */
  async leave(classId: string, userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockClassroom(tx, classId);
      await this.lockUser(tx, userId);

      const member = await tx.classMember.findUnique({
        where: { classId_userId: { classId, userId } },
        select: { id: true, isActive: true },
      });
      if (!member) throw new NotFoundException('Membership not found');
      if (!member.isActive) {
        throw new ForbiddenException(
          'You are not an active member of this class',
        );
      }

      await tx.classMember.update({
        where: { id: member.id },
        data: {
          role: ClassRole.MEMBER,
          status: MemberStatus.LEFT,
          isActive: false,
          leftAt: new Date(),
        },
        select: { id: true },
      });
      // A departed member releases their duty seats (state machine side effect).
      await tx.picketMember.deleteMany({ where: { memberId: member.id } });
    });
  }

  /** BR-5/BR-7/BR-8: soft kick, only by the homeroom teacher of this class. */
  async kick(
    classId: string,
    memberId: string,
    homeroomTeacherId: string,
    dto: KickMemberDto,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.assertHomeroomTeacher(tx, classId, homeroomTeacherId);
      await this.lockClassroom(tx, classId);

      const member = await tx.classMember.findFirst({
        where: { id: memberId, classId },
        select: { id: true, userId: true, isActive: true },
      });
      if (!member) throw new NotFoundException('Member not found');
      await this.lockUser(tx, member.userId);
      if (!member.isActive) {
        throw new ConflictException('Member is already inactive');
      }

      await tx.classMember.update({
        where: { id: member.id },
        data: {
          role: ClassRole.MEMBER,
          status: MemberStatus.KICKED,
          isActive: false,
          leftAt: new Date(),
          kickedById: homeroomTeacherId,
          kickReason: dto.reason ?? null,
        },
        select: { id: true },
      });
      await tx.picketMember.deleteMany({ where: { memberId: member.id } });
    });
  }

  /** BR-2/BR-5: un-kick; a LEFT row cannot be restored (the student re-joins). */
  async restore(classId: string, memberId: string, homeroomTeacherId: string) {
    return this.prisma.$transaction(async (tx) => {
      const classroom = await this.assertHomeroomTeacher(
        tx,
        classId,
        homeroomTeacherId,
      );
      await this.lockClassroom(tx, classId);

      const member = await tx.classMember.findFirst({
        where: { id: memberId, classId },
        select: { id: true, userId: true, status: true, isActive: true },
      });
      if (!member) throw new NotFoundException('Member not found');
      await this.lockUser(tx, member.userId);
      if (member.isActive) {
        throw new ConflictException('Member is already active');
      }
      if (member.status === MemberStatus.LEFT) {
        throw new ConflictException('Member was not kicked — re-join via code');
      }

      const elsewhere = await tx.classMember.findFirst({
        where: {
          userId: member.userId,
          isActive: true,
          NOT: { id: member.id },
        },
        select: { id: true },
      });
      if (elsewhere) throw new ConflictException(ALREADY_IN_CLASS);

      await this.assertSeatAvailable(tx, classId, classroom.maxStudents);

      const updated = await tx.classMember.update({
        where: { id: member.id },
        data: {
          status: MemberStatus.ACTIVE,
          isActive: true,
          joinedAt: new Date(),
          leftAt: null,
          kickedById: null,
          kickReason: null,
        },
        select: memberSelect,
      });
      return toMemberResponse(updated);
    });
  }

  /**
   * BR-1: at most one KETUA and one BENDAHARA per class. The previous holder is
   * demoted before the new one is promoted, inside one transaction, so the
   * partial unique index never sees two holders at once.
   */
  async assignRole(
    classId: string,
    memberId: string,
    homeroomTeacherId: string,
    dto: AssignRoleDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertHomeroomTeacher(tx, classId, homeroomTeacherId);
      await this.lockClassroom(tx, classId);

      const member = await tx.classMember.findFirst({
        where: { id: memberId, classId },
        select: { id: true, userId: true, isActive: true },
      });
      if (!member) throw new NotFoundException('Member not found');
      await this.lockUser(tx, member.userId);
      if (!member.isActive) {
        throw new ForbiddenException(
          'Only an active member can hold an office',
        );
      }

      if (dto.classRole !== ClassRole.MEMBER) {
        await tx.classMember.updateMany({
          where: {
            classId,
            role: dto.classRole,
            isActive: true,
            NOT: { id: member.id },
          },
          data: { role: ClassRole.MEMBER },
        });
      }

      const updated = await tx.classMember.update({
        where: { id: member.id },
        data: { role: dto.classRole },
        select: memberSelect,
      });
      return toMemberResponse(updated);
    });
  }

  /** F-CLASS-6: the roster (ACTIVE only); homeroom teacher or an active member. */
  async listMembers(classId: string, userId: string, query: QueryMemberDto) {
    await this.assertClassAccess(this.prisma, classId, userId);
    return this.findMembers({ classId, isActive: true }, query);
  }

  /** F-CLASS-3/6: kicked or left members; homeroom teacher only. */
  async listInactive(
    classId: string,
    homeroomTeacherId: string,
    query: QueryMemberDto,
  ) {
    await this.assertHomeroomTeacher(this.prisma, classId, homeroomTeacherId);
    return this.findMembers({ classId, isActive: false }, query);
  }

  private async findMembers(
    where: Prisma.ClassMemberWhereInput,
    query: QueryMemberDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    // mode: 'insensitive' is PostgreSQL-only, which matches this schema.
    const scoped: Prisma.ClassMemberWhereInput = query.search
      ? {
          ...where,
          user: { name: { contains: query.search, mode: 'insensitive' } },
        }
      : where;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.classMember.findMany({
        where: scoped,
        select: memberSelect,
        skip: query.skip,
        take: limit,
        orderBy: { joinedAt: 'asc' },
      }),
      this.prisma.classMember.count({ where: scoped }),
    ]);
    return paginate(rows.map(toMemberResponse), total, page, limit);
  }

  /** BR-5: only the homeroom teacher of *this* class may manage its members. */
  private async assertHomeroomTeacher(
    tx: Prisma.TransactionClient,
    classId: string,
    userId: string,
  ) {
    const classroom = await tx.classroom.findUnique({
      where: { id: classId },
      select: {
        id: true,
        name: true,
        isLocked: true,
        maxStudents: true,
        homeroomTeacherId: true,
      },
    });
    if (!classroom) throw new NotFoundException(CLASS_NOT_FOUND);
    if (classroom.homeroomTeacherId !== userId) {
      throw new ForbiddenException(
        'Only the homeroom teacher can manage this class',
      );
    }
    return classroom;
  }

  /** The roster is readable by the homeroom teacher or an ACTIVE member only. */
  private async assertClassAccess(
    tx: Prisma.TransactionClient,
    classId: string,
    userId: string,
  ): Promise<void> {
    const classroom = await tx.classroom.findUnique({
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

  /** BR-4: the quota counts ACTIVE members only; null means unlimited. */
  private async assertSeatAvailable(
    tx: Prisma.TransactionClient,
    classId: string,
    maxStudents: number | null,
  ): Promise<void> {
    if (maxStudents == null) return;
    const count = await tx.classMember.count({
      where: { classId, isActive: true },
    });
    if (count >= maxStudents) throw new ForbiddenException(CLASS_FULL);
  }

  /**
   * BR-12: `SELECT ... FOR UPDATE` on the classroom serializes capacity-changing
   * operations (join, leave, kick, restore, assign-role) within one class.
   */
  private async lockClassroom(
    tx: Prisma.TransactionClient,
    classId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "classrooms" WHERE id = ${classId}::uuid FOR UPDATE`;
  }

  /**
   * BR-2: an advisory lock keyed by the student serializes membership changes
   * across classes, so two parallel joins by one student cannot both commit.
   */
  private async lockUser(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    // The void return type is cast to text so Prisma can deserialize the row.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))::text`;
  }
}
