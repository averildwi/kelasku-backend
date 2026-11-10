import { PartialType } from '@nestjs/swagger';
import { CreateWhiteboardDto } from './create-whiteboard.dto';

export class UpdateWhiteboardDto extends PartialType(CreateWhiteboardDto) {}
