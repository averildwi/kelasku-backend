import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CashType,
  ClassRole,
  PaymentStatus,
} from '../../generated/prisma/client';
import type { UploadedImageFile } from '../common/upload/storage.service';
import { StorageService } from '../common/upload/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CashTransactionsService,
  cashTransactionSelect,
} from './cash-transactions.service';
import { CreateCashTransactionDto } from './dto/create-cash-transaction.dto';
import { QueryCashTransactionDto } from './dto/query-cash-transaction.dto';

const RECORD_DTO: CreateCashTransactionDto = {
  type: CashType.INCOME,
  amount: 50000,
  description: 'Weekly class fund',
  date: '2020-01-01',
};

function transactionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    classId: 'c1',
    type: CashType.INCOME,
    amount: 50000,
    description: 'Weekly class fund',
    date: new Date('2020-01-01T00:00:00.000Z'),
    proofUrl: null,
    recordedById: 'u2',
    voidedAt: null,
    voidReason: null,
    createdAt: new Date('2020-01-01T00:00:00.000Z'),
    updatedAt: new Date('2020-01-01T00:00:00.000Z'),
    recordedBy: { id: 'u2', name: 'Bendahara', avatarUrl: null },
    ...overrides,
  };
}

const PROOF: UploadedImageFile = {
  buffer: Buffer.from('image'),
  mimetype: 'image/jpeg',
  size: 5,
  originalname: 'proof.jpg',
};

