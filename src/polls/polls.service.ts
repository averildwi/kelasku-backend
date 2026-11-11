import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClassRole, Prisma } from '../../generated/prisma/client';
import { paginate } from '../common/helpers/paginate.helper';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePollDto } from './dto/create-poll.dto';
import { QueryPollDto } from './dto/query-poll.dto';
import { VoteDto } from './dto/vote.dto';

const CLASS_NOT_FOUND = 'Classroom not found';
const POLL_NOT_FOUND = 'Poll not found';
const MANAGE_FORBIDDEN =
  'Only the homeroom teacher or the class president can create a poll';
const POLL_CLOSED = 'Poll is closed';
const ALREADY_CLOSED = 'Poll is already closed';
const VOTER_FORBIDDEN = 'The homeroom teacher cannot vote';
const NOT_ALLOWED = 'You are not allowed to view this class';
const INVALID_DEADLINE = 'deadline must be in the future';
const INVALID_OPTION = 'Every option must belong to this poll';
const INVALID_OPTION_COUNT =
  'A single-choice poll takes one option; a multiple-choice poll takes 2 to 10';
const NOT_VOTED = 'You have not voted on this poll';
const CLOSE_FORBIDDEN =
  'Only the creator or the homeroom teacher can close this poll';
const DELETE_FORBIDDEN =
  'Only the creator or the homeroom teacher can delete this poll';

/** List shape: counts are derived, so the client can show a badge without detail. */
export const pollSummarySelect = {
  id: true,
  classId: true,
  creatorId: true,
  question: true,
  deadline: true,
  allowMultiple: true,
  isAnonymous: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { id: true, name: true, avatarUrl: true } },
  _count: { select: { options: true, votes: true } },
} satisfies Prisma.PollSelect;

/** Detail shape: options with their counts and (unless anonymous) the voters. */
export const pollResultsSelect = {
  id: true,
  classId: true,
  creatorId: true,
  question: true,
  deadline: true,
  allowMultiple: true,
  isAnonymous: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { id: true, name: true, avatarUrl: true } },
  options: {
    select: {
      id: true,
      label: true,
      position: true,
      _count: { select: { votes: true } },
    },
    orderBy: { position: 'asc' },
  },
  votes: {
    select: {
      optionId: true,
      userId: true,
      user: { select: { id: true, name: true, avatarUrl: true } },
    },
  },
} satisfies Prisma.PollSelect;

type PollSummaryRow = Prisma.PollGetPayload<{
  select: typeof pollSummarySelect;
}>;
type PollResultsRow = Prisma.PollGetPayload<{
  select: typeof pollResultsSelect;
}>;

/** A poll is closed once closedAt is set or the deadline has passed (BR-14). */
function isPollOpen(
  poll: { closedAt: Date | null; deadline: Date | null },
  now: Date = new Date(),
): boolean {
  if (poll.closedAt) return false;
  return poll.deadline === null || poll.deadline.getTime() > now.getTime();
}

function toPollSummary(row: PollSummaryRow) {
  const { _count, ...rest } = row;
  return {
    ...rest,
    status: isPollOpen(row) ? 'open' : 'closed',
    optionCount: _count.options,
    totalVotes: _count.votes,
  };
}

function toPollResults(row: PollResultsRow, viewerId: string) {
  const votersByOption = new Map<
    string,
    { userId: string; name: string; avatarUrl: string | null }[]
  >();
  // An anonymous poll never exposes who picked what, not even to the creator.
  if (!row.isAnonymous) {
    for (const vote of row.votes) {
      const list = votersByOption.get(vote.optionId) ?? [];
      list.push({
        userId: vote.user.id,
        name: vote.user.name,
        avatarUrl: vote.user.avatarUrl,
      });
      votersByOption.set(vote.optionId, list);
    }
  }

  const totalVotes = row.votes.length;
  return {
    id: row.id,
    classId: row.classId,
    creatorId: row.creatorId,
    question: row.question,
    deadline: row.deadline,
    allowMultiple: row.allowMultiple,
    isAnonymous: row.isAnonymous,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    creator: row.creator,
    status: isPollOpen(row) ? 'open' : 'closed',
    totalVotes,
    myVoteOptionIds: row.votes
      .filter((vote) => vote.userId === viewerId)
      .map((vote) => vote.optionId),
    options: row.options.map((option) => {
      const voteCount = option._count.votes;
      return {
        id: option.id,
        label: option.label,
        position: option.position,
        voteCount,
        percentage:
          totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0,
        ...(row.isAnonymous
          ? {}
          : { voters: votersByOption.get(option.id) ?? [] }),
      };
    }),
  };
}

