import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { QueryMemberDto } from './dto/query-member.dto';
import { memberSelect, MembersService } from './members.service';

type Mock = jest.Mock;

function classroomRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'XII IPA 2',
    isLocked: false,
    maxStudents: null,
    homeroomTeacherId: 'w1',
    ...overrides,
  };
}

function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    userId: 'u2',
    role: 'MEMBER',
    status: 'ACTIVE',
    joinedAt: new Date('2026-01-01T00:00:00.000Z'),
    leftAt: null,
    kickReason: null,
    user: { id: 'u2', name: 'Budi', avatarUrl: null },
    ...overrides,
  };
}

describe('MembersService', () => {
  let service: MembersService;
  let db: {
    classroom: { findUnique: Mock };
    classMember: {
      findFirst: Mock;
      findUnique: Mock;
      findMany: Mock;
      count: Mock;
      create: Mock;
      update: Mock;
      updateMany: Mock;
    };
    picketMember: { deleteMany: Mock };
    $queryRaw: Mock;
  };
  let prisma: { $transaction: Mock } & typeof db;

  beforeEach(async () => {
    db = {
      classroom: { findUnique: jest.fn() },
      classMember: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      picketMember: { deleteMany: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    prisma = {
      ...db,
      // Interactive transactions run the callback with the same mock client;
      // array transactions (list + count) resolve the batched reads.
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (client: typeof db) => Promise<unknown>)(db)
          : Promise.all(arg as Promise<unknown>[]),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [MembersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(MembersService);
  });

  describe('MembersService.join', () => {
    it('creates an ACTIVE MEMBER row and returns classId, name and classRole', async () => {
      db.classroom.findUnique.mockResolvedValue(classroomRow());
      db.classMember.findFirst.mockResolvedValue(null);
      db.classMember.findUnique.mockResolvedValue(null);
      db.classMember.create.mockResolvedValue(memberRow());

      const result = await service.join({ code: 'ABCD23' }, 'u2');

      expect(db.classMember.create).toHaveBeenCalledWith({
        data: { classId: 'c1', userId: 'u2', role: 'MEMBER' },
        select: memberSelect,
      });
      expect(result).toEqual({
        classId: 'c1',
        name: 'XII IPA 2',
        classRole: 'MEMBER',
      });
    });

    it('locks the classroom row and the student before writing (BR-12)', async () => {
      db.classroom.findUnique.mockResolvedValue(classroomRow());
      db.classMember.findFirst.mockResolvedValue(null);
      db.classMember.findUnique.mockResolvedValue(null);
      db.classMember.create.mockResolvedValue(memberRow());

      await service.join({ code: 'ABCD23' }, 'u2');

      expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('throws NotFoundException for an unknown code (BR-3)', async () => {
      db.classroom.findUnique.mockResolvedValue(null);

      await expect(
        service.join({ code: 'ZZZZZZ' }, 'u2'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(db.classMember.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the student already has an active membership (BR-2)', async () => {
      db.classroom.findUnique.mockResolvedValue(classroomRow());
      db.classMember.findFirst.mockResolvedValue({ id: 'm9' });

      await expect(
        service.join({ code: 'ABCD23' }, 'u2'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(db.classMember.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the class is locked (BR-3)', async () => {
      db.classroom.findUnique.mockResolvedValue(
        classroomRow({ isLocked: true }),
      );
      db.classMember.findFirst.mockResolvedValue(null);

      await expect(
        service.join({ code: 'ABCD23' }, 'u2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.classMember.create).not.toHaveBeenCalled();
    });

    it('counts ACTIVE members only and rejects when the class is full (BR-4)', async () => {
      db.classroom.findUnique.mockResolvedValue(
        classroomRow({ maxStudents: 1 }),
      );
      db.classMember.findFirst.mockResolvedValue(null);
      db.classMember.count.mockResolvedValue(1);

      await expect(
        service.join({ code: 'ABCD23' }, 'u2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.classMember.count).toHaveBeenCalledWith({
        where: { classId: 'c1', isActive: true },
      });
      expect(db.classMember.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException with the kicked-before message (BR-3)', async () => {
      db.classroom.findUnique.mockResolvedValue(classroomRow());
      db.classMember.findFirst.mockResolvedValue(null);
      db.classMember.findUnique.mockResolvedValue({
        id: 'm7',
        status: 'KICKED',
      });

      const error = await service
        .join({ code: 'ABCD23' }, 'u2')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as Error).message).toContain('restore');
      expect(db.classMember.create).not.toHaveBeenCalled();
    });

    it('reactivates a LEFT row instead of creating a new one (F-CLASS-6)', async () => {
      db.classroom.findUnique.mockResolvedValue(classroomRow());
      db.classMember.findFirst.mockResolvedValue(null);
      db.classMember.findUnique.mockResolvedValue({ id: 'm5', status: 'LEFT' });
      db.classMember.update.mockResolvedValue(memberRow({ id: 'm5' }));

      const result = await service.join({ code: 'ABCD23' }, 'u2');

      expect(db.classMember.create).not.toHaveBeenCalled();
      const [{ data }] = db.classMember.update.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(data).toMatchObject({
        status: 'ACTIVE',
        isActive: true,
        role: 'MEMBER',
        leftAt: null,
      });
      expect(data.joinedAt).toBeInstanceOf(Date);
      expect(result).toEqual({
        classId: 'c1',
        name: 'XII IPA 2',
        classRole: 'MEMBER',
      });
    });
  });

  describe('MembersService.leave', () => {
    it('marks the row LEFT and reverts the role to MEMBER (BR-8)', async () => {
      db.classMember.findUnique.mockResolvedValue({ id: 'm1', isActive: true });

      await service.leave('c1', 'u2');

      const [{ data }] = db.classMember.update.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(data).toMatchObject({
        role: 'MEMBER',
        status: 'LEFT',
        isActive: false,
      });
      expect(data.leftAt).toBeInstanceOf(Date);
      expect(db.picketMember.deleteMany).toHaveBeenCalledWith({
        where: { memberId: 'm1' },
      });
    });

    it('throws NotFoundException when there is no membership row', async () => {
      db.classMember.findUnique.mockResolvedValue(null);

      await expect(service.leave('c1', 'u9')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(db.classMember.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the membership is not active', async () => {
      db.classMember.findUnique.mockResolvedValue({
        id: 'm1',
        isActive: false,
      });

      await expect(service.leave('c1', 'u2')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(db.classMember.update).not.toHaveBeenCalled();
    });
  });

  describe('MembersService.kick', () => {
    it('keeps the row as KICKED with leftAt, reason and reverted role (BR-7/BR-8)', async () => {
      db.classroom.findUnique.mockResolvedValue(classroomRow());
      db.classMember.findFirst.mockResolvedValue({
        id: 'm1',
        userId: 'u2',
        isActive: true,
      });

      await service.kick('c1', 'm1', 'w1', { reason: 'Disruptive' });

      const [{ data }] = db.classMember.update.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(data).toMatchObject({
        status: 'KICKED',
        isActive: false,
        role: 'MEMBER',
        kickedById: 'w1',
        kickReason: 'Disruptive',
      });
      expect(data.leftAt).toBeInstanceOf(Date);
      expect(db.picketMember.deleteMany).toHaveBeenCalledWith({
        where: { memberId: 'm1' },
      });
    });

    it('throws ForbiddenException for a non-homeroom teacher and writes nothing (BR-5)', async () => {
      db.classroom.findUnique.mockResolvedValue(
        classroomRow({ homeroomTeacherId: 'someone' }),
      );

      await expect(service.kick('c1', 'm1', 'w1', {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(db.classMember.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the member is already inactive', async () => {
      db.classroom.findUnique.mockResolvedValue(classroomRow());
      db.classMember.findFirst.mockResolvedValue({
        id: 'm1',
        userId: 'u2',
        isActive: false,
      });

      await expect(service.kick('c1', 'm1', 'w1', {})).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(db.classMember.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the member is not in this class', async () => {
      db.classroom.findUnique.mockResolvedValue(classroomRow());
      db.classMember.findFirst.mockResolvedValue(null);

      await expect(service.kick('c1', 'm9', 'w1', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('MembersService.restore', () => {
    it('reactivates a KICKED member and clears the kick fields (F-CLASS-6)', async () => {
      db.classroom.findUnique.mockResolvedValue(classroomRow());
      db.classMember.findFirst
        .mockResolvedValueOnce({
          id: 'm1',
          userId: 'u2',
          status: 'KICKED',
          isActive: false,
        })
        .mockResolvedValueOnce(null);
      db.classMember.update.mockResolvedValue(memberRow({ id: 'm1' }));

      const result = await service.restore('c1', 'm1', 'w1');

      const [{ data }] = db.classMember.update.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(data).toMatchObject({
        status: 'ACTIVE',
        isActive: true,
        leftAt: null,
        kickedById: null,
        kickReason: null,
      });
      expect(data.joinedAt).toBeInstanceOf(Date);
      expect(result).toMatchObject({ id: 'm1', classRole: 'MEMBER' });
    });

    it('throws ConflictException for a LEFT member (restore is not re-join)', async () => {
      db.classroom.findUnique.mockResolvedValue(classroomRow());
      db.classMember.findFirst.mockResolvedValue({
        id: 'm1',
        userId: 'u2',
        status: 'LEFT',
        isActive: false,
      });

      const error = await service
        .restore('c1', 'm1', 'w1')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as Error).message).toContain('re-join via code');
      expect(db.classMember.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the member is already active', async () => {
      db.classroom.findUnique.mockResolvedValue(classroomRow());
      db.classMember.findFirst.mockResolvedValue({
        id: 'm1',
        userId: 'u2',
        status: 'ACTIVE',
        isActive: true,
      });

      await expect(service.restore('c1', 'm1', 'w1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('throws ConflictException when the student already joined another class (BR-2)', async () => {
      db.classroom.findUnique.mockResolvedValue(classroomRow());
      db.classMember.findFirst
        .mockResolvedValueOnce({
          id: 'm1',
          userId: 'u2',
          status: 'KICKED',
          isActive: false,
        })
        .mockResolvedValueOnce({ id: 'm-other' });

      await expect(service.restore('c1', 'm1', 'w1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(db.classMember.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the class is full', async () => {
      db.classroom.findUnique.mockResolvedValue(
        classroomRow({ maxStudents: 1 }),
      );
      db.classMember.findFirst
        .mockResolvedValueOnce({
          id: 'm1',
          userId: 'u2',
          status: 'KICKED',
          isActive: false,
        })
        .mockResolvedValueOnce(null);
      db.classMember.count.mockResolvedValue(1);

      await expect(service.restore('c1', 'm1', 'w1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException for a non-homeroom teacher (BR-5)', async () => {
      db.classroom.findUnique.mockResolvedValue(
        classroomRow({ homeroomTeacherId: 'someone' }),
      );

      await expect(service.restore('c1', 'm1', 'w1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('MembersService.assignRole', () => {
    it('demotes the previous office holder and promotes the new one (BR-1)', async () => {
      db.classroom.findUnique.mockResolvedValue(classroomRow());
      db.classMember.findFirst.mockResolvedValue({
        id: 'm1',
        userId: 'u2',
        isActive: true,
      });
      db.classMember.update.mockResolvedValue(memberRow({ role: 'KETUA' }));

      const result = await service.assignRole('c1', 'm1', 'w1', {
        classRole: 'KETUA',
      });

      expect(db.classMember.updateMany).toHaveBeenCalledWith({
        where: {
          classId: 'c1',
          role: 'KETUA',
          isActive: true,
          NOT: { id: 'm1' },
        },
        data: { role: 'MEMBER' },
      });
      expect(db.classMember.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { role: 'KETUA' },
        select: memberSelect,
      });
      expect(result).toMatchObject({ id: 'm1', classRole: 'KETUA' });
    });

    it('does not demote anyone when assigning MEMBER', async () => {
      db.classroom.findUnique.mockResolvedValue(classroomRow());
      db.classMember.findFirst.mockResolvedValue({
        id: 'm1',
        userId: 'u2',
        isActive: true,
      });
      db.classMember.update.mockResolvedValue(memberRow());

      await service.assignRole('c1', 'm1', 'w1', { classRole: 'MEMBER' });

      expect(db.classMember.updateMany).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for an inactive member (BR-1)', async () => {
      db.classroom.findUnique.mockResolvedValue(classroomRow());
      db.classMember.findFirst.mockResolvedValue({
        id: 'm1',
        userId: 'u2',
        isActive: false,
      });

      await expect(
        service.assignRole('c1', 'm1', 'w1', { classRole: 'KETUA' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.classMember.update).not.toHaveBeenCalled();
      expect(db.classMember.updateMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the member is not in this class', async () => {
      db.classroom.findUnique.mockResolvedValue(classroomRow());
      db.classMember.findFirst.mockResolvedValue(null);

      await expect(
        service.assignRole('c1', 'm9', 'w1', { classRole: 'KETUA' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('MembersService.listMembers', () => {
    it('lists ACTIVE members for the homeroom teacher and maps the response', async () => {
      db.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      db.classMember.findMany.mockResolvedValue([memberRow()]);
      db.classMember.count.mockResolvedValue(1);

      const result = await service.listMembers(
        'c1',
        'w1',
        new QueryMemberDto(),
      );

      expect(db.classMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { classId: 'c1', isActive: true },
          select: memberSelect,
          skip: 0,
          take: 20,
        }),
      );
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
      expect(result.data[0]).toMatchObject({
        id: 'm1',
        name: 'Budi',
        classRole: 'MEMBER',
      });
      expect(result.data[0]).not.toHaveProperty('user');
    });

    it('filters by member name when a search is given', async () => {
      db.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      db.classMember.findMany.mockResolvedValue([]);
      db.classMember.count.mockResolvedValue(0);
      const query = new QueryMemberDto();
      query.search = 'Budi';

      await service.listMembers('c1', 'w1', query);

      expect(db.classMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            classId: 'c1',
            isActive: true,
            user: { name: { contains: 'Budi', mode: 'insensitive' } },
          },
        }),
      );
    });

    it('throws ForbiddenException when the user is neither homeroom teacher nor active member', async () => {
      db.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });

      await expect(
        service.listMembers('c1', 'u9', new QueryMemberDto()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.classMember.findMany).not.toHaveBeenCalled();
    });
  });

  describe('MembersService.listInactive', () => {
    it('lists inactive members for the homeroom teacher', async () => {
      db.classroom.findUnique.mockResolvedValue(classroomRow());
      db.classMember.findMany.mockResolvedValue([
        memberRow({ status: 'KICKED', isActive: false }),
      ]);
      db.classMember.count.mockResolvedValue(1);

      const result = await service.listInactive(
        'c1',
        'w1',
        new QueryMemberDto(),
      );

      expect(db.classMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { classId: 'c1', isActive: false },
        }),
      );
      expect(result.data[0]).toMatchObject({ status: 'KICKED' });
    });

    it('throws ForbiddenException for a non-homeroom teacher', async () => {
      db.classroom.findUnique.mockResolvedValue(
        classroomRow({ homeroomTeacherId: 'someone' }),
      );

      await expect(
        service.listInactive('c1', 'w1', new QueryMemberDto()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.classMember.findMany).not.toHaveBeenCalled();
    });
  });
});
