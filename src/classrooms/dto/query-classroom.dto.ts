import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryClassroomDto extends PaginationDto {
  @ApiPropertyOptional({
    example: 'XII IPA',
    description: 'Filter by class name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
