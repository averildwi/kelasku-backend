import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Response } from 'express';

export interface StandardResponse<T> {
  statusCode: number;
  message: string;
  data: T;
  timestamp: string;
}

/**
 * Return this instance if you want to return paginated data with meta information.
 * Example: return new Paginated(items, { page, limit, total });
 */
export class Paginated<T> {
  constructor(
    public data: T[],
    public meta: Record<string, any>,
  ) {}
}

/**
 * Return this instance if you want to bypass wrapping entirely
 * (except for StreamableFile which is automatically bypassed).
 * Example: return new RawResponse({ custom: 'shape' });
 */
export class RawResponse<T> {
  constructor(public payload: T) {}
}

/**
 * Return this instance if you want to provide a custom message while still wrapping the response.
 * Example: return new MessageResponse(null, 'User berhasil dihapus');
 */
export class MessageResponse<T> {
  constructor(
    public payload: T,
    public message: string,
  ) {}
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, unknown> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((result: unknown) => {
        const statusCode = response.statusCode;

        // Totally bypass wrapping for StreamableFile (used for file downloads)
        if (result instanceof StreamableFile) return result;

        // Explicitly bypass wrapping
        if (result instanceof RawResponse) {
          return (result as RawResponse<unknown>).payload;
        }

        // Pagination
        if (result instanceof Paginated) {
          return {
            statusCode,
            message: 'Success',
            data: result.data,
            meta: result.meta,
            timestamp: new Date().toISOString(),
          };
        }

        // Custom message
        if (result instanceof MessageResponse) {
          return {
            statusCode,
            message: (result as MessageResponse<unknown>).message,
            data: (result as MessageResponse<unknown>).payload,
            timestamp: new Date().toISOString(),
          };
        }

        // Standard response
        return {
          statusCode,
          message: 'Success',
          data: result,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
