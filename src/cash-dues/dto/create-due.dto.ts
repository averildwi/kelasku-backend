import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

/** A calendar date without a time, interpreted in Asia/Jakarta. */
export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateCashDueDto {
  @ApiProperty({ example: 'Week 1 class fund', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  title: string;

  @ApiProperty({
    example: 20000,
    minimum: 1,
    description: 'Integer rupiah charged to every active member, at least 1',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description: 'Optional payment target date, YYYY-MM-DD (Asia/Jakarta)',
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'dueDate must be YYYY-MM-DD' })
  @IsDateString({ strict: true })
  dueDate?: string;
}
