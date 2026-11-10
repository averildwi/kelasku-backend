import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  MessageResponse,
  Paginated,
} from '../common/interceptors/transform.interceptor';
import { ClassroomsService } from './classrooms.service';
import { CreateClassroomDto } from './dto/create-classroom.dto';
import { QueryClassroomDto } from './dto/query-classroom.dto';
import { UpdateClassroomDto } from './dto/update-classroom.dto';

@ApiTags('Classrooms')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('classrooms')
export class ClassroomsController {
  constructor(private readonly classroomsService: ClassroomsService) {}

  @Post()
  @Roles('WALI_KELAS')
  @ApiOperation({
    summary: '[WALI_KELAS] Create a classroom',
    description:
      'The creator becomes the homeroom teacher; the response contains the join code.',
  })
  async create(
    @Body() dto: CreateClassroomDto,
    @CurrentUser('id') userId: string,
  ) {
    const classroom = await this.classroomsService.create(dto, userId);
    return new MessageResponse(classroom, 'Classroom created');
  }

  @Get()
  @Roles('WALI_KELAS')
  @ApiOperation({ summary: '[WALI_KELAS] List my classrooms' })
  async findAll(
    @Query() query: QueryClassroomDto,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.classroomsService.findAll(userId, query);
    return new Paginated(result.data, result.meta);
  }

  @Get(':classId')
  @Roles('WALI_KELAS', 'MURID')
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Get classroom detail',
    description:
      'Allowed for the homeroom teacher of this class or an ACTIVE member (checked in the service).',
  })
  findOne(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.classroomsService.findOne(classId, userId);
  }

  @Patch(':classId')
  @Roles('WALI_KELAS')
  @ApiOperation({
    summary: '[WALI_KELAS] Update classroom settings',
    description:
      'Only the homeroom teacher of this class (checked in the service).',
  })
  async update(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: UpdateClassroomDto,
    @CurrentUser('id') userId: string,
  ) {
    const classroom = await this.classroomsService.update(classId, userId, dto);
    return new MessageResponse(classroom, 'Classroom updated');
  }

  @Post(':classId/regenerate-code')
  @HttpCode(HttpStatus.OK)
  @Roles('WALI_KELAS')
  @ApiOperation({
    summary: '[WALI_KELAS] Regenerate the join code',
    description:
      'Only the homeroom teacher of this class (checked in the service). The old code stops working.',
  })
  async regenerateCode(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.classroomsService.regenerateCode(classId, userId);
    return new MessageResponse(result, 'Class code regenerated');
  }
}
