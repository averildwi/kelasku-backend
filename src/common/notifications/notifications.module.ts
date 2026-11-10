import { Global, Module } from '@nestjs/common';
import { FirebaseService } from './firebase.service';
import { PushSenderService } from './push-sender.service';

/** Shared push infrastructure: inbox row + NotificationLog claim + FCM send. */
@Global()
@Module({
  providers: [FirebaseService, PushSenderService],
  exports: [PushSenderService],
})
export class NotificationsModule {}
