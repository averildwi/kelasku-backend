import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClassRole } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryPollDto } from './dto/query-poll.dto';
import { PollsService, pollResultsSelect } from './polls.service';

function summaryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    classId: 'c1',
    creatorId: 'w1',
    question: 'Where should the study tour go?',
    deadline: null,
    allowMultiple: false,
    isAnonymous: false,
    closedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    creator: { id: 'w1', name: 'Wali', avatarUrl: null },
    _count: { options: 3, votes: 5 },
    ...overrides,
  };
}

function resultsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    classId: 'c1',
    creatorId: 'w1',
    question: 'Where should the study tour go?',
    deadline: null,
    allowMultiple: false,
    isAnonymous: false,
    closedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    creator: { id: 'w1', name: 'Wali', avatarUrl: null },
    options: [
      { id: 'o1', label: 'Bandung', position: 0, _count: { votes: 1 } },
      { id: 'o2', label: 'Malang', position: 1, _count: { votes: 1 } },
    ],
    votes: [
      {
        optionId: 'o1',
        userId: 'u1',
        user: { id: 'u1', name: 'Ana', avatarUrl: null },
      },
      {
        optionId: 'o2',
        userId: 'u2',
        user: { id: 'u2', name: 'Budi', avatarUrl: null },
      },
    ],
    ...overrides,
  };
}

function pollLite(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    allowMultiple: false,
    closedAt: null,
    deadline: null,
    options: [{ id: 'o1' }, { id: 'o2' }],
    ...overrides,
  };
}

