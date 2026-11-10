import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClassRole, Prisma } from '../../generated/prisma/client';
import { paginate } from '../common/helpers/paginate.helper';
import {
  buildWhiteboardFolder,
  StorageService,
  StoredImage,
  UploadedImageFile,
} from '../common/upload/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWhiteboardDto } from './dto/create-whiteboard.dto';
import { QueryWhiteboardDto } from './dto/query-whiteboard.dto';
import { UpdateWhiteboardDto } from './dto/update-whiteboard.dto';

/** BR-13: a note holds 1–5 images, each jpg/png/webp and at most 5 MB. */
export const MAX_WHITEBOARD_IMAGES = 5;
export const MAX_WHITEBOARD_FILE_SIZE = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

const CLASS_NOT_FOUND = 'Classroom not found';
const NOTE_NOT_FOUND = 'Whiteboard note not found';
const SUBJECT_NOT_FOUND = 'Subject not found';
const UPDATE_FORBIDDEN = 'Only the uploader can edit this whiteboard note';
const DELETE_FORBIDDEN =
  'Only the uploader, the class president or the homeroom teacher can delete this note';
const DATE_IN_FUTURE = 'date must not be in the future';
const TOO_FEW_IMAGES = 'At least one image is required';
const TOO_MANY_IMAGES = `At most ${MAX_WHITEBOARD_IMAGES} images are allowed`;
const INVALID_MIME = 'Images must be jpeg, png or webp';
const FILE_TOO_LARGE = 'Each image must be at most 5 MB';

const JAKARTA_TIME_ZONE = 'Asia/Jakarta';

/** Image shape exposed to clients; `cloudinaryPublicId` never leaves the API. */
export const whiteboardImageSelect = {
  id: true,
  url: true,
  width: true,
  height: true,
  position: true,
} satisfies Prisma.WhiteboardImageSelect;

