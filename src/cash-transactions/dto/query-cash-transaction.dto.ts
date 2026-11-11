import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, Matches } from 'class-validator';
import { CashType } from '../../../generated/prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { DATE_ONLY_PATTERN } from './create-cash-transaction.dto';

export class QueryCashTransactionDto extends PaginationDto {
  @ApiPropertyOptional({ enum: CashType, example: CashType.INCOME })
  @IsOptional()
  @IsEnum(CashType)
  type?: CashType;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'Start of the date range, YYYY-MM-DD',
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'from must be YYYY-MM-DD' })
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description: 'End of the date range, YYYY-MM-DD',
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'to must be YYYY-MM-DD' })
  @IsDateString({ strict: true })
  to?: string;
}
