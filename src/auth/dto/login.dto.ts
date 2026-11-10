import {
  IsAccountEmail,
  IsCurrentPassword,
} from '../decorators/auth-fields.decorator';

export class LoginDto {
  @IsAccountEmail()
  email: string;

  @IsCurrentPassword()
  password: string;
}
