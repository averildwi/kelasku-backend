import { Module } from '@nestjs/common';
import { WhiteboardsController } from './whiteboards.controller';
import { WhiteboardsService } from './whiteboards.service';

@Module({
  controllers: [WhiteboardsController],
  providers: [WhiteboardsService],
})
export class WhiteboardsModule {}