@Injectable()
export class PollsService {
  constructor(private readonly prisma: PrismaService) {}

  /** F-POLL-1: the homeroom teacher or an active KETUA creates a poll. */
  async create(classId: string, userId: string, dto: CreatePollDto) {
    await this.assertCanManage(classId, userId);

    let deadline: Date | null = null;
    if (dto.deadline !== undefined) {
      const parsed = Date.parse(dto.deadline);
      if (!Number.isFinite(parsed) || parsed <= Date.now()) {
        throw new BadRequestException(INVALID_DEADLINE);
      }
      deadline = new Date(parsed);
    }

    const poll = await this.prisma.poll.create({
      data: {
        classId,
        creatorId: userId,
        question: dto.question,
        deadline,
        allowMultiple: dto.allowMultiple ?? false,
        isAnonymous: dto.isAnonymous ?? false,
        options: {
          create: dto.options.map((label, index) => ({
            label,
            position: index,
          })),
        },
      },
      select: pollResultsSelect,
    });
    return toPollResults(poll, userId);
  }

  /** F-POLL-1: newest first, optionally filtered by open/closed status. */
  async findAll(classId: string, userId: string, query: QueryPollDto) {
    await this.assertClassAccess(classId, userId);

    const now = new Date();
    const base: Prisma.PollWhereInput = { classId, deletedAt: null };
    const where: Prisma.PollWhereInput =
      query.status === 'open'
        ? {
            ...base,
            AND: [
              { closedAt: null },
              { OR: [{ deadline: null }, { deadline: { gt: now } }] },
            ],
          }
        : query.status === 'closed'
          ? {
              ...base,
              OR: [{ closedAt: { not: null } }, { deadline: { lte: now } }],
            }
          : base;

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.poll.findMany({
        where,
        select: pollSummarySelect,
        skip: query.skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.poll.count({ where }),
    ]);
    return paginate(rows.map(toPollSummary), total, page, limit);
  }

  /** F-POLL-1: detail with results; voter lists hidden when anonymous. */
  async findOne(classId: string, pollId: string, userId: string) {
    await this.assertClassAccess(classId, userId);
    const poll = await this.loadPoll(classId, pollId);
    return toPollResults(poll, userId);
  }

  /**
   * F-POLL-1/BR-14: a vote replaces the caller's previous vote. Delete + create
   * run in one transaction so a re-vote never leaves a half-applied state.
   */
  async vote(classId: string, pollId: string, userId: string, dto: VoteDto) {
    await this.assertVoterAccess(classId, userId);
    const poll = await this.prisma.poll.findFirst({
      where: { id: pollId, classId, deletedAt: null },
      select: {
        id: true,
        allowMultiple: true,
        closedAt: true,
        deadline: true,
        options: { select: { id: true } },
      },
    });
    if (!poll) throw new NotFoundException(POLL_NOT_FOUND);
    if (!isPollOpen(poll)) throw new ForbiddenException(POLL_CLOSED);

    const optionIds = [...new Set(dto.optionIds)];
    this.assertVoteShape(optionIds, poll.allowMultiple);
    const validIds = new Set(poll.options.map((option) => option.id));
    if (optionIds.some((optionId) => !validIds.has(optionId))) {
      throw new BadRequestException(INVALID_OPTION);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.pollVote.deleteMany({ where: { pollId, userId } });
      await tx.pollVote.createMany({
        data: optionIds.map((optionId) => ({ pollId, optionId, userId })),
      });
    });

