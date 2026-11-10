import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { generateClassCode } from '../common/helpers/class-code.helper';
import { paginate } from '../common/helpers/paginate.helper';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClassroomDto } from './dto/create-classroom.dto';
import { QueryClassroomDto } from './dto/query-classroom.dto';
import { UpdateClassroomDto } from './dto/update-classroom.dto';

/** BR-6: at most 5 code candidates before reporting a conflict. */
const MAX_CODE_ATTEMPTS = 5;
const CODE_CONFLICT =
  'Could not generate a unique class code, please try again';

/**
 * Classroom shape shared by create/list/detail/update. Never includes the join
 * code: it is returned only by create and regenerate-code (API_SPEC).
 * `memberCount` counts ACTIVE members only (BR-4).
 */
export const classroomSelect = {
  id: true,
  name: true,
  schoolName: true,
  academicYear: true,
  isLocked: true,
  maxStudents: true,
  homeroomTeacherId: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { members: { where: { isActive: true } } } },
} satisfies Prisma.ClassroomSelect;

/** Create also exposes the freshly generated code (F-CLASS-1, BR-6). */
const createdClassroomSelect = {
  ...classroomSelect,
  code: true,
} satisfies Prisma.ClassroomSelect;

/** Flattens Prisma's `_count.members` into `memberCount`. */
function toClassroomResponse<T extends { _count: { members: number } }>(
  row: T,
) {
  const { _count, ...rest } = row;
  return { ...rest, memberCount: _count.members };
}

function isClassCodeConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== 'P2002') return false;
  const target = error.meta?.target;
  return Array.isArray(target) ? target.includes('code') : target === 'code';
}

@Injectable()
export class ClassroomsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateClassroomDto, homeroomTeacherId: string) {
    const classroom = await this.withUniqueCode((code) =>
      this.prisma.classroom.create({
        data: {
          name: dto.name,
          schoolName: dto.schoolName,
          academicYear: dto.academicYear,
          maxStudents: dto.maxStudents,
          code,
          homeroomTeacherId,
        },
        select: createdClassroomSelect,
      }),
    );
    return toClassroomResponse(classroom);
  }

  async findAll(homeroomTeacherId: string, query: QueryClassroomDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    // mode: 'insensitive' is PostgreSQL-only, which matches this schema.
    const where: Prisma.ClassroomWhereInput = {
      homeroomTeacherId,
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.classroom.findMany({
        where,
        select: classroomSelect,
        skip: query.skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.classroom.count({ where }),
    ]);
    return paginate(rows.map(toClassroomResponse), total, page, limit);
  }

  async findOne(classId: string, userId: string) {
    await this.assertClassAccess(classId, userId);
    const classroom = await this.prisma.classroom.findUnique({
      where: { id: classId },
      select: classroomSelect,
    });
    if (!classroom) throw new NotFoundException('Classroom not found');
    return toClassroomResponse(classroom);
  }

  async update(classId: string, userId: string, dto: UpdateClassroomDto) {
    await this.assertHomeroomTeacher(classId, userId);

    // BR-4: lowering maxStudents below the ACTIVE count is allowed; it only
    // blocks new joins. Written fields are limited to those the client sent, so
    // an omitted field is untouched and `null` is a deliberate clear.
    const data: Prisma.ClassroomUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.schoolName !== undefined) data.schoolName = dto.schoolName;
    if (dto.academicYear !== undefined) data.academicYear = dto.academicYear;
    if (dto.isLocked !== undefined) data.isLocked = dto.isLocked;
    if (dto.maxStudents !== undefined) data.maxStudents = dto.maxStudents;

    const classroom = await this.prisma.classroom.update({
      where: { id: classId },
      data,
      select: classroomSelect,
    });
    return toClassroomResponse(classroom);
  }

  async regenerateCode(classId: string, userId: string) {
    await this.assertHomeroomTeacher(classId, userId);
    return this.withUniqueCode((code) =>
      this.prisma.classroom.update({
        where: { id: classId },
        data: { code },
        select: { code: true },
      }),
    );
  }

  /** BR-5: only the homeroom teacher of *this* class may manage it. */
  private async assertHomeroomTeacher(
    classId: string,
    userId: string,
  ): Promise<void> {
    const classroom = await this.prisma.classroom.findUnique({
      where: { id: classId },
      select: { homeroomTeacherId: true },
    });
    if (!classroom) throw new NotFoundException('Classroom not found');
    if (classroom.homeroomTeacherId !== userId) {
      throw new ForbiddenException(
        'Only the homeroom teacher can manage this class',
      );
    }
  }

  /** Detail is readable by the homeroom teacher or an ACTIVE member only. */
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
    if (!classroom) throw new NotFoundException('Classroom not found');
    if (
      classroom.homeroomTeacherId !== userId &&
      classroom.members.length === 0
    ) {
      throw new ForbiddenException('You are not allowed to view this class');
    }
  }

  /**
   * BR-6: retries code generation on a unique violation, up to MAX_CODE_ATTEMPTS.
   * A bounded retry, not an N+1 loop: each candidate depends on the previous
   * collision, so the writes cannot be batched into one statement.
   */
  private async withUniqueCode<T>(
    write: (code: string) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt += 1) {
      try {
        return await write(generateClassCode());
      } catch (error) {
        if (!isClassCodeConflict(error)) throw error;
        if (attempt === MAX_CODE_ATTEMPTS) {
          throw new ConflictException(CODE_CONFLICT);
        }
      }
    }
    // Unreachable: every iteration above returns or throws.
    throw new ConflictException(CODE_CONFLICT);
  }
}