describe('PollsService', () => {
  let service: PollsService;
  let tx: { pollVote: { deleteMany: jest.Mock; createMany: jest.Mock } };
  let prisma: {
    classroom: { findUnique: jest.Mock };
    poll: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    pollVote: { deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };

  function findManyArgs(): {
    where: { classId: string; deletedAt: null; AND?: unknown; OR?: unknown };
  } {
    const call = prisma.poll.findMany.mock.calls[0] as [
      {
        where: {
          classId: string;
          deletedAt: null;
          AND?: unknown;
          OR?: unknown;
        };
      },
    ];
    return call[0];
  }

  beforeEach(async () => {
    tx = { pollVote: { deleteMany: jest.fn(), createMany: jest.fn() } };
    prisma = {
      classroom: { findUnique: jest.fn() },
      poll: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      pollVote: { deleteMany: jest.fn() },
      $transaction: jest.fn(
        (
          arg: ((client: typeof tx) => Promise<unknown>) | Promise<unknown>[],
        ) => (typeof arg === 'function' ? arg(tx) : Promise.all(arg)),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [PollsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(PollsService);
  });

  describe('PollsService.create', () => {
    it('creates a poll with positioned options for the homeroom teacher', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.poll.create.mockResolvedValue(
        resultsRow({
          votes: [],
          options: [
            { id: 'o1', label: 'A', position: 0, _count: { votes: 0 } },
            { id: 'o2', label: 'B', position: 1, _count: { votes: 0 } },
          ],
        }),
      );

      const result = await service.create('c1', 'w1', {
        question: 'Where?',
        options: ['A', 'B'],
      });

      expect(prisma.poll.create).toHaveBeenCalledWith({
        data: {
          classId: 'c1',
          creatorId: 'w1',
          question: 'Where?',
          deadline: null,
          allowMultiple: false,
          isAnonymous: false,
          options: {
            create: [
              { label: 'A', position: 0 },
              { label: 'B', position: 1 },
            ],
          },
        },
        select: pollResultsSelect,
      });
      expect(result.options).toHaveLength(2);
    });

    it('throws BadRequestException for a past deadline and writes nothing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });

      await expect(
        service.create('c1', 'w1', {
          question: 'Where?',
          options: ['A', 'B'],
          deadline: '2020-01-01T00:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.poll.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for an active MEMBER', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ role: ClassRole.MEMBER }],
      });

      await expect(
        service.create('c1', 'u2', { question: 'Where?', options: ['A', 'B'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.poll.create).not.toHaveBeenCalled();
    });
  });

  describe('PollsService.findAll', () => {
    it('filters open polls by closedAt and the deadline', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.poll.findMany.mockResolvedValue([summaryRow()]);
      prisma.poll.count.mockResolvedValue(1);

      const query = new QueryPollDto();
      query.status = 'open';
      const result = await service.findAll('c1', 'w1', query);

      const { where } = findManyArgs();
      expect(where.classId).toBe('c1');
      expect(where.AND).toBeDefined();
      expect(where.OR).toBeUndefined();
      expect(result.data[0]).toMatchObject({
        status: 'open',
        optionCount: 3,
        totalVotes: 5,
      });
    });

    it('filters closed polls by closedAt or a past deadline', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.poll.findMany.mockResolvedValue([]);
      prisma.poll.count.mockResolvedValue(0);

      const query = new QueryPollDto();
      query.status = 'closed';
      await service.findAll('c1', 'w1', query);

      const { where } = findManyArgs();
      expect(where.OR).toBeDefined();
      expect(where.AND).toBeUndefined();
    });
  });

  describe('PollsService.findOne', () => {
    it('hides the voter lists of an anonymous poll', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ id: 'm1' }],
      });
      prisma.poll.findFirst.mockResolvedValue(
        resultsRow({ isAnonymous: true }),
      );

      const result = await service.findOne('c1', 'p1', 'u1');

      expect(result.options[0]).not.toHaveProperty('voters');
      expect(result.myVoteOptionIds).toEqual(['o1']);
    });

    it('includes the voter lists of a named poll', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ id: 'm1' }],
      });
      prisma.poll.findFirst.mockResolvedValue(resultsRow());

      const result = await service.findOne('c1', 'p1', 'u1');

      expect(result.options[0]).toHaveProperty('voters', [
        { userId: 'u1', name: 'Ana', avatarUrl: null },
      ]);
    });
  });

  describe('PollsService.vote', () => {
    it("replaces the voter's previous vote in one transaction", async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ id: 'm1' }],
      });
      prisma.poll.findFirst
        .mockResolvedValueOnce(pollLite())
        .mockResolvedValueOnce(resultsRow());
      tx.pollVote.deleteMany.mockResolvedValue({ count: 1 });
      tx.pollVote.createMany.mockResolvedValue({ count: 1 });

      await service.vote('c1', 'p1', 'u1', { optionIds: ['o1'] });

      expect(tx.pollVote.deleteMany).toHaveBeenCalledWith({
        where: { pollId: 'p1', userId: 'u1' },
      });
      expect(tx.pollVote.createMany).toHaveBeenCalledWith({
        data: [{ pollId: 'p1', optionId: 'o1', userId: 'u1' }],
      });
    });

    it('throws ForbiddenException for the homeroom teacher and reads no poll', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'u1',
        members: [],
      });

      await expect(
        service.vote('c1', 'p1', 'u1', { optionIds: ['o1'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.poll.findFirst).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException on a closed poll and writes nothing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ id: 'm1' }],
      });
      prisma.poll.findFirst.mockResolvedValue(
        pollLite({ closedAt: new Date('2026-01-01T00:00:00.000Z') }),
      );

      await expect(
        service.vote('c1', 'p1', 'u1', { optionIds: ['o1'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when an option is not in the poll', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ id: 'm1' }],
      });
      prisma.poll.findFirst.mockResolvedValue(
        pollLite({ options: [{ id: 'o1' }] }),
      );

      await expect(
        service.vote('c1', 'p1', 'u1', { optionIds: ['o2'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects more than one option on a single-choice poll', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ id: 'm1' }],
      });
      prisma.poll.findFirst.mockResolvedValue(pollLite());

      await expect(
        service.vote('c1', 'p1', 'u1', { optionIds: ['o1', 'o2'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('PollsService.withdrawVote', () => {
    it('throws ConflictException when the caller has not voted', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ id: 'm1' }],
      });
      prisma.poll.findFirst.mockResolvedValue({
        id: 'p1',
        closedAt: null,
        deadline: null,
      });
      prisma.pollVote.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.withdrawVote('c1', 'p1', 'u1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('PollsService.close', () => {
    it('throws ConflictException when the poll is already closed', async () => {
      prisma.poll.findFirst.mockResolvedValue({
        id: 'p1',
        creatorId: 'w1',
        closedAt: new Date('2026-01-01T00:00:00.000Z'),
        deadline: null,
        classroom: { homeroomTeacherId: 'w1' },
      });

      await expect(service.close('c1', 'p1', 'w1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.poll.update).not.toHaveBeenCalled();
    });

    it('sets closedAt for the creator', async () => {
      prisma.poll.findFirst
        .mockResolvedValueOnce({
          id: 'p1',
          creatorId: 'u1',
          closedAt: null,
          deadline: null,
          classroom: { homeroomTeacherId: 'w1' },
        })
        .mockResolvedValueOnce(
          resultsRow({ closedAt: new Date('2026-02-01T00:00:00.000Z') }),
        );
      prisma.poll.update.mockResolvedValue({ id: 'p1' });

      await service.close('c1', 'p1', 'u1');

      const call = prisma.poll.update.mock.calls[0] as [
        { data: { closedAt?: Date } },
      ];
      expect(call[0].data.closedAt).toBeInstanceOf(Date);
    });

    it('throws ForbiddenException for a non-creator non-homeroom caller', async () => {
      prisma.poll.findFirst.mockResolvedValue({
        id: 'p1',
        creatorId: 'u9',
        closedAt: null,
        deadline: null,
        classroom: { homeroomTeacherId: 'w1' },
      });

      await expect(service.close('c1', 'p1', 'u1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.poll.update).not.toHaveBeenCalled();
    });
  });

  describe('PollsService.remove', () => {
    it('soft deletes the poll for the creator', async () => {
      prisma.poll.findFirst.mockResolvedValue({
        id: 'p1',
        creatorId: 'w1',
        classroom: { homeroomTeacherId: 'w2' },
      });
      prisma.poll.update.mockResolvedValue({ id: 'p1' });

      await service.remove('c1', 'p1', 'w1');

      const call = prisma.poll.update.mock.calls[0] as [
        { data: { deletedAt?: Date } },
      ];
      expect(call[0].data.deletedAt).toBeInstanceOf(Date);
    });
  });
});