    const updated = await this.loadPoll(classId, pollId);
    return toPollResults(updated, userId);
  }

  /** F-POLL-1: withdraw the caller's vote while the poll is open. */
  async withdrawVote(classId: string, pollId: string, userId: string) {
    await this.assertVoterAccess(classId, userId);
    const poll = await this.prisma.poll.findFirst({
      where: { id: pollId, classId, deletedAt: null },
      select: { id: true, closedAt: true, deadline: true },
    });
    if (!poll) throw new NotFoundException(POLL_NOT_FOUND);
    if (!isPollOpen(poll)) throw new ForbiddenException(POLL_CLOSED);

    const removed = await this.prisma.pollVote.deleteMany({
      where: { pollId, userId },
    });
    if (removed.count === 0) throw new ConflictException(NOT_VOTED);

    const updated = await this.loadPoll(classId, pollId);
    return toPollResults(updated, userId);
  }

  /** F-POLL-1: the creator or the homeroom teacher closes an open poll. */
  async close(classId: string, pollId: string, userId: string) {
    const poll = await this.prisma.poll.findFirst({
      where: { id: pollId, classId, deletedAt: null },
      select: {
        id: true,
        creatorId: true,
        closedAt: true,
        deadline: true,
        classroom: { select: { homeroomTeacherId: true } },
      },
    });
    if (!poll) throw new NotFoundException(POLL_NOT_FOUND);
    this.assertOwnerOrHomeroom(poll, userId, CLOSE_FORBIDDEN);
    if (!isPollOpen(poll)) throw new ConflictException(ALREADY_CLOSED);

    await this.prisma.poll.update({
      where: { id: poll.id },
      data: { closedAt: new Date() },
      select: { id: true },
    });

    const updated = await this.loadPoll(classId, pollId);
    return toPollResults(updated, userId);
  }

  /** F-POLL-1: soft delete; the creator or the homeroom teacher only. */
  async remove(classId: string, pollId: string, userId: string): Promise<void> {
    const poll = await this.prisma.poll.findFirst({
      where: { id: pollId, classId, deletedAt: null },
      select: {
        id: true,
        creatorId: true,
        classroom: { select: { homeroomTeacherId: true } },
      },
    });
    if (!poll) throw new NotFoundException(POLL_NOT_FOUND);
    this.assertOwnerOrHomeroom(poll, userId, DELETE_FORBIDDEN);

    await this.prisma.poll.update({
      where: { id: poll.id },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
  }

  private async loadPoll(classId: string, pollId: string) {
    const poll = await this.prisma.poll.findFirst({
      where: { id: pollId, classId, deletedAt: null },
      select: pollResultsSelect,
    });
    if (!poll) throw new NotFoundException(POLL_NOT_FOUND);
    return poll;
  }

  /** Single-choice takes exactly one option; multiple-choice takes 2 to 10. */
  private assertVoteShape(optionIds: string[], allowMultiple: boolean): void {
    if (allowMultiple) {
      if (optionIds.length < 2 || optionIds.length > 10) {
        throw new BadRequestException(INVALID_OPTION_COUNT);
      }
      return;
    }
    if (optionIds.length !== 1) {
      throw new BadRequestException(INVALID_OPTION_COUNT);
    }
  }

  private assertOwnerOrHomeroom(
    poll: { creatorId: string; classroom: { homeroomTeacherId: string } },
    userId: string,
    forbiddenMessage: string,
  ): void {
    if (
      poll.creatorId !== userId &&
      poll.classroom.homeroomTeacherId !== userId
    ) {
      throw new ForbiddenException(forbiddenMessage);
    }
  }

  /** The homeroom teacher or an active KETUA may create a poll. */
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
      throw new ForbiddenException(NOT_ALLOWED);
    }
  }

  /**
   * Vote/withdraw: an ACTIVE member only, and never the homeroom teacher
   * (BR-14). Checked in the service too, so the rule survives a missing guard.
   */
  private async assertVoterAccess(
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
    if (classroom.homeroomTeacherId === userId) {
      throw new ForbiddenException(VOTER_FORBIDDEN);
    }
    if (classroom.members.length === 0) {
      throw new ForbiddenException(NOT_ALLOWED);
    }
  }
}
