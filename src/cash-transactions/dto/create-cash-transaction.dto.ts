import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { CashType } from '../../../generated/prisma/client';

/** A calendar date without a time, interpreted in Asia/Jakarta. */
export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateCashTransactionDto {
  @ApiProperty({
    enum: CashType,
    example: CashType.INCOME,
    description: 'INCOME adds to the balance, EXPENSE subtracts from it',
  })
  @IsEnum(CashType)
  type: CashType;

  @ApiProperty({
    example: 50000,
    minimum: 1,
    description: 'Integer rupiah, at least 1',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount: number;

  @ApiProperty({ example: 'Weekly class fund', maxLength: 200 })
  @IsString()
  @Length(1, 200)
  description: string;

  @ApiProperty({
    example: '2026-11-11',
    description:
      'Transaction date, YYYY-MM-DD (Asia/Jakarta), not in the future',
  })
  @Matches(DATE_ONLY_PATTERN, { message: 'date must be YYYY-MM-DD' })
  @IsDateString({ strict: true })
  date: string;
}
