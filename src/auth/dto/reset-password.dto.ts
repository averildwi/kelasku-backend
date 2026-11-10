import {
  IsAccountEmail,
  IsNewPassword,
  IsOtpCode,
} from '../decorators/auth-fields.decorator';

export class ResetPasswordDto {
  @IsAccountEmail()
  email: string;

  @IsOtpCode()
  code: string;

  @IsNewPassword()
  newPassword: string;
}
