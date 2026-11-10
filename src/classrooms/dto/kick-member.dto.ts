import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class KickMemberDto {
  @ApiPropertyOptional({
    example: 'Repeatedly disruptive in class',
    maxLength: 200,
    description: 'Optional reason stored on the membership row (BR-7)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
