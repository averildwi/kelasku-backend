import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClassRole } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QuerySubjectDto } from './dto/query-subject.dto';
import { subjectSelect, SubjectsService } from './subjects.service';

interface SubjectRow {
  id: string;
  classId: string;
  name: string;
  teacherName: string | null;
  color: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface UpdateCallArgs {
  where: { id: string };
  data: { deletedAt: Date };
  select: { id: boolean };
}

function subjectRow(overrides: Partial<SubjectRow> = {}): SubjectRow {
  return {
    id: 's1',
    classId: 'c1',
    name: 'Matematika',
    teacherName: null,
    color: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('SubjectsService', () => {
  let service: SubjectsService;
  let prisma: {
    classroom: { findUnique: jest.Mock };
    subject: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      classroom: { findUnique: jest.fn() },
      subject: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SubjectsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(SubjectsService);
  });

  describe('SubjectsService.create', () => {
    it('creates a subject for the homeroom teacher', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.subject.create.mockResolvedValue(subjectRow());

      const result = await service.create('c1', 'w1', {
        name: 'Matematika',
      });

      expect(prisma.subject.create).toHaveBeenCalledWith({
        data: {
          classId: 'c1',
          name: 'Matematika',
          teacherName: null,
          color: null,
        },
        select: subjectSelect,
      });
      expect(result).toMatchObject({ id: 's1' });
    });

    it('creates a subject for an active KETUA', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ role: ClassRole.KETUA }],
      });
      prisma.subject.create.mockResolvedValue(subjectRow());

      await service.create('c1', 'm1', {
        name: 'Fisika',
        teacherName: 'Pak Andi',
        color: '#2563EB',
      });

      expect(prisma.subject.create).toHaveBeenCalledWith({
        data: {
          classId: 'c1',
          name: 'Fisika',
          teacherName: 'Pak Andi',
          color: '#2563EB',
        },
        select: subjectSelect,
      });
    });

    it('throws ForbiddenException for an active MEMBER and writes nothing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ role: ClassRole.MEMBER }],
      });

      await expect(
        service.create('c1', 'u2', { name: 'Matematika' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.subject.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the classroom does not exist', async () => {
      prisma.classroom.findUnique.mockResolvedValue(null);

      await expect(
        service.create('c1', 'w1', { name: 'Matematika' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.subject.create).not.toHaveBeenCalled();
    });
  });

  describe('SubjectsService.findAll', () => {
    it('lists the class subjects including soft-deleted rows', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.subject.findMany.mockResolvedValue([
        subjectRow(),
        subjectRow({ id: 's2', name: 'Biologi', deletedAt: new Date() }),
      ]);
      prisma.subject.count.mockResolvedValue(2);

      const result = await service.findAll('c1', 'w1', new QuerySubjectDto());

      expect(prisma.subject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { classId: 'c1' },
          orderBy: { name: 'asc' },
          skip: 0,
          take: 20,
        }),
      );
      expect(result.meta).toEqual({
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
      expect(result.data).toHaveLength(2);
    });

    it('throws ForbiddenException for a non-member and reads nothing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });

      await expect(
        service.findAll('c1', 'u9', new QuerySubjectDto()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.subject.findMany).not.toHaveBeenCalled();
    });
  });

  describe('SubjectsService.update', () => {
    it('writes only the provided fields', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.subject.findFirst.mockResolvedValue({ id: 's1' });
      prisma.subject.update.mockResolvedValue(
        subjectRow({ teacherName: 'Bu Sari' }),
      );

      await service.update('c1', 's1', 'w1', { teacherName: 'Bu Sari' });

      expect(prisma.subject.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { teacherName: 'Bu Sari' },
        select: subjectSelect,
      });
    });

    it('throws NotFoundException when the subject is missing or deleted', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.subject.findFirst.mockResolvedValue(null);

      await expect(
        service.update('c1', 's1', 'w1', { name: 'New name' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.subject.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for an active MEMBER and writes nothing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ role: ClassRole.MEMBER }],
      });

      await expect(
        service.update('c1', 's1', 'u2', { name: 'New name' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.subject.update).not.toHaveBeenCalled();
    });
  });

  describe('SubjectsService.remove', () => {
    it('soft deletes the subject and keeps the row', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.subject.findFirst.mockResolvedValue({ id: 's1' });
      prisma.subject.update.mockResolvedValue({ id: 's1' });

      await service.remove('c1', 's1', 'w1');

      expect(prisma.subject.update).toHaveBeenCalledTimes(1);
      const calls = prisma.subject.update.mock
        .calls as unknown as UpdateCallArgs[][];
      const args = calls[0][0];
      expect(args.where).toEqual({ id: 's1' });
      expect(args.data.deletedAt).toBeInstanceOf(Date);
      expect(args.select).toEqual({ id: true });
    });

    it('throws NotFoundException when the subject is already deleted', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.subject.findFirst.mockResolvedValue(null);

      await expect(service.remove('c1', 's1', 'w1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.subject.update).not.toHaveBeenCalled();
    });
  });
});
