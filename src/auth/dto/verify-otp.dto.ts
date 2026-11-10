import { IsAccountEmail, IsOtpCode } from '../decorators/auth-fields.decorator';

export class VerifyOtpDto {
  @IsAccountEmail()
  email: string;

  @IsOtpCode()
  code: string;
}
