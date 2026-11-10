import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';

export interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Firebase Cloud Messaging transport. The SDK is created lazily on the first
 * send, so a bad or missing credential can never fail boot; the caller handles
 * delivery failures.
 */
@Injectable()
export class FirebaseService {
  private readonly logger = new Logger(FirebaseService.name);
  private messaging?: Messaging;

  constructor(private readonly config: ConfigService) {}

  /**
   * Sends one message to every token. Returns the tokens FCM reported as
   * unregistered so the caller can prune them; other failures are logged.
   */
  async sendToTokens(
    tokens: string[],
    payload: PushNotification,
  ): Promise<string[]> {
    if (tokens.length === 0) return [];

    const result = await this.getMessaging().sendEachForMulticast({
      tokens,
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
    });

    const stale: string[] = [];
    result.responses.forEach((response, index) => {
      if (response.success) return;
      const code = response.error?.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        stale.push(tokens[index]);
      } else {
        this.logger.warn(`FCM send failed (${code ?? 'unknown'})`);
      }
    });
    return stale;
  }

  private getMessaging(): Messaging {
    if (this.messaging) return this.messaging;

    const app: App =
      getApps()[0] ??
      initializeApp({
        credential: cert({
          projectId: this.config.getOrThrow<string>('FIREBASE_PROJECT_ID'),
          clientEmail: this.config.getOrThrow<string>('FIREBASE_CLIENT_EMAIL'),
          // The env stores the private key with escaped newlines.
          privateKey: this.config
            .getOrThrow<string>('FIREBASE_PRIVATE_KEY')
            .replace(/\\n/g, '\n'),
        }),
      });
    this.messaging = getMessaging(app);
    return this.messaging;
  }
}
