import { Injectable, Logger } from '@nestjs/common';
import { NotificationType, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FirebaseService } from './firebase.service';
import type { PushNotification } from './firebase.service';

/** A push that becomes one inbox row + one NotificationLog claim per recipient. */
export interface PushMessage {
  type: NotificationType;
  /** Business id for the BR-16 key (announcement, poll, due, picket day, ...). */
  refId: string;
  classId?: string | null;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
  userIds: string[];
  /** Defaults to the current UTC day; the claim is unique per (type, refId, user, date). */
  sentDate?: Date;
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** FCM data values must be strings; anything else is JSON-encoded. */
function toFcmData(
  data: Prisma.InputJsonValue | undefined,
): Record<string, string> | undefined {
  if (data === undefined || data === null || typeof data !== 'object') {
    return undefined;
  }
  if (Array.isArray(data)) return undefined;

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return result;
}

/**
 * Shared push fan-out used by every feature. It writes the in-app inbox entry
 * and claims the idempotency log, then delivers over FCM.
 */
@Injectable()
export class PushSenderService {
  private readonly logger = new Logger(PushSenderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebaseService,
  ) {}

  /**
   * Fans a message out to every recipient. Best-effort and never rejects: the
   * triggering API call must not fail because FCM is down. Callers should not
   * await it (fire-and-forget) to keep the response fast.
   */
  async send(message: PushMessage): Promise<void> {
    const sentDate = startOfUtcDay(message.sentDate ?? new Date());
    await Promise.all(
      message.userIds.map((userId) => this.deliver(userId, message, sentDate)),
    );
  }

  /**
   * BR-16: claim the (type, refId, user, day) log row and write the inbox entry
   * in one transaction. Losing the unique race means the push was already
   * queued for this user today, so nothing is written and no FCM call is made.
   */
  private async deliver(
    userId: string,
    message: PushMessage,
    sentDate: Date,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.notificationLog.create({
          data: {
            type: message.type,
            refId: message.refId,
            userId,
            sentDate,
          },
          select: { id: true },
        });
        await tx.notification.create({
          data: {
            userId,
            classId: message.classId ?? null,
            type: message.type,
            title: message.title,
            body: message.body,
            ...(message.data !== undefined ? { data: message.data } : {}),
          },
          select: { id: true },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) return;
      this.logger.error(
        `Failed to record notification for user ${userId}: ${describeError(error)}`,
      );
      return;
    }

    await this.push(userId, message);
  }

  private async push(userId: string, message: PushMessage): Promise<void> {
    try {
      const tokens = await this.prisma.deviceToken.findMany({
        where: { userId },
        select: { token: true },
      });
      if (tokens.length === 0) return;

      const payload: PushNotification = {
        title: message.title,
        body: message.body,
        data: toFcmData(message.data),
      };
      const stale = await this.firebase.sendToTokens(
        tokens.map((device) => device.token),
        payload,
      );
      if (stale.length > 0) {
        await this.prisma.deviceToken.deleteMany({
          where: { token: { in: stale } },
        });
      }
    } catch (error) {
      this.logger.error(
        `Push delivery failed for user ${userId}: ${describeError(error)}`,
      );
    }
  }
}
