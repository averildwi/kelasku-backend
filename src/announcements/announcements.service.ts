import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClassRole, Prisma } from '../../generated/prisma/client';
import { paginate } from '../common/helpers/paginate.helper';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { QueryAnnouncementDto } from './dto/query-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

const ANNOUNCEMENT_NOT_FOUND = 'Announcement not found';
const CLASS_NOT_FOUND = 'Classroom not found';
const MANAGE_FORBIDDEN =
  'Only the homeroom teacher or the class president can manage announcements';

/** Announcement shape shared by every endpoint. Never leaks internal columns. */
export const announcementSelect = {
  id: true,
  classId: true,
  authorId: true,
  title: true,
  content: true,
  isPinned: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.AnnouncementSelect;

type AnnouncementRow = Prisma.AnnouncementGetPayload<{
  select: typeof announcementSelect;
}>;

/** BR-10: `isRead` for the current user without exposing the other receipts. */
function toAnnouncementSummary<
  T extends AnnouncementRow & { reads: unknown[] },
>(row: T) {
  const { reads, ...rest } = row;
  return { ...rest, isRead: reads.length > 0 };
}

/** F-ANN-1: detail carries the current user's own read time only. */
function toAnnouncementDetail<
  T extends AnnouncementRow & { reads: { readAt: Date }[] },
>(row: T) {
  const { reads, ...rest } = row;
  return { ...rest, myReadAt: reads[0]?.readAt ?? null };
}

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** F-ANN-1: the author must be the homeroom teacher or an active KETUA. */
  async create(classId: string, userId: string, dto: CreateAnnouncementDto) {
    await this.assertCanManage(classId, userId);
    return this.prisma.announcement.create({
      data: {
        classId,
        authorId: userId,
        title: dto.title,
        content: dto.content,
        isPinned: dto.isPinned ?? false,
      },
      select: announcementSelect,
    });
  }

  /** F-ANN-1: pinned first, then newest; each item carries `isRead`. */
  async findAll(classId: string, userId: string, query: QueryAnnouncementDto) {
    await this.assertClassAccess(classId, userId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.AnnouncementWhereInput = {
      classId,
      deletedAt: null,
      ...(query.isPinned !== undefined ? { isPinned: query.isPinned } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.announcement.findMany({
        where,
        select: {
          ...announcementSelect,
          reads: { where: { userId }, select: { readAt: true }, take: 1 },
        },
        skip: query.skip,
        take: limit,
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.announcement.count({ where }),
    ]);
    return paginate(rows.map(toAnnouncementSummary), total, page, limit);
  }

  async findOne(classId: string, announcementId: string, userId: string) {
    await this.assertClassAccess(classId, userId);
    const announcement = await this.prisma.announcement.findFirst({
      where: { id: announcementId, classId, deletedAt: null },
      select: {
        ...announcementSelect,
        reads: { where: { userId }, select: { readAt: true }, take: 1 },
      },
    });
    if (!announcement) throw new NotFoundException(ANNOUNCEMENT_NOT_FOUND);
    return toAnnouncementDetail(announcement);
  }

  /** BR-9: author or homeroom teacher only. */
  async update(
    classId: string,
    announcementId: string,
    userId: string,
    dto: UpdateAnnouncementDto,
  ) {
    const { id } = await this.assertCanEdit(
      classId,
      announcementId,
      userId,
      'Only the author or the homeroom teacher can edit this announcement',
    );

    const data: Prisma.AnnouncementUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.isPinned !== undefined) data.isPinned = dto.isPinned;

    const updated = await this.prisma.announcement.update({
      where: { id },
      data,
      select: {
        ...announcementSelect,
        reads: { where: { userId }, select: { readAt: true }, take: 1 },
      },
    });
    return toAnnouncementDetail(updated);
  }

  /** BR-9: soft delete keeps the receipts; author or homeroom teacher only. */
  async remove(
    classId: string,
    announcementId: string,
    userId: string,
  ): Promise<void> {
    const { id } = await this.assertCanEdit(
      classId,
      announcementId,
      userId,
      'Only the author or the homeroom teacher can delete this announcement',
    );
    await this.prisma.announcement.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
  }

  /** BR-10: idempotent receipt; `readAt` is the first read and is never overwritten. */
  async markRead(classId: string, announcementId: string, userId: string) {
    await this.assertClassAccess(classId, userId);
    const announcement = await this.prisma.announcement.findFirst({
      where: { id: announcementId, classId, deletedAt: null },
      select: { id: true },
    });
    if (!announcement) throw new NotFoundException(ANNOUNCEMENT_NOT_FOUND);

    const read = await this.prisma.announcementRead.upsert({
      where: {
        announcementId_userId: { announcementId: announcement.id, userId },
      },
      create: { announcementId: announcement.id, userId },
      update: {},
      select: { readAt: true },
    });
    return { readAt: read.readAt };
  }

  /**
   * BR-10/F-ANN-2: counts and member lists computed against the class's current
   * active members; a receipt from a member who has since left is ignored.
   * Visible to the homeroom teacher or an active KETUA.
   */
  async getReadReceipts(
    classId: string,
    announcementId: string,
    userId: string,
  ) {
    await this.assertCanManage(classId, userId);
    const announcement = await this.prisma.announcement.findFirst({
      where: { id: announcementId, classId, deletedAt: null },
      select: { id: true },
    });
    if (!announcement) throw new NotFoundException(ANNOUNCEMENT_NOT_FOUND);

    const [members, reads] = await this.prisma.$transaction([
      this.prisma.classMember.findMany({
        where: { classId, isActive: true },
        select: {
          userId: true,
          user: { select: { id: true, name: true, avatarUrl: true } },
        },
        orderBy: { joinedAt: 'asc' },
      }),
      this.prisma.announcementRead.findMany({
        where: { announcementId: announcement.id },
        select: { userId: true, readAt: true },
      }),
    ]);

    const readAtByUser = new Map(reads.map((r) => [r.userId, r.readAt]));
    const read: {
      userId: string;
      name: string;
      avatarUrl: string | null;
      readAt: Date;
    }[] = [];
    const unread: { userId: string; name: string; avatarUrl: string | null }[] =
      [];
    for (const member of members) {
      const base = {
        userId: member.userId,
        name: member.user.name,
        avatarUrl: member.user.avatarUrl,
      };
      const readAt = readAtByUser.get(member.userId);
      if (readAt) read.push({ ...base, readAt });
      else unread.push(base);
    }

    return {
      readCount: read.length,
      unreadCount: unread.length,
      read,
      unread,
    };
  }

  /** BR-9: loads the announcement and asserts author or homeroom teacher. */
  private async assertCanEdit(
    classId: string,
    announcementId: string,
    userId: string,
    forbiddenMessage: string,
  ): Promise<{ id: string }> {
    const announcement = await this.prisma.announcement.findFirst({
      where: { id: announcementId, classId, deletedAt: null },
      select: {
        id: true,
        authorId: true,
        classroom: { select: { homeroomTeacherId: true } },
      },
    });
    if (!announcement) throw new NotFoundException(ANNOUNCEMENT_NOT_FOUND);
    const isHomeroom = announcement.classroom.homeroomTeacherId === userId;
    if (announcement.authorId !== userId && !isHomeroom) {
      throw new ForbiddenException(forbiddenMessage);
    }
    return { id: announcement.id };
  }

  /** The homeroom teacher or an active KETUA may create and see receipts. */
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
