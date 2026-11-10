import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClassRole, Prisma } from '../../generated/prisma/client';
import { paginate } from '../common/helpers/paginate.helper';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { QuerySubjectDto } from './dto/query-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';

const SUBJECT_NOT_FOUND = 'Subject not found';
const CLASS_NOT_FOUND = 'Classroom not found';
const MANAGE_FORBIDDEN =
  'Only the homeroom teacher or the class president can manage subjects';

/** Subject shape; `deletedAt` lets the client mark soft-deleted rows in history views. */
export const subjectSelect = {
  id: true,
  classId: true,
  name: true,
  teacherName: true,
  color: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SubjectSelect;

@Injectable()
export class SubjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(classId: string, userId: string, dto: CreateSubjectDto) {
    await this.assertCanManage(classId, userId);
    return this.prisma.subject.create({
      data: {
        classId,
        name: dto.name,
        teacherName: dto.teacherName ?? null,
        color: dto.color ?? null,
      },
      select: subjectSelect,
    });
  }

  /**
   * F-SUBJ-1: lists every subject of the class, soft-deleted rows included so
   * schedules and whiteboards keep their history labels.
   */
  async findAll(classId: string, userId: string, query: QuerySubjectDto) {
    await this.assertClassAccess(classId, userId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.SubjectWhereInput = { classId };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.subject.findMany({
        where,
        select: subjectSelect,
        skip: query.skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.subject.count({ where }),
    ]);
    return paginate(rows, total, page, limit);
  }

  async update(
    classId: string,
    subjectId: string,
    userId: string,
    dto: UpdateSubjectDto,
  ) {
    await this.assertCanManage(classId, userId);
    await this.assertActiveSubject(classId, subjectId);

    const data: Prisma.SubjectUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.teacherName !== undefined) data.teacherName = dto.teacherName;
    if (dto.color !== undefined) data.color = dto.color;

    return this.prisma.subject.update({
      where: { id: subjectId },
      data,
      select: subjectSelect,
    });
  }

  /** F-SUBJ-1: soft delete; the row survives because schedules/whiteboards reference it. */
  async remove(
    classId: string,
    subjectId: string,
    userId: string,
  ): Promise<void> {
    await this.assertCanManage(classId, userId);
    await this.assertActiveSubject(classId, subjectId);
    await this.prisma.subject.update({
      where: { id: subjectId },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
  }

  private async assertActiveSubject(
    classId: string,
    subjectId: string,
  ): Promise<void> {
    const subject = await this.prisma.subject.findFirst({
      where: { id: subjectId, classId, deletedAt: null },
      select: { id: true },
    });
    if (!subject) throw new NotFoundException(SUBJECT_NOT_FOUND);
  }

  /** The homeroom teacher or an active KETUA may manage subjects. */
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
