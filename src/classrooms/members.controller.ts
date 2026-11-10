import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  MessageResponse,
  Paginated,
} from '../common/interceptors/transform.interceptor';
import { AssignRoleDto } from './dto/assign-role.dto';
import { JoinClassroomDto } from './dto/join-classroom.dto';
import { KickMemberDto } from './dto/kick-member.dto';
import { QueryMemberDto } from './dto/query-member.dto';
import { MembersService } from './members.service';

// BR-12: a code is short and guessable, so join is stricter than the global limit.
const JOIN_THROTTLE = { default: { limit: 6, ttl: 60_000 } };

@ApiTags('Classrooms')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('classrooms')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Post('join')
  @Throttle(JOIN_THROTTLE)
  @Roles('MURID')
  @ApiOperation({
    summary: '[MURID] Join a classroom by code',
    description:
      'A student may hold at most one active membership (BR-2). Re-joining after leaving reactivates the row; a kicked student must be restored first (BR-3).',
  })
  async join(@Body() dto: JoinClassroomDto, @CurrentUser('id') userId: string) {
    const result = await this.membersService.join(dto, userId);
    return new MessageResponse(result, 'Joined classroom');
  }

  @Post(':classId/leave')
  @HttpCode(HttpStatus.OK)
  @Roles('MURID')
  @ApiOperation({
    summary: '[MURID] Leave my classroom',
    description: 'The office, if any, reverts to MEMBER (BR-8).',
  })
  async leave(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.membersService.leave(classId, userId);
    return new MessageResponse(null, 'Left classroom');
  }

  @Get(':classId/members/inactive')
  @Roles('WALI_KELAS')
  @ApiOperation({
    summary: '[WALI_KELAS] List kicked or left members',
    description:
      'Only the homeroom teacher of this class (checked in the service).',
  })
  async listInactive(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Query() query: QueryMemberDto,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.membersService.listInactive(
      classId,
      userId,
      query,
    );
    return new Paginated(result.data, result.meta);
  }

  @Get(':classId/members')
  @Roles('WALI_KELAS', 'MURID')
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] List active members',
    description:
      'Allowed for the homeroom teacher of this class or an ACTIVE member (checked in the service).',
  })
  async listMembers(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Query() query: QueryMemberDto,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.membersService.listMembers(
      classId,
      userId,
      query,
    );
    return new Paginated(result.data, result.meta);
  }

  @Post(':classId/members/:memberId/kick')
  @HttpCode(HttpStatus.OK)
  @Roles('WALI_KELAS')
  @ApiOperation({
    summary: '[WALI_KELAS] Kick a member',
    description:
      'Only the homeroom teacher of this class (checked in the service). The row is kept as KICKED with all history (BR-7).',
  })
  async kick(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: KickMemberDto,
    @CurrentUser('id') userId: string,
  ) {
    await this.membersService.kick(classId, memberId, userId, dto);
    return new MessageResponse(null, 'Member kicked');
  }

  @Post(':classId/members/:memberId/restore')
  @HttpCode(HttpStatus.OK)
  @Roles('WALI_KELAS')
  @ApiOperation({
    summary: '[WALI_KELAS] Restore a kicked member',
    description:
      'Only the homeroom teacher of this class (checked in the service). A LEFT member cannot be restored (BR-2).',
  })
  async restore(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentUser('id') userId: string,
  ) {
    const member = await this.membersService.restore(classId, memberId, userId);
    return new MessageResponse(member, 'Member restored');
  }

  @Post(':classId/members/:memberId/assign-role')
  @HttpCode(HttpStatus.OK)
  @Roles('WALI_KELAS')
  @ApiOperation({
    summary: '[WALI_KELAS] Assign a class role',
    description:
      'Only the homeroom teacher of this class (checked in the service). One holder per office; the previous holder reverts to MEMBER (BR-1).',
  })
  async assignRole(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: AssignRoleDto,
    @CurrentUser('id') userId: string,
  ) {
    const member = await this.membersService.assignRole(
      classId,
      memberId,
      userId,
      dto,
    );
    return new MessageResponse(member, 'Role assigned');
  }
}
