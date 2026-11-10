import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateClassroomDto {
  @ApiProperty({ example: 'XII IPA 2', description: 'Class name' })
  @IsString()
  @Length(2, 100)
  name: string;

  @ApiPropertyOptional({
    example: 'SMA Negeri 1 Bandung',
    description: 'School name',
    maxLength: 150,
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  schoolName?: string;

  @ApiPropertyOptional({ example: '2026/2027', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  academicYear?: string;

  @ApiPropertyOptional({
    example: 36,
    minimum: 1,
    maximum: 1000,
    description: 'Caps ACTIVE members; omit or null for unlimited',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxStudents?: number;
}
