import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JAKARTA_TIME_ZONE, PicketsService } from './pickets.service';

const DAILY_AT_6PM = '0 18 * * *';

/** F-PICKET-2: daily H-1 reminder at 18:00 Asia/Jakarta. */
@Injectable()
export class PicketsScheduler {
  private readonly logger = new Logger(PicketsScheduler.name);

  constructor(private readonly pickets: PicketsService) {}

  @Cron(DAILY_AT_6PM, { timeZone: JAKARTA_TIME_ZONE })
  async handleDailyReminder(): Promise<void> {
    try {
      await this.pickets.sendTomorrowReminders();
    } catch (error) {
      // A failed run must not crash the process; the next day retries.
      this.logger.error(
        `Picket reminder job failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
