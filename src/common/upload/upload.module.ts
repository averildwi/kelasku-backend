import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/** Shared image storage infrastructure (Cloudinary). */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class UploadModule {}
