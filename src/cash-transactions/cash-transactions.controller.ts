import {
  Body,
  Controller,
  FileTypeValidator,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  MessageResponse,
  Paginated,
} from '../common/interceptors/transform.interceptor';
import type { UploadedImageFile } from '../common/upload/storage.service';
import { CashTransactionsService } from './cash-transactions.service';
import { CreateCashTransactionDto } from './dto/create-cash-transaction.dto';
import { QueryCashTransactionDto } from './dto/query-cash-transaction.dto';
import { VoidCashTransactionDto } from './dto/void-cash-transaction.dto';

const IMAGE_TYPE_PATTERN = /^image\/(jpeg|png|webp)$/;
const MAX_PROOF_FILE_SIZE = 5 * 1024 * 1024;
const RECORD_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('CashTransactions')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('WALI_KELAS', 'MURID')
@Controller('classrooms/:classId/cash')
export class CashTransactionsController {
  constructor(
    private readonly cashTransactionsService: CashTransactionsService,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Cash balance and totals',
    description:
      'Balance plus income/expense totals over non-voided transactions. Allowed for the homeroom teacher or an ACTIVE member (checked in the service).',
  })
  summary(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.cashTransactionsService.summary(classId, userId);
  }

  @Get('transactions')
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] List cash transactions',
    description:
      'Full ledger, newest first, voided rows included; filters by type and date range. Allowed for the homeroom teacher or an ACTIVE member (checked in the service).',
  })
  async findAll(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Query() query: QueryCashTransactionDto,
    @CurrentUser('id') userId: string,
  ) {
    const result = await this.cashTransactionsService.findAll(
      classId,
      userId,
      query,
    );
    return new Paginated(result.data, result.meta);
  }

  @Post('transactions')
  @Throttle(RECORD_THROTTLE)
  @UseInterceptors(FileInterceptor('proof'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['type', 'amount', 'description', 'date'],
      properties: {
        type: { type: 'string', enum: ['INCOME', 'EXPENSE'] },
        amount: { type: 'integer', minimum: 1 },
        description: { type: 'string', maxLength: 200 },
        date: { type: 'string', format: 'date', example: '2026-11-11' },
        proof: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Record a cash transaction',
    description:
      'Optional jpg/png/webp proof of at most 5 MB. Only the class treasurer may write (checked in the service); the homeroom teacher is read-only.',
  })
  async create(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: CreateCashTransactionDto,
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: false,
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_PROOF_FILE_SIZE }),
          new FileTypeValidator({ fileType: IMAGE_TYPE_PATTERN }),
        ],
      }),
    )
    proof: UploadedImageFile | undefined,
    @CurrentUser('id') userId: string,
  ) {
    const transaction = await this.cashTransactionsService.create(
      classId,
      userId,
      dto,
      proof,
    );
    return new MessageResponse(transaction, 'Cash transaction recorded');
  }

  @Post('transactions/:transactionId/void')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[WALI_KELAS/MURID] Void a cash transaction',
    description:
      'Keeps the row and stores the reason; 409 when already voided. Only the class treasurer may write (checked in the service).',
  })
  async void(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('transactionId', ParseUUIDPipe) transactionId: string,
    @Body() dto: VoidCashTransactionDto,
    @CurrentUser('id') userId: string,
  ) {
    const transaction = await this.cashTransactionsService.void(
      classId,
      transactionId,
      userId,
      dto,
    );
    return new MessageResponse(transaction, 'Cash transaction voided');
  }
}
