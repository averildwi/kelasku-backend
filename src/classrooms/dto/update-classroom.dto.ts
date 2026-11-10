import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CreateClassroomDto } from './create-classroom.dto';

export class UpdateClassroomDto extends PartialType(
  OmitType(CreateClassroomDto, [
    'schoolName',
    'academicYear',
    'maxStudents',
  ] as const),
) {
  @ApiPropertyOptional({
    example: true,
    description: 'Lock the class and block new joins',
  })
  @IsOptional()
  @IsBoolean()
  isLocked?: boolean;

  @ApiPropertyOptional({
    example: 'SMA Negeri 1 Bandung',
    maxLength: 150,
    nullable: true,
    description: 'Send null to clear',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  schoolName?: string | null;

  @ApiPropertyOptional({
    example: '2026/2027',
    maxLength: 20,
    nullable: true,
    description: 'Send null to clear',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  academicYear?: string | null;

  @ApiPropertyOptional({
    example: 36,
    minimum: 1,
    maximum: 1000,
    nullable: true,
    description: 'Caps ACTIVE members; send null for unlimited',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxStudents?: number | null;
}
