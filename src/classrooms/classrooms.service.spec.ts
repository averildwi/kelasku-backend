import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../generated/prisma/client';
import { CLASS_CODE_LENGTH } from '../common/helpers/class-code.helper';
import { PrismaService } from '../prisma/prisma.service';
import { classroomSelect, ClassroomsService } from './classrooms.service';
import { QueryClassroomDto } from './dto/query-classroom.dto';

const CLASS_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

function codeConflict(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`code`)',
    { code: 'P2002', clientVersion: 'test', meta: { target: ['code'] } },
  );
}

function classroomRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'XII IPA 2',
    schoolName: null,
    academicYear: null,
    isLocked: false,
    maxStudents: null,
    homeroomTeacherId: 'w1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    _count: { members: 0 },
    ...overrides,
  };
}

describe('ClassroomsService', () => {
  let service: ClassroomsService;
  let prisma: {
    classroom: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      classroom: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      // Array form: run the two reads like Prisma does.
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ClassroomsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(ClassroomsService);
  });

  describe('ClassroomsService.create', () => {
    it('creates a classroom with a valid code and records the homeroom teacher', async () => {
      const created: Array<{
        data: { name: string; homeroomTeacherId: string; code: string };
      }> = [];
      prisma.classroom.create.mockImplementation(
        (args: {
          data: { name: string; homeroomTeacherId: string; code: string };
        }) => {
          created.push(args);
          return Promise.resolve({ ...classroomRow(), code: args.data.code });
        },
      );

      const result = await service.create({ name: 'XII IPA 2' }, 'w1');

      expect(created).toHaveLength(1);
      expect(created[0].data.name).toBe('XII IPA 2');
      expect(created[0].data.homeroomTeacherId).toBe('w1');
      expect(created[0].data.code).toMatch(CLASS_CODE_PATTERN);
      expect(created[0].data.code).toHaveLength(CLASS_CODE_LENGTH);
      expect(result.code).toMatch(CLASS_CODE_PATTERN);
      expect(result).toMatchObject({ memberCount: 0 });
      expect(result).not.toHaveProperty('_count');
    });

    it('retries with a new code when the generated one already exists', async () => {
      const codes: string[] = [];
      prisma.classroom.create
        .mockRejectedValueOnce(codeConflict())
        .mockImplementationOnce((args: { data: { code: string } }) => {
          codes.push(args.data.code);
          return Promise.resolve({ ...classroomRow(), code: args.data.code });
        });

      const result = await service.create({ name: 'XII IPA 2' }, 'w1');

      expect(prisma.classroom.create).toHaveBeenCalledTimes(2);
      expect(codes).toHaveLength(1);
      expect(result.code).toBe(codes[0]);
    });

    it('throws ConflictException after five colliding codes', async () => {
      prisma.classroom.create.mockRejectedValue(codeConflict());

      await expect(
        service.create({ name: 'XII IPA 2' }, 'w1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.classroom.create).toHaveBeenCalledTimes(5);
    });

    it('does not retry an unrelated database error', async () => {
      const failure = new Error('connection lost');
      prisma.classroom.create.mockRejectedValue(failure);

      await expect(service.create({ name: 'XII IPA 2' }, 'w1')).rejects.toBe(
        failure,
      );
      expect(prisma.classroom.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('ClassroomsService.findAll', () => {
    it('scopes the list to the homeroom teacher and maps memberCount', async () => {
      prisma.classroom.findMany.mockResolvedValue([
        classroomRow({ _count: { members: 3 } }),
      ]);
      prisma.classroom.count.mockResolvedValue(1);

      const query = new QueryClassroomDto();
      query.search = 'IPA';

      const result = await service.findAll('w1', query);

      expect(prisma.classroom.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            homeroomTeacherId: 'w1',
            name: { contains: 'IPA', mode: 'insensitive' },
          },
          skip: 0,
          take: 20,
        }),
      );
      expect(prisma.classroom.count).toHaveBeenCalledWith({
        where: {
          homeroomTeacherId: 'w1',
          name: { contains: 'IPA', mode: 'insensitive' },
        },
      });
      expect(result.data[0]).toMatchObject({ memberCount: 3 });
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('does not filter by name when no search is given', async () => {
      prisma.classroom.findMany.mockResolvedValue([]);
      prisma.classroom.count.mockResolvedValue(0);

      await service.findAll('w1', new QueryClassroomDto());

      expect(prisma.classroom.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { homeroomTeacherId: 'w1' } }),
      );
    });
  });

  describe('ClassroomsService.findOne', () => {
    it('returns detail for the homeroom teacher', async () => {
      prisma.classroom.findUnique
        .mockResolvedValueOnce({ homeroomTeacherId: 'w1', members: [] })
        .mockResolvedValueOnce(classroomRow({ _count: { members: 5 } }));

      const result = await service.findOne('c1', 'w1');

      expect(result).toMatchObject({ id: 'c1', memberCount: 5 });
    });

    it('returns detail for an ACTIVE member', async () => {
      prisma.classroom.findUnique
        .mockResolvedValueOnce({
          homeroomTeacherId: 'w1',
          members: [{ id: 'm1' }],
        })
        .mockResolvedValueOnce(classroomRow());

      await expect(service.findOne('c1', 'u2')).resolves.toMatchObject({
        id: 'c1',
      });
    });

    it('throws NotFoundException when the classroom is gone', async () => {
      prisma.classroom.findUnique.mockResolvedValue(null);

      await expect(service.findOne('c1', 'w1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when the user is neither homeroom teacher nor member', async () => {
      prisma.classroom.findUnique.mockResolvedValueOnce({
        homeroomTeacherId: 'w1',
        members: [],
      });

      await expect(service.findOne('c1', 'u9')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.classroom.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('ClassroomsService.update', () => {
    it('throws ForbiddenException and writes nothing for a non-homeroom teacher', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
      });

      await expect(
        service.update('c1', 'u9', { name: 'XII IPA 3' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.classroom.update).not.toHaveBeenCalled();
    });

    it('writes only the provided fields', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
      });
      prisma.classroom.update.mockResolvedValue(
        classroomRow({ name: 'XII IPA 3' }),
      );

      await service.update('c1', 'w1', { name: 'XII IPA 3' });

      expect(prisma.classroom.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { name: 'XII IPA 3' },
        select: classroomSelect,
      });
    });

    it('allows lowering maxStudents below the current active count (BR-4)', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
      });
      prisma.classroom.update.mockResolvedValue(
        classroomRow({ maxStudents: 5 }),
      );

      await service.update('c1', 'w1', { maxStudents: 5 });

      expect(prisma.classroom.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { maxStudents: 5 },
        select: classroomSelect,
      });
    });

    it('clears schoolName when null is sent', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
      });
      prisma.classroom.update.mockResolvedValue(classroomRow());

      await service.update('c1', 'w1', { schoolName: null });

      expect(prisma.classroom.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { schoolName: null },
        select: classroomSelect,
      });
    });

    it('throws NotFoundException and writes nothing when the classroom is gone', async () => {
      prisma.classroom.findUnique.mockResolvedValue(null);

      await expect(
        service.update('c1', 'w1', { name: 'XII IPA 3' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.classroom.update).not.toHaveBeenCalled();
    });
  });

  describe('ClassroomsService.regenerateCode', () => {
    it('throws ForbiddenException for a non-homeroom teacher', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
      });

      await expect(service.regenerateCode('c1', 'u9')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.classroom.update).not.toHaveBeenCalled();
    });

    it('changes the code and retries on a collision', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
      });
      prisma.classroom.update
        .mockRejectedValueOnce(codeConflict())
        .mockImplementationOnce((args: { data: { code: string } }) =>
          Promise.resolve({ code: args.data.code }),
        );

      const result = await service.regenerateCode('c1', 'w1');

      expect(prisma.classroom.update).toHaveBeenCalledTimes(2);
      expect(result.code).toMatch(CLASS_CODE_PATTERN);
    });
  });
});
