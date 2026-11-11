import { Module } from '@nestjs/common';
import { CashTransactionsController } from './cash-transactions.controller';
import { CashTransactionsService } from './cash-transactions.service';

@Module({
  controllers: [CashTransactionsController],
  providers: [CashTransactionsService],
})
export class CashTransactionsModule {}
