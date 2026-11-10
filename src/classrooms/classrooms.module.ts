import { Module } from '@nestjs/common';
import { ClassroomsController } from './classrooms.controller';
import { ClassroomsService } from './classrooms.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  controllers: [ClassroomsController, MembersController],
  providers: [ClassroomsService, MembersService],
})
export class ClassroomsModule {}
