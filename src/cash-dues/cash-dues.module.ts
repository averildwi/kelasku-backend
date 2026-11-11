import { Module } from '@nestjs/common';
import { CashDuesController } from './cash-dues.controller';
import { CashDuesService } from './cash-dues.service';

@Module({
  controllers: [CashDuesController],
  providers: [CashDuesService],
})
export class CashDuesModule {}
