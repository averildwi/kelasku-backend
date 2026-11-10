import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, Length } from 'class-validator';
import { GlobalRole } from '../../../generated/prisma/client';
import {
  IsAccountEmail,
  IsNewPassword,
} from '../decorators/auth-fields.decorator';

export class RegisterDto {
  @ApiProperty({ example: 'Budi Santoso' })
  @IsString()
  @Length(2, 100)
  name: string;

  @IsAccountEmail()
  email: string;

  @IsNewPassword()
  password: string;

  @ApiProperty({ enum: GlobalRole, example: GlobalRole.MURID })
  @IsEnum(GlobalRole)
  globalRole: GlobalRole;
}
