import { IsAccountEmail } from '../decorators/auth-fields.decorator';

export class RequestCodeDto {
  @IsAccountEmail()
  email: string;
}
