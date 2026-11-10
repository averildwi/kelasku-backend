import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class QueryMemberDto extends PaginationDto {
  @ApiPropertyOptional({
    example: 'Budi',
    description: 'Filter by member name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
