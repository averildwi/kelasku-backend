import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export const POLL_STATUSES = ['open', 'closed'] as const;
export type PollStatus = (typeof POLL_STATUSES)[number];

export class QueryPollDto extends PaginationDto {
  @ApiPropertyOptional({ enum: POLL_STATUSES, example: 'open' })
  @IsOptional()
  @IsIn(POLL_STATUSES)
  status?: PollStatus;
}