describe('CashTransactionsService', () => {
  let service: CashTransactionsService;
  let prisma: {
    classroom: { findUnique: jest.Mock };
    cashTransaction: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
      aggregate: jest.Mock;
    };
    classMember: { findMany: jest.Mock };
    cashDue: { findMany: jest.Mock };
    cashDuePayment: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let storage: { uploadImage: jest.Mock; deleteImage: jest.Mock };

  beforeEach(async () => {
    prisma = {
      classroom: { findUnique: jest.fn() },
      cashTransaction: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn(),
      },
      classMember: { findMany: jest.fn() },
      cashDue: { findMany: jest.fn() },
      cashDuePayment: { findMany: jest.fn() },
      $transaction: jest.fn(
        (arg: ((client: unknown) => Promise<unknown>) | Promise<unknown>[]) =>
          typeof arg === 'function' ? arg({}) : Promise.all(arg),
      ),
    };
    storage = { uploadImage: jest.fn(), deleteImage: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CashTransactionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = moduleRef.get(CashTransactionsService);
  });

  describe('CashTransactionsService.summary', () => {
    it('computes the balance over non-voided income and expense', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.cashTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 150000 } })
        .mockResolvedValueOnce({ _sum: { amount: 50000 } });
      prisma.classMember.findMany.mockResolvedValue([]);
      prisma.cashDue.findMany.mockResolvedValue([]);
      prisma.cashDuePayment.findMany.mockResolvedValue([]);

      const result = await service.summary('c1', 'w1');

      expect(result).toEqual({
        balance: 100000,
        totalIncome: 150000,
        totalExpense: 50000,
        outstandingTotal: 0,
        outstanding: [],
      });
      expect(prisma.cashTransaction.aggregate).toHaveBeenNthCalledWith(1, {
        where: { classId: 'c1', type: CashType.INCOME, voidedAt: null },
        _sum: { amount: true },
      });
      expect(prisma.cashTransaction.aggregate).toHaveBeenNthCalledWith(2, {
        where: { classId: 'c1', type: CashType.EXPENSE, voidedAt: null },
        _sum: { amount: true },
      });
    });

    it('treats a missing sum as zero', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.cashTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: null } })
        .mockResolvedValueOnce({ _sum: { amount: null } });
      prisma.classMember.findMany.mockResolvedValue([]);
      prisma.cashDue.findMany.mockResolvedValue([]);
      prisma.cashDuePayment.findMany.mockResolvedValue([]);

      const result = await service.summary('c1', 'w1');

      expect(result).toEqual({
        balance: 0,
        totalIncome: 0,
        totalExpense: 0,
        outstandingTotal: 0,
        outstanding: [],
      });
    });

    it('computes outstanding per active member, counting late joiners as unpaid', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.cashTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 0 } })
        .mockResolvedValueOnce({ _sum: { amount: 0 } });
      prisma.classMember.findMany.mockResolvedValue([
        { id: 'm1', userId: 'u2', user: { name: 'Budi' } },
        { id: 'm2', userId: 'u3', user: { name: 'Ana' } },
      ]);
      prisma.cashDue.findMany.mockResolvedValue([
        { id: 'd1', amount: 20000 },
        { id: 'd2', amount: 10000 },
      ]);
      prisma.cashDuePayment.findMany.mockResolvedValue([
        { dueId: 'd1', memberId: 'm1', status: PaymentStatus.PAID },
        { dueId: 'd1', memberId: 'm2', status: PaymentStatus.PAID },
        { dueId: 'd2', memberId: 'm2', status: PaymentStatus.PAID },
      ]);

      const result = await service.summary('c1', 'w1');

      expect(result.outstandingTotal).toBe(10000);
      expect(result.outstanding).toEqual([
        { memberId: 'm1', userId: 'u2', name: 'Budi', amount: 10000 },
      ]);
    });

    it('throws ForbiddenException for a non-member non-homeroom caller', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });

      await expect(service.summary('c1', 'u9')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.cashTransaction.aggregate).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the class does not exist', async () => {
      prisma.classroom.findUnique.mockResolvedValue(null);

      await expect(service.summary('c1', 'w1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('CashTransactionsService.findAll', () => {
    it('filters by type and date range and returns pagination meta', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        homeroomTeacherId: 'w1',
        members: [],
      });
      prisma.cashTransaction.findMany.mockResolvedValue([transactionRow()]);
      prisma.cashTransaction.count.mockResolvedValue(1);

      const query = new QueryCashTransactionDto();
      query.type = CashType.INCOME;
      query.from = '2020-01-01';
      query.to = '2020-12-31';
      const result = await service.findAll('c1', 'w1', query);

      const args = prisma.cashTransaction.findMany.mock.calls[0] as [
        {
          where: {
            classId: string;
            type: string;
            date: { gte: Date; lte: Date };
          };
        },
      ];
      expect(args[0].where.classId).toBe('c1');
      expect(args[0].where.type).toBe(CashType.INCOME);
      expect(args[0].where.date.gte).toEqual(
        new Date('2020-01-01T00:00:00.000Z'),
      );
      expect(args[0].where.date.lte).toEqual(
        new Date('2020-12-31T00:00:00.000Z'),
      );
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });
  });

  describe('CashTransactionsService.create', () => {
    it('records a transaction with a proof image for the treasurer', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        members: [{ role: ClassRole.BENDAHARA }],
      });
      storage.uploadImage.mockResolvedValue({
        url: 'https://cdn.kelasku/cash.jpg',
        publicId: 'kelasku/c1/cash/cash',
        width: 100,
        height: 100,
      });
      prisma.cashTransaction.create.mockResolvedValue(
        transactionRow({ proofUrl: 'https://cdn.kelasku/cash.jpg' }),
      );

      await service.create('c1', 'u2', RECORD_DTO, PROOF);

      expect(storage.uploadImage).toHaveBeenCalledWith(
        PROOF,
        'kelasku/c1/cash',
      );
      expect(prisma.cashTransaction.create).toHaveBeenCalledWith({
        data: {
          classId: 'c1',
          type: CashType.INCOME,
          amount: 50000,
          description: 'Weekly class fund',
          date: new Date('2020-01-01T00:00:00.000Z'),
          proofUrl: 'https://cdn.kelasku/cash.jpg',
          recordedById: 'u2',
        },
        select: cashTransactionSelect,
      });
    });

    it('records a transaction without proof when no file is sent', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        members: [{ role: ClassRole.BENDAHARA }],
      });
      prisma.cashTransaction.create.mockResolvedValue(transactionRow());

      await service.create('c1', 'u2', RECORD_DTO);

      expect(storage.uploadImage).not.toHaveBeenCalled();
      expect(prisma.cashTransaction.create).toHaveBeenCalledWith({
        data: {
          classId: 'c1',
          type: CashType.INCOME,
          amount: 50000,
          description: 'Weekly class fund',
          date: new Date('2020-01-01T00:00:00.000Z'),
          proofUrl: null,
          recordedById: 'u2',
        },
        select: cashTransactionSelect,
      });
    });

    it('throws ForbiddenException for an active MEMBER and writes nothing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        members: [{ role: ClassRole.MEMBER }],
      });

      await expect(
        service.create('c1', 'u2', RECORD_DTO),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.cashTransaction.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for the homeroom teacher (read-only)', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        members: [],
      });

      await expect(
        service.create('c1', 'u1', RECORD_DTO),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.cashTransaction.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for a future date and uploads nothing', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        members: [{ role: ClassRole.BENDAHARA }],
      });

      await expect(
        service.create(
          'c1',
          'u2',
          { ...RECORD_DTO, date: '2999-01-01' },
          PROOF,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.uploadImage).not.toHaveBeenCalled();
      expect(prisma.cashTransaction.create).not.toHaveBeenCalled();
    });

    it('deletes the uploaded proof and rethrows when the write fails', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        members: [{ role: ClassRole.BENDAHARA }],
      });
      storage.uploadImage.mockResolvedValue({
        url: 'https://cdn.kelasku/cash.jpg',
        publicId: 'kelasku/c1/cash/cash',
        width: 100,
        height: 100,
      });
      prisma.cashTransaction.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.create('c1', 'u2', RECORD_DTO, PROOF),
      ).rejects.toThrow('db down');
      expect(storage.deleteImage).toHaveBeenCalledWith('kelasku/c1/cash/cash');
    });
  });

  describe('CashTransactionsService.void', () => {
    it('keeps the row and stamps voidedAt with the reason', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        members: [{ role: ClassRole.BENDAHARA }],
      });
      prisma.cashTransaction.findFirst.mockResolvedValue({
        id: 't1',
        voidedAt: null,
      });
      prisma.cashTransaction.update.mockResolvedValue(
        transactionRow({
          voidedAt: new Date(),
          voidReason: 'Duplicate entry',
        }),
      );

      await service.void('c1', 't1', 'u2', { reason: 'Duplicate entry' });

      const call = prisma.cashTransaction.update.mock.calls[0] as [
        {
          where: { id: string };
          data: { voidedAt?: Date; voidReason?: string };
          select: unknown;
        },
      ];
      expect(call[0].where).toEqual({ id: 't1' });
      expect(call[0].data.voidedAt).toBeInstanceOf(Date);
      expect(call[0].data.voidReason).toBe('Duplicate entry');
      expect(call[0].select).toBe(cashTransactionSelect);
    });

    it('throws ConflictException when the transaction is already voided', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        members: [{ role: ClassRole.BENDAHARA }],
      });
      prisma.cashTransaction.findFirst.mockResolvedValue({
        id: 't1',
        voidedAt: new Date('2020-01-02T00:00:00.000Z'),
      });

      await expect(
        service.void('c1', 't1', 'u2', { reason: 'Duplicate entry' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.cashTransaction.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the transaction is not in the class', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        members: [{ role: ClassRole.BENDAHARA }],
      });
      prisma.cashTransaction.findFirst.mockResolvedValue(null);

      await expect(
        service.void('c1', 't9', 'u2', { reason: 'Duplicate entry' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ForbiddenException for an active MEMBER', async () => {
      prisma.classroom.findUnique.mockResolvedValue({
        members: [{ role: ClassRole.MEMBER }],
      });

      await expect(
        service.void('c1', 't1', 'u2', { reason: 'Duplicate entry' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.cashTransaction.findFirst).not.toHaveBeenCalled();
    });
  });
});

describe('CreateCashTransactionDto validation', () => {
  function validateAmount(amount: number): Promise<unknown> {
    return validate(
      plainToInstance(CreateCashTransactionDto, {
        type: CashType.INCOME,
        amount,
        description: 'Weekly class fund',
        date: '2020-01-01',
      }),
    );
  }

  it('rejects zero, negative and non-integer amounts', async () => {
    for (const amount of [0, -5, 1.5]) {
      const errors = (await validateAmount(amount)) as { property: string }[];
      expect(errors.some((error) => error.property === 'amount')).toBe(true);
    }
  });

  it('accepts a positive integer amount', async () => {
    const errors = await validateAmount(1000);
    expect(errors).toHaveLength(0);
  });
});
