import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class VoidCashTransactionDto {
  @ApiProperty({
    example: 'Duplicate entry',
    maxLength: 200,
    description: 'Why the transaction is voided; kept for the audit trail',
  })
  @IsString()
  @Length(1, 200)
  reason: string;
}
