import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CashType,
  ClassRole,
  PaymentStatus,
  Prisma,
} from '../../generated/prisma/client';
import { paginate } from '../common/helpers/paginate.helper';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCashDueDto } from './dto/create-due.dto';
import { QueryCashDueDto } from './dto/query-due.dto';

const CLASS_NOT_FOUND = 'Classroom not found';
const DUE_NOT_FOUND = 'Cash due not found';
const MEMBER_NOT_FOUND = 'Class member not found';
const WRITE_FORBIDDEN = 'Only the class treasurer can manage class dues';
const VIEW_FORBIDDEN = 'You are not allowed to view this class';
const SELF_ONLY = 'You can only view your own dues';
const DUE_IN_USE = 'Cash due is already in use';
const ALREADY_PAID = 'Cash due payment is already paid';
const ALREADY_UNPAID = 'Cash due payment is not marked as paid';
const REVERTED_REASON = 'payment reverted';

const JAKARTA_TIME_ZONE = 'Asia/Jakarta';

export const cashDueSelect = {
  id: true,
  classId: true,
  title: true,
  amount: true,
  dueDate: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.CashDueSelect;

export const cashDuePaymentSelect = {
  id: true,
  dueId: true,
  memberId: true,
  status: true,
  paidAt: true,
  recordedById: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CashDuePaymentSelect;

/** Detail view: each payment carries its member so no extra query is needed. */
export const cashDuePaymentDetailSelect = {
  ...cashDuePaymentSelect,
  member: {
    select: {
      id: true,
      userId: true,
      role: true,
      isActive: true,
      user: { select: { id: true, name: true, avatarUrl: true } },
    },
  },
} satisfies Prisma.CashDuePaymentSelect;

export interface DuePaymentEntry {
  id: string | null;
  memberId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  classRole: ClassRole;
  status: PaymentStatus;
  paidAt: Date | null;
  recordedById: string | null;
}

/** Active-member descriptor used both for snapshots and computed late joiners. */
interface ActiveMember {
  id: string;
  userId: string;
  role: ClassRole;
  user: { id: string; name: string; avatarUrl: string | null };
}

/** Today's calendar date (YYYY-MM-DD) in Asia/Jakarta, regardless of server TZ. */
function jakartaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: JAKARTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** `@db.Date` columns store a calendar date, so midnight UTC is unambiguous. */
function parseDateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/**
 * A member with no snapshot row (joined after the due) is computed UNPAID, so
 * nobody silently escapes a due (PRD F-CASH-2).
 */
function toPaymentEntry(
  member: ActiveMember,
  payment?: {
    id: string;
    status: PaymentStatus;
    paidAt: Date | null;
    recordedById: string | null;
  },
): DuePaymentEntry {
  return {
    id: payment?.id ?? null,
    memberId: member.id,
    userId: member.userId,
    name: member.user.name,
    avatarUrl: member.user.avatarUrl,
    classRole: member.role,
    status: payment?.status ?? PaymentStatus.UNPAID,
    paidAt: payment?.paidAt ?? null,
    recordedById: payment?.recordedById ?? null,
  };
}

@Injectable()
export class CashDuesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * F-CASH-2: creates the due and snapshots one UNPAID row per currently-active
   * member in one transaction, so a due never exists without its payers.
   */
  async create(classId: string, userId: string, dto: CreateCashDueDto) {
    await this.assertBendahara(classId, userId);

    const dueDate = dto.dueDate ? parseDateOnly(dto.dueDate) : null;
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.cashDue.create({
        data: {
          classId,
          title: dto.title,
          amount: dto.amount,
          dueDate,
          createdById: userId,
        },
        select: cashDueSelect,
      });

      const members = await tx.classMember.findMany({
        where: { classId, isActive: true },
        select: { id: true },
      });
      if (members.length > 0) {
        await tx.cashDuePayment.createMany({
          data: members.map((member) => ({
            dueId: due.id,
            memberId: member.id,
            status: PaymentStatus.UNPAID,
          })),
        });
      }
      return { ...due, memberCount: members.length };
    });
  }

  /** F-CASH-2: newest due first, each with its paid/unpaid snapshot counts. */
  async findAll(classId: string, userId: string, query: QueryCashDueDto) {
    await this.assertClassAccess(classId, userId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [dues, total] = await this.prisma.$transaction([
      this.prisma.cashDue.findMany({
        where: { classId },
        select: cashDueSelect,
        skip: query.skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.cashDue.count({ where: { classId } }),
    ]);

    const paid = new Map<string, number>();
    const unpaid = new Map<string, number>();
    if (dues.length > 0) {
      const counts = await this.prisma.cashDuePayment.groupBy({
        by: ['dueId', 'status'],
        where: { dueId: { in: dues.map((due) => due.id) } },
        _count: { _all: true },
      });
      for (const row of counts) {
        const target = row.status === PaymentStatus.PAID ? paid : unpaid;
        target.set(row.dueId, row._count._all);
      }
    }

    const data = dues.map((due) => ({
      ...due,
      paidCount: paid.get(due.id) ?? 0,
      unpaidCount: unpaid.get(due.id) ?? 0,
    }));
    return paginate(data, total, page, limit);
  }

  /** F-CASH-2: per-member payments; late joiners appear as computed UNPAID. */
  async findOne(classId: string, dueId: string, userId: string) {
    await this.assertClassAccess(classId, userId);

    const due = await this.prisma.cashDue.findFirst({
      where: { id: dueId, classId },
      select: cashDueSelect,
    });
    if (!due) throw new NotFoundException(DUE_NOT_FOUND);

    const [payments, members] = await this.prisma.$transaction([
      this.prisma.cashDuePayment.findMany({
        where: { dueId },
        select: cashDuePaymentDetailSelect,
      }),
      this.prisma.classMember.findMany({
        where: { classId, isActive: true },
        select: {
          id: true,
          userId: true,
          role: true,
          user: { select: { id: true, name: true, avatarUrl: true } },
        },
      }),
    ]);

    const byMember = new Map(
      payments.map((payment) => [payment.memberId, payment]),
    );
    const activeIds = new Set(members.map((member) => member.id));
    const entries: DuePaymentEntry[] = members.map((member) =>
      toPaymentEntry(member, byMember.get(member.id)),
    );
    // Kicked members keep their historical payment rows in the audit view.
    for (const payment of payments) {
      if (!activeIds.has(payment.memberId)) {
        entries.push(
          toPaymentEntry(
            {
              id: payment.member.id,
              userId: payment.member.userId,
              role: payment.member.role,
              user: payment.member.user,
            },
            payment,
          ),
        );
      }
    }

    return {
      ...due,
      paidCount: entries.filter((e) => e.status === PaymentStatus.PAID).length,
      unpaidCount: entries.filter((e) => e.status === PaymentStatus.UNPAID)
        .length,
      payments: entries,
    };
  }

  /** F-CASH-2: only before a payment exists (a paid due keeps the ledger). */
  async remove(classId: string, dueId: string, userId: string): Promise<void> {
    await this.assertBendahara(classId, userId);

    await this.prisma.$transaction(async (tx) => {
      const due = await tx.cashDue.findFirst({
        where: { id: dueId, classId },
        select: { id: true },
      });
      if (!due) throw new NotFoundException(DUE_NOT_FOUND);

      const paidCount = await tx.cashDuePayment.count({
        where: { dueId, status: PaymentStatus.PAID },
      });
      if (paidCount > 0) throw new ConflictException(DUE_IN_USE);

      await tx.cashDue.delete({ where: { id: dueId } });
    });
  }

  /**
   * BR-15: marking a payment PAID and its linked INCOME entry happen in one
   * transaction, so a PAID row can never exist without a ledger entry.
   */
  async pay(classId: string, dueId: string, memberId: string, userId: string) {
    await this.assertBendahara(classId, userId);

    return this.prisma.$transaction(async (tx) => {
      const due = await tx.cashDue.findFirst({
        where: { id: dueId, classId },
        select: { id: true, title: true, amount: true },
      });
      if (!due) throw new NotFoundException(DUE_NOT_FOUND);

      const member = await tx.classMember.findFirst({
        where: { id: memberId, classId },
        select: { id: true },
      });
      if (!member) throw new NotFoundException(MEMBER_NOT_FOUND);

      const existing = await tx.cashDuePayment.findUnique({
        where: { dueId_memberId: { dueId, memberId } },
        select: { id: true, status: true },
      });
      if (existing?.status === PaymentStatus.PAID) {
        throw new ConflictException(ALREADY_PAID);
      }

      const now = new Date();
      const data = {
        status: PaymentStatus.PAID,
        paidAt: now,
        recordedById: userId,
      };
      const payment = existing
        ? await tx.cashDuePayment.update({
            where: { id: existing.id },
            data,
            select: cashDuePaymentSelect,
          })
        : await tx.cashDuePayment.create({
            data: { dueId, memberId, ...data },
            select: cashDuePaymentSelect,
          });

      await tx.cashTransaction.create({
        data: {
          classId,
          type: CashType.INCOME,
          amount: due.amount,
          description: `Due payment: ${due.title}`,
          date: parseDateOnly(jakartaToday()),
          recordedById: userId,
          duePaymentId: payment.id,
        },
        select: { id: true },
      });
      return payment;
    });
  }

  /** BR-15: reverting clears the payment and voids its ledger entry, atomically. */
  async unpay(
    classId: string,
    dueId: string,
    memberId: string,
    userId: string,
  ) {
    await this.assertBendahara(classId, userId);

    return this.prisma.$transaction(async (tx) => {
      const due = await tx.cashDue.findFirst({
        where: { id: dueId, classId },
        select: { id: true },
      });
      if (!due) throw new NotFoundException(DUE_NOT_FOUND);

      const payment = await tx.cashDuePayment.findUnique({
        where: { dueId_memberId: { dueId, memberId } },
        select: { id: true, status: true },
      });
      if (!payment || payment.status === PaymentStatus.UNPAID) {
        throw new ConflictException(ALREADY_UNPAID);
      }

      const updated = await tx.cashDuePayment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.UNPAID,
          paidAt: null,
          recordedById: null,
        },
        select: cashDuePaymentSelect,
      });

      const linked = await tx.cashTransaction.findUnique({
        where: { duePaymentId: payment.id },
        select: { id: true, voidedAt: true },
      });
      if (linked && !linked.voidedAt) {
        await tx.cashTransaction.update({
          where: { id: linked.id },
          data: { voidedAt: new Date(), voidReason: REVERTED_REASON },
          select: { id: true },
        });
      }
      return updated;
    });
  }

  /** F-CASH-2: one member's dues and total outstanding. */
  async memberDetail(classId: string, memberId: string, userId: string) {
    const access = await this.assertClassAccess(classId, userId);

    const member = await this.loadMember(classId, memberId);
    if (!member) throw new NotFoundException(MEMBER_NOT_FOUND);

    const isHomeroom = access.homeroomTeacherId === userId;
    const isOfficer =
      access.membership?.role === ClassRole.KETUA ||
      access.membership?.role === ClassRole.BENDAHARA;
    const isSelf = access.membership?.id === memberId;
    if (!isHomeroom && !isOfficer && !isSelf) {
      throw new ForbiddenException(SELF_ONLY);
    }

    const [dues, payments] = await this.prisma.$transaction([
      this.prisma.cashDue.findMany({
        where: { classId },
        select: {
          id: true,
          title: true,
          amount: true,
          dueDate: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.cashDuePayment.findMany({
        where: { memberId, due: { classId } },
        select: { dueId: true, status: true, paidAt: true },
      }),
    ]);

    const byDue = new Map(payments.map((payment) => [payment.dueId, payment]));
    const entries = dues.map((due) => {
      const payment = byDue.get(due.id);
      return {
        dueId: due.id,
        title: due.title,
        amount: due.amount,
        dueDate: due.dueDate,
        createdAt: due.createdAt,
        status: payment?.status ?? PaymentStatus.UNPAID,
        paidAt: payment?.paidAt ?? null,
      };
    });
    const outstanding = entries
      .filter((entry) => entry.status === PaymentStatus.UNPAID)
      .reduce((sum, entry) => sum + entry.amount, 0);

    return {
      member: {
        id: member.id,
        userId: member.userId,
        name: member.user.name,
        avatarUrl: member.user.avatarUrl,
        classRole: member.role,
        isActive: member.isActive,
      },
      dues: entries,
      outstanding,
    };
  }

  private async loadMember(
    classId: string,
    memberId: string,
  ): Promise<(ActiveMember & { isActive: boolean }) | null> {
    return this.prisma.classMember.findFirst({
      where: { id: memberId, classId },
      select: {
        id: true,
        userId: true,
        role: true,
        isActive: true,
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
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
  ): Promise<{
    homeroomTeacherId: string;
    membership: { id: string; role: ClassRole } | null;
  }> {
    const classroom = await this.prisma.classroom.findUnique({
      where: { id: classId },
      select: {
        homeroomTeacherId: true,
        members: {
          where: { userId, isActive: true },
          select: { id: true, role: true },
          take: 1,
        },
      },
    });
    if (!classroom) throw new NotFoundException(CLASS_NOT_FOUND);
    const membership = classroom.members[0] ?? null;
    if (classroom.homeroomTeacherId !== userId && !membership) {
      throw new ForbiddenException(VIEW_FORBIDDEN);
    }
    return { homeroomTeacherId: classroom.homeroomTeacherId, membership };
  }
}
