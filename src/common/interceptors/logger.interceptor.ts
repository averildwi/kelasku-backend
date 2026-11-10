import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap, catchError, throwError } from 'rxjs';
import type { Request, Response } from 'express';

function getErrorStatus(err: unknown): number {
  if (typeof err === 'object' && err !== null) {
    const candidate = err as { status?: unknown; getStatus?: () => unknown };
    if (typeof candidate.status === 'number') return candidate.status;
    if (typeof candidate.getStatus === 'function') {
      const status = candidate.getStatus();
      if (typeof status === 'number') return status;
    }
  }
  return 500;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

@Injectable()
export class LoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, originalUrl, ip } = request;
    const start = Date.now();

    this.logger.log(`--> ${method} ${originalUrl}`);

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse<Response>();
        const duration = Date.now() - start;
        this.logger.log(
          `<-- ${method} ${originalUrl} ${response.statusCode} +${duration}ms`,
        );
      }),
      catchError((err: unknown) => {
        const duration = Date.now() - start;
        const status = getErrorStatus(err);
        this.logger.warn(
          `<-x ${method} ${originalUrl} ${status} +${duration}ms — ${getErrorMessage(err)} (ip: ${ip})`,
        );

        return throwError(() => err);
      }),
    );
  }
}
