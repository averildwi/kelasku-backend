import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CashType,
  ClassRole,
  PaymentStatus,
  Prisma,
} from '../../generated/prisma/client';
import { paginate } from '../common/helpers/paginate.helper';
import {
  StorageService,
  UploadedImageFile,
} from '../common/upload/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCashTransactionDto } from './dto/create-cash-transaction.dto';
import { QueryCashTransactionDto } from './dto/query-cash-transaction.dto';
import { VoidCashTransactionDto } from './dto/void-cash-transaction.dto';

const CLASS_NOT_FOUND = 'Classroom not found';
const TRANSACTION_NOT_FOUND = 'Cash transaction not found';
const WRITE_FORBIDDEN = 'Only the class treasurer can manage the cash ledger';
const VIEW_FORBIDDEN = 'You are not allowed to view this class';
const ALREADY_VOIDED = 'Cash transaction is already voided';
const DATE_IN_FUTURE = 'date must not be in the future';

const JAKARTA_TIME_ZONE = 'Asia/Jakarta';

/** BR-15: a transaction is never deleted; a void just stamps these two columns. */
export const cashTransactionSelect = {
  id: true,
  classId: true,
  type: true,
  amount: true,
  description: true,
  date: true,
  proofUrl: true,
  recordedById: true,
  voidedAt: true,
  voidReason: true,
  createdAt: true,
  updatedAt: true,
  recordedBy: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.CashTransactionSelect;

/** One active member's outstanding dues total (late joiners are computed UNPAID). */
export interface OutstandingMember {
  memberId: string;
  userId: string;
  name: string;
  amount: number;
}

export interface CashSummary {
  balance: number;
  totalIncome: number;
  totalExpense: number;
  outstandingTotal: number;
  outstanding: OutstandingMember[];
}

/** BR-15: proof images live under the class folder, like the whiteboard ones. */
export function buildCashProofFolder(classId: string): string {
  return `kelasku/${classId}/cash`;
}

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

@Injectable()
export class CashTransactionsService {
  private readonly logger = new Logger(CashTransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * F-CASH-1/2: balance and totals over non-voided transactions, plus the
   * outstanding per active member. A member with no payment row (joined after
   * the due) is counted as UNPAID, so nobody silently escapes a due.
   */
  async summary(classId: string, userId: string): Promise<CashSummary> {
    await this.assertClassAccess(classId, userId);

    const [income, expense, activeMembers, dues, payments] =
      await this.prisma.$transaction([
        this.prisma.cashTransaction.aggregate({
          where: { classId, type: CashType.INCOME, voidedAt: null },
          _sum: { amount: true },
        }),
        this.prisma.cashTransaction.aggregate({
          where: { classId, type: CashType.EXPENSE, voidedAt: null },
          _sum: { amount: true },
        }),
        this.prisma.classMember.findMany({
          where: { classId, isActive: true },
          select: {
            id: true,
            userId: true,
            user: { select: { name: true } },
          },
        }),
        this.prisma.cashDue.findMany({
          where: { classId },
          select: { id: true, amount: true },
        }),
        this.prisma.cashDuePayment.findMany({
          where: { due: { classId } },
          select: { dueId: true, memberId: true, status: true },
        }),
      ]);

    const totalIncome = income._sum.amount ?? 0;
    const totalExpense = expense._sum.amount ?? 0;

    const paid = new Set(
      payments
        .filter((payment) => payment.status === PaymentStatus.PAID)
        .map((payment) => `${payment.dueId}:${payment.memberId}`),
    );
    const outstanding: OutstandingMember[] = [];
    for (const member of activeMembers) {
      let amount = 0;
      for (const due of dues) {
        if (!paid.has(`${due.id}:${member.id}`)) amount += due.amount;
      }
      if (amount > 0) {
        outstanding.push({
          memberId: member.id,
          userId: member.userId,
          name: member.user.name,
          amount,
        });
      }
    }
    const outstandingTotal = outstanding.reduce(
      (sum, entry) => sum + entry.amount,
      0,
    );

    return {
      balance: totalIncome - totalExpense,
      totalIncome,
      totalExpense,
      outstandingTotal,
      outstanding,
    };
  }

  /** F-CASH-1: the full ledger, newest first, voided rows included. */
  async findAll(
    classId: string,
    userId: string,
    query: QueryCashTransactionDto,
  ) {
    await this.assertClassAccess(classId, userId);

    const dateFilter: Prisma.DateTimeFilter = {};
    if (query.from) dateFilter.gte = parseDateOnly(query.from);
    if (query.to) dateFilter.lte = parseDateOnly(query.to);

    const where: Prisma.CashTransactionWhereInput = {
      classId,
      ...(query.type ? { type: query.type } : {}),
      ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
    };

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.cashTransaction.findMany({
        where,
        select: cashTransactionSelect,
        skip: query.skip,
        take: limit,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.cashTransaction.count({ where }),
    ]);
    return paginate(rows, total, page, limit);
  }

  /** F-CASH-1/BR-15: the treasurer records a movement, optionally with proof. */
  async create(
    classId: string,
    userId: string,
    dto: CreateCashTransactionDto,
    proof?: UploadedImageFile,
  ) {
    await this.assertBendahara(classId, userId);
    if (dto.date > jakartaToday()) {
      throw new BadRequestException(DATE_IN_FUTURE);
    }

    let proofUrl: string | null = null;
    let proofPublicId: string | null = null;
    if (proof) {
      const stored = await this.storage.uploadImage(
        proof,
        buildCashProofFolder(classId),
      );
      proofUrl = stored.url;
      proofPublicId = stored.publicId;
    }

    try {
      return await this.prisma.cashTransaction.create({
        data: {
          classId,
          type: dto.type,
          amount: dto.amount,
          description: dto.description,
          date: parseDateOnly(dto.date),
          proofUrl,
          recordedById: userId,
        },
        select: cashTransactionSelect,
      });
    } catch (error) {
      // No orphaned asset: the upload already happened before the DB write.
      if (proofPublicId) await this.removeProof(proofPublicId);
      throw error;
    }
  }

  /** BR-15: void keeps the row and stores when and why (never a delete). */
  async void(
    classId: string,
    transactionId: string,
    userId: string,
    dto: VoidCashTransactionDto,
  ) {
    await this.assertBendahara(classId, userId);

    const transaction = await this.prisma.cashTransaction.findFirst({
      where: { id: transactionId, classId },
      select: { id: true, voidedAt: true },
    });
    if (!transaction) throw new NotFoundException(TRANSACTION_NOT_FOUND);
    if (transaction.voidedAt) throw new ConflictException(ALREADY_VOIDED);

    return this.prisma.cashTransaction.update({
      where: { id: transaction.id },
      data: { voidedAt: new Date(), voidReason: dto.reason },
      select: cashTransactionSelect,
    });
  }

  /** Best-effort: a failed cleanup is logged, never masking the original error. */
  private async removeProof(publicId: string): Promise<void> {
    try {
      await this.storage.deleteImage(publicId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Cash proof cleanup failed: ${reason}`);
    }
  }

  /** Writes: the homeroom teacher is read-only, so only BENDAHARA passes. */
  private async assertBendahara(
    classId: string,
    userId: string,
  ): Promise<void> {
    const classroom = await this.prisma.classroom.findUnique({
      where: { id: classId },
      select: {
        members: {
          where: { userId, isActive: true },
          select: { role: true },
          take: 1,
        },
      },
    });
    if (!classroom) throw new NotFoundException(CLASS_NOT_FOUND);
    if (classroom.members[0]?.role !== ClassRole.BENDAHARA) {
      throw new ForbiddenException(WRITE_FORBIDDEN);
    }
  }

  /** Reads: the homeroom teacher or an ACTIVE member only. */
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
      throw new ForbiddenException(VIEW_FORBIDDEN);
    }
  }
}
