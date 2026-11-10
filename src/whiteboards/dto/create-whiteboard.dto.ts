import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

/** A calendar date without a time, interpreted in Asia/Jakarta. */
export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateWhiteboardDto {
  @ApiProperty({
    example: '3d6c1e9a-9c1b-4c1e-9f0a-1b2c3d4e5f60',
    description: 'Subject in the same class, not soft-deleted',
  })
  @IsUUID()
  subjectId: string;

  @ApiProperty({
    example: '2026-11-11',
    description: 'Note date, YYYY-MM-DD (Asia/Jakarta), not in the future',
  })
  @Matches(DATE_ONLY_PATTERN, { message: 'date must be YYYY-MM-DD' })
  @IsDateString({ strict: true })
  date: string;

  @ApiPropertyOptional({ example: 'Algebra recap', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;
}
