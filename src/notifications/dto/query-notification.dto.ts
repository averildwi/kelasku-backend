import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ToBoolean } from '../../common/decorators/to-boolean.decorator';

export class QueryNotificationDto extends PaginationDto {
  @ApiPropertyOptional({
    example: true,
    description: 'Only unread notifications when true',
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  unread?: boolean;

  @ApiPropertyOptional({
    example: '3f1b7c2e-2a4d-4c1e-9b8f-1a2b3c4d5e6f',
    format: 'uuid',
    description: 'Filter by classroom',
  })
  @IsOptional()
  @IsUUID()
  classId?: string;
}
