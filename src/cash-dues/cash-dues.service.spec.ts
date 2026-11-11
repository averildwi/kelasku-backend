import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CashType,
  ClassRole,
  PaymentStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CashDuesService,
  cashDuePaymentSelect,
  cashDueSelect,
} from './cash-dues.service';
import { QueryCashDueDto } from './dto/query-due.dto';

function dueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    classId: 'c1',
    title: 'Week 1 class fund',
    amount: 20000,
    dueDate: null,
    createdById: 'u2',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdBy: { id: 'u2', name: 'Bendahara', avatarUrl: null },
    ...overrides,
  };
}

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    dueId: 'd1',
    memberId: 'm1',
    status: PaymentStatus.UNPAID,
    paidAt: null,
    recordedById: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    member: {
      id: 'm1',
      userId: 'u1',
      role: ClassRole.MEMBER,
      isActive: true,
      user: { id: 'u1', name: 'Ana', avatarUrl: null },
    },
    ...overrides,
  };
}

const BANKS = 'BENDAHARA';

describe('CashDuesService', () => {
  let service: CashDuesService;
  let prisma: {
    classroom: { findUnique: jest.Mock };
    classMember: { findMany: jest.Mock; findFirst: jest.Mock };
    cashDue: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      delete: jest.Mock;
    };
    cashDuePayment: {
      createMany: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
    };
    cashTransaction: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      classroom: { findUnique: jest.fn() },
      classMember: { findMany: jest.fn(), findFirst: jest.fn() },
      cashDue: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        delete: jest.fn(),
      },
      cashDuePayment: {
        createMany: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      cashTransaction: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      (
        arg: ((client: typeof prisma) => Promise<unknown>) | Promise<unknown>[],
      ) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        CashDuesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(CashDuesService);
  });

  describe('CashDuesService.create', () => {
    it('snapshots an UNPAID row for every active member', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        members: [{ role: BANKS }],
      });
      prisma.cashDue.create.mockResolvedValue(dueRow());
      prisma.classMember.findMany.mockResolvedValue([
        { id: 'm1' },
        { id: 'm2' },
      ]);
      prisma.cashDuePayment.createMany.mockResolvedValue({ count: 2 });

      const result = await service.create('c1', 'u2', {
        title: 'Week 1 class fund',
        amount: 20000,
        dueDate: '2026-11-30',
      });

      expect(prisma.cashDue.create).toHaveBeenCalledWith({
        data: {
          classId: 'c1',
          title: 'Week 1 class fund',
          amount: 20000,
          dueDate: new Date('2026-11-30T00:00:00.000Z'),
          createdById: 'u2',
        },
        select: cashDueSelect,
      });
      expect(prisma.cashDuePayment.createMany).toHaveBeenCalledWith({
        data: [
          { dueId: 'd1', memberId: 'm1', status: PaymentStatus.UNPAID },
          { dueId: 'd1', memberId: 'm2', status: PaymentStatus.UNPAID },
        ],
      });
      expect(result.memberCount).toBe(2);
    });

    it('does not call createMany when the class has no active member', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        members: [{ role: BANKS }],
      });
      prisma.cashDue.create.mockResolvedValue(dueRow());
      prisma.classMember.findMany.mockResolvedValue([]);

      const result = await service.create('c1', 'u2', {
        title: 'Week 1 class fund',
        amount: 20000,
      });

      expect(prisma.cashDuePayment.createMany).not.toHaveBeenCalled();
      expect(result.memberCount).toBe(0);
    });

    it('throws ForbiddenException for an active MEMBER and writes nothing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        members: [{ role: ClassRole.MEMBER }],
      });

      await expect(
        service.create('c1', 'u2', { title: 'Week 1', amount: 20000 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.cashDue.create).not.toHaveBeenCalled();
    });
  });

  describe('CashDuesService.findAll', () => {
    it('attaches paid and unpaid snapshot counts', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.cashDue.findMany.mockResolvedValue([dueRow()]);
      prisma.cashDue.count.mockResolvedValue(1);
      prisma.cashDuePayment.groupBy.mockResolvedValue([
        { dueId: 'd1', status: PaymentStatus.PAID, _count: { _all: 2 } },
        { dueId: 'd1', status: PaymentStatus.UNPAID, _count: { _all: 3 } },
      ]);

      const result = await service.findAll('c1', 'w1', new QueryCashDueDto());

      expect(result.data[0]).toMatchObject({ paidCount: 2, unpaidCount: 3 });
      expect(result.meta.total).toBe(1);
    });
  });

  describe('CashDuesService.findOne', () => {
    it('computes UNPAID for an active member with no snapshot row', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.cashDue.findFirst.mockResolvedValue(dueRow());
      prisma.cashDuePayment.findMany.mockResolvedValue([
        paymentRow({ status: PaymentStatus.PAID }),
      ]);
      prisma.classMember.findMany.mockResolvedValue([
        {
          id: 'm1',
          userId: 'u1',
          role: ClassRole.MEMBER,
          user: { id: 'u1', name: 'Ana', avatarUrl: null },
        },
        {
          id: 'm2',
          userId: 'u3',
          role: ClassRole.MEMBER,
          user: { id: 'u3', name: 'Budi', avatarUrl: null },
        },
      ]);

      const result = await service.findOne('c1', 'd1', 'w1');

      expect(result.payments).toEqual([
        expect.objectContaining({ memberId: 'm1', status: PaymentStatus.PAID }),
        expect.objectContaining({
          memberId: 'm2',
          status: PaymentStatus.UNPAID,
          id: null,
        }),
      ]);
      expect(result.paidCount).toBe(1);
      expect(result.unpaidCount).toBe(1);
    });

    it('throws NotFoundException when the due is not in the class', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.cashDue.findFirst.mockResolvedValue(null);

      await expect(service.findOne('c1', 'd9', 'w1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('CashDuesService.remove', () => {
    it('rejects deleting a due that already has a paid payment', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        members: [{ role: BANKS }],
      });
      prisma.cashDue.findFirst.mockResolvedValue({ id: 'd1' });
      prisma.cashDuePayment.count.mockResolvedValue(1);

      await expect(service.remove('c1', 'd1', 'u2')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.cashDue.delete).not.toHaveBeenCalled();
    });

    it('deletes a due with no paid payment', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        members: [{ role: BANKS }],
      });
      prisma.cashDue.findFirst.mockResolvedValue({ id: 'd1' });
      prisma.cashDuePayment.count.mockResolvedValue(0);
      prisma.cashDue.delete.mockResolvedValue({ id: 'd1' });

      await service.remove('c1', 'd1', 'u2');

      expect(prisma.cashDue.delete).toHaveBeenCalledWith({
        where: { id: 'd1' },
      });
    });
  });

  describe('CashDuesService.pay', () => {
    beforeEach(() => {
      prisma.classroom.findUnique.mockResolvedValue({
        members: [{ role: BANKS }],
      });
      prisma.cashDue.findFirst.mockResolvedValue({
        id: 'd1',
        title: 'Week 1 class fund',
        amount: 20000,
      });
      prisma.classMember.findFirst.mockResolvedValue({ id: 'm1' });
    });

    it('marks the payment paid and creates one linked INCOME entry', async () => {
      prisma.cashDuePayment.findUnique.mockResolvedValue({
        id: 'p1',
        status: PaymentStatus.UNPAID,
      });
      prisma.cashDuePayment.update.mockResolvedValue(
        paymentRow({ status: PaymentStatus.PAID }),
      );
      prisma.cashTransaction.create.mockResolvedValue({ id: 't1' });

      await service.pay('c1', 'd1', 'm1', 'u2');

      const updateCall = prisma.cashDuePayment.update.mock.calls[0] as [
        {
          where: { id: string };
          data: {
            status: PaymentStatus;
            paidAt?: Date;
            recordedById?: string;
          };
        },
      ];
      expect(updateCall[0].where).toEqual({ id: 'p1' });
      expect(updateCall[0].data.status).toBe(PaymentStatus.PAID);
      expect(updateCall[0].data.paidAt).toBeInstanceOf(Date);
      expect(updateCall[0].data.recordedById).toBe('u2');

      const txCall = prisma.cashTransaction.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(txCall[0].data).toMatchObject({
        classId: 'c1',
        type: CashType.INCOME,
        amount: 20000,
        description: 'Due payment: Week 1 class fund',
        recordedById: 'u2',
        duePaymentId: 'p1',
      });
    });

    it('creates a payment row for a late joiner with no snapshot row', async () => {
      prisma.cashDuePayment.findUnique.mockResolvedValue(null);
      prisma.cashDuePayment.create.mockResolvedValue(
        paymentRow({ status: PaymentStatus.PAID }),
      );
      prisma.cashTransaction.create.mockResolvedValue({ id: 't1' });

      await service.pay('c1', 'd1', 'm1', 'u2');

      const createCall = prisma.cashDuePayment.create.mock.calls[0] as [
        { data: { status: PaymentStatus; paidAt?: Date } },
      ];
      expect(createCall[0].data.status).toBe(PaymentStatus.PAID);
      expect(createCall[0].data.paidAt).toBeInstanceOf(Date);
      expect(prisma.cashDuePayment.create).toHaveBeenCalledWith(
        expect.objectContaining({ select: cashDuePaymentSelect }),
      );
    });

    it('throws ConflictException when the payment is already paid', async () => {
      prisma.cashDuePayment.findUnique.mockResolvedValue({
        id: 'p1',
        status: PaymentStatus.PAID,
      });

      await expect(service.pay('c1', 'd1', 'm1', 'u2')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.cashTransaction.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for a non-treasurer and writes nothing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        members: [{ role: ClassRole.MEMBER }],
      });

      await expect(service.pay('c1', 'd1', 'm1', 'u2')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.cashDuePayment.update).not.toHaveBeenCalled();
    });
  });

  describe('CashDuesService.unpay', () => {
    beforeEach(() => {
      prisma.classroom.findUnique.mockResolvedValue({
        members: [{ role: BANKS }],
      });
      prisma.cashDue.findFirst.mockResolvedValue({ id: 'd1' });
    });

    it('clears the payment and voids the linked transaction with the revert reason', async () => {
      prisma.cashDuePayment.findUnique.mockResolvedValue({
        id: 'p1',
        status: PaymentStatus.PAID,
      });
      prisma.cashDuePayment.update.mockResolvedValue(paymentRow());
      prisma.cashTransaction.findUnique.mockResolvedValue({
        id: 't1',
        voidedAt: null,
      });
      prisma.cashTransaction.update.mockResolvedValue({ id: 't1' });

      await service.unpay('c1', 'd1', 'm1', 'u2');

      const updateCall = prisma.cashTransaction.update.mock.calls[0] as [
        {
          where: { id: string };
          data: { voidedAt?: Date; voidReason?: string };
        },
      ];
      expect(updateCall[0].where).toEqual({ id: 't1' });
      expect(updateCall[0].data.voidedAt).toBeInstanceOf(Date);
      expect(updateCall[0].data.voidReason).toBe('payment reverted');
    });

    it('throws ConflictException when the payment is already unpaid', async () => {
      prisma.cashDuePayment.findUnique.mockResolvedValue({
        id: 'p1',
        status: PaymentStatus.UNPAID,
      });

      await expect(
        service.unpay('c1', 'd1', 'm1', 'u2'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.cashDuePayment.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when no payment row exists', async () => {
      prisma.cashDuePayment.findUnique.mockResolvedValue(null);

      await expect(
        service.unpay('c1', 'd1', 'm1', 'u2'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('CashDuesService.memberDetail', () => {
    it('lets an officer read another member and computes the outstanding', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ id: 'm9', role: ClassRole.KETUA }],
      });
      prisma.classMember.findFirst.mockResolvedValue({
        id: 'm1',
        userId: 'u3',
        role: ClassRole.MEMBER,
        isActive: true,
        user: { id: 'u3', name: 'Budi', avatarUrl: null },
      });
      prisma.cashDue.findMany.mockResolvedValue([
        dueRow({ id: 'd1', title: 'Week 1', amount: 20000 }),
        dueRow({ id: 'd2', title: 'Week 2', amount: 10000 }),
      ]);
      prisma.cashDuePayment.findMany.mockResolvedValue([
        { dueId: 'd1', status: PaymentStatus.PAID, paidAt: new Date() },
      ]);

      const result = await service.memberDetail('c1', 'm1', 'u2');

      expect(result.member).toMatchObject({ id: 'm1', name: 'Budi' });
      expect(result.outstanding).toBe(10000);
      expect(result.dues.find((due) => due.dueId === 'd1')?.status).toBe(
        PaymentStatus.PAID,
      );
      expect(result.dues.find((due) => due.dueId === 'd2')?.status).toBe(
        PaymentStatus.UNPAID,
      );
    });

    it('rejects a MEMBER reading another member', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [{ id: 'm2', role: ClassRole.MEMBER }],
      });
      prisma.classMember.findFirst.mockResolvedValue({
        id: 'm1',
        userId: 'u3',
        role: ClassRole.MEMBER,
        isActive: true,
        user: { id: 'u3', name: 'Budi', avatarUrl: null },
      });

      await expect(
        service.memberDetail('c1', 'm1', 'u2'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFoundException when the member is not in the class', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.classMember.findFirst.mockResolvedValue(null);

      await expect(
        service.memberDetail('c1', 'm9', 'w1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
