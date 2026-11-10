import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { DATE_ONLY_PATTERN } from './create-whiteboard.dto';

export class QueryWhiteboardDto extends PaginationDto {
  @ApiPropertyOptional({
    example: '3d6c1e9a-9c1b-4c1e-9f0a-1b2c3d4e5f60',
    description: 'Filter by subject',
  })
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @ApiPropertyOptional({
    example: '2026-11-11',
    description: 'Exact date, YYYY-MM-DD',
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'date must be YYYY-MM-DD' })
  @IsDateString({ strict: true })
  date?: string;

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
