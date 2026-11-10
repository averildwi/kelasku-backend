import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ClassRole } from '../../../generated/prisma/client';

export class AssignRoleDto {
  @ApiProperty({
    enum: ClassRole,
    example: ClassRole.KETUA,
    description:
      'Class office to assign. MEMBER removes any office (BR-1); classRole is never accepted on any other body.',
  })
  @IsEnum(ClassRole)
  classRole: ClassRole;
}
