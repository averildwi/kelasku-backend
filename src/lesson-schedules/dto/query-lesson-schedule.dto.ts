import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryLessonScheduleDto extends PaginationDto {
  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    maximum: 7,
    description: 'Filter by weekday, 1 = Monday .. 7 = Sunday',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  day?: number;
}
