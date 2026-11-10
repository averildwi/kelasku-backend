import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { ToBoolean } from '../../common/decorators/to-boolean.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryAnnouncementDto extends PaginationDto {
  @ApiPropertyOptional({
    example: true,
    description: 'Filter by pinned state',
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isPinned?: boolean;
}