/** Note shape shared by list/detail/create/update. */
export const whiteboardNoteSelect = {
  id: true,
  classId: true,
  subjectId: true,
  uploaderId: true,
  date: true,
  caption: true,
  createdAt: true,
  updatedAt: true,
  subject: { select: { id: true, name: true, color: true } },
  uploader: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.WhiteboardNoteSelect;

export const whiteboardDetailSelect = {
  ...whiteboardNoteSelect,
  images: {
    select: whiteboardImageSelect,
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.WhiteboardNoteSelect;

/** Today's calendar date (YYYY-MM-DD) in Asia/Jakarta, regardless of server TZ. */
export function jakartaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: JAKARTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** `@db.Date` columns store a calendar date, so midnight UTC is unambiguous. */
export function parseDateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function assertValidImages(files: UploadedImageFile[]): void {
  if (files.length < 1) throw new BadRequestException(TOO_FEW_IMAGES);
  if (files.length > MAX_WHITEBOARD_IMAGES) {
    throw new BadRequestException(TOO_MANY_IMAGES);
  }
  for (const file of files) {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(INVALID_MIME);
    }
    if (file.size > MAX_WHITEBOARD_FILE_SIZE) {
      throw new BadRequestException(FILE_TOO_LARGE);
    }
  }
}

function assertNotFuture(date: string): void {
  if (date > jakartaToday()) throw new BadRequestException(DATE_IN_FUTURE);
}

@Injectable()
export class WhiteboardsService {
  private readonly logger = new Logger(WhiteboardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * F-WB-1/BR-13: uploads the images first, then writes the note and its image
   * rows in one transaction. A failed upload cleans up what already landed.
   */
  async create(
    classId: string,
    userId: string,
    dto: CreateWhiteboardDto,
    files: UploadedImageFile[],
  ) {
    await this.assertClassAccess(classId, userId);
    assertValidImages(files);
    assertNotFuture(dto.date);
    await this.assertSubjectInClass(classId, dto.subjectId);

    const folder = buildWhiteboardFolder(classId);
    const uploaded: StoredImage[] = [];
    try {
      // Sequential on purpose: on failure only the already-uploaded files are cleaned up.
      for (const file of files) {
        uploaded.push(await this.storage.uploadImage(file, folder));
      }
    } catch (error) {
      void this.cleanupImages(uploaded.map((image) => image.publicId));
      throw error;
    }

    return this.prisma.$transaction(async (tx) => {
      const note = await tx.whiteboardNote.create({
        data: {
          classId,
          subjectId: dto.subjectId,
          uploaderId: userId,
          date: parseDateOnly(dto.date),
          caption: dto.caption ?? null,
        },
        select: whiteboardNoteSelect,
      });
      await tx.whiteboardImage.createMany({
        data: uploaded.map((image, position) => ({
          noteId: note.id,
          url: image.url,
          cloudinaryPublicId: image.publicId,
          width: image.width,
          height: image.height,
          position,
        })),
      });
      return tx.whiteboardNote.findUniqueOrThrow({
        where: { id: note.id },
        select: whiteboardDetailSelect,
      });
    });
  }

  /** F-WB-1: newest note first; filters by subject and by date or date range. */
  async findAll(classId: string, userId: string, query: QueryWhiteboardDto) {
    await this.assertClassAccess(classId, userId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const dateFilter: Prisma.DateTimeFilter = {};
    if (query.date) {
      dateFilter.equals = parseDateOnly(query.date);
    } else {
      if (query.from) dateFilter.gte = parseDateOnly(query.from);
      if (query.to) dateFilter.lte = parseDateOnly(query.to);
    }

    const where: Prisma.WhiteboardNoteWhereInput = {
      classId,
      deletedAt: null,
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.whiteboardNote.findMany({
        where,
        select: whiteboardDetailSelect,
        skip: query.skip,
        take: limit,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.whiteboardNote.count({ where }),
    ]);
    return paginate(rows, total, page, limit);
  }

  async findOne(classId: string, whiteboardId: string, userId: string) {
    await this.assertClassAccess(classId, userId);
    const note = await this.prisma.whiteboardNote.findFirst({
      where: { id: whiteboardId, classId, deletedAt: null },
      select: whiteboardDetailSelect,
    });
    if (!note) throw new NotFoundException(NOTE_NOT_FOUND);
    return note;
  }

  /** F-WB-1: the uploader only. Officers moderate by deleting, not editing. */
  async update(
    classId: string,
    whiteboardId: string,
    userId: string,
    dto: UpdateWhiteboardDto,
  ) {
    const note = await this.prisma.whiteboardNote.findFirst({
      where: { id: whiteboardId, classId, deletedAt: null },
      select: { id: true, uploaderId: true },
    });
    if (!note) throw new NotFoundException(NOTE_NOT_FOUND);
    if (note.uploaderId !== userId) {
      throw new ForbiddenException(UPDATE_FORBIDDEN);
    }

    if (dto.date !== undefined) assertNotFuture(dto.date);
    if (dto.subjectId !== undefined) {
      await this.assertSubjectInClass(classId, dto.subjectId);
    }

    const data: Prisma.WhiteboardNoteUncheckedUpdateInput = {};
    if (dto.caption !== undefined) data.caption = dto.caption;
    if (dto.subjectId !== undefined) data.subjectId = dto.subjectId;
    if (dto.date !== undefined) data.date = parseDateOnly(dto.date);

    return this.prisma.whiteboardNote.update({
      where: { id: note.id },
      data,
      select: whiteboardDetailSelect,
    });
  }

  /**
   * F-WB-1: soft-deletes the note (history stays) and removes its images from
   * Cloudinary asynchronously. The cleanup never fails the request; failures
   * are logged instead of swallowed.
   */
  async remove(
    classId: string,
    whiteboardId: string,
    userId: string,
  ): Promise<void> {
    const note = await this.prisma.whiteboardNote.findFirst({
      where: { id: whiteboardId, classId, deletedAt: null },
      select: {
        id: true,
        uploaderId: true,
        images: { select: { cloudinaryPublicId: true } },
        classroom: {
          select: {
            homeroomTeacherId: true,
            members: {
              where: { userId, isActive: true },
              select: { role: true },
              take: 1,
            },
          },
        },
      },
    });
    if (!note) throw new NotFoundException(NOTE_NOT_FOUND);

    const isUploader = note.uploaderId === userId;
    const isHomeroom = note.classroom.homeroomTeacherId === userId;
    const isKetua = note.classroom.members[0]?.role === ClassRole.KETUA;
    if (!isUploader && !isHomeroom && !isKetua) {
      throw new ForbiddenException(DELETE_FORBIDDEN);
    }

    await this.prisma.whiteboardNote.update({
      where: { id: note.id },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
    void this.cleanupImages(
      note.images.map((image) => image.cloudinaryPublicId),
    );
  }

  /** Best-effort: every failure is logged, never rethrown to the caller. */
  private async cleanupImages(publicIds: string[]): Promise<void> {
    const results = await Promise.allSettled(
      publicIds.map((publicId) => this.storage.deleteImage(publicId)),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        const reason =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        this.logger.error(`Cloudinary cleanup failed: ${reason}`);
      }
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

  /** Read/create: the homeroom teacher or an ACTIVE member only. */
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
