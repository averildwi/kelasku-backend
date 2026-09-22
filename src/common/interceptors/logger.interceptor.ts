import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap, catchError, throwError } from 'rxjs';

@Injectable()
export class LoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, originalUrl, ip } = request;
    const start = Date.now();

    this.logger.log(`--> ${method} ${originalUrl}`);

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        const duration = Date.now() - start;
        this.logger.log(
          `<-- ${method} ${originalUrl} ${response.statusCode} +${duration}ms`,
        );
      }),
      catchError((err) => {
        const duration = Date.now() - start;
        const status = err?.status ?? err?.getStatus?.() ?? 500;
        this.logger.warn(
          `<-x ${method} ${originalUrl} ${status} +${duration}ms — ${err?.message ?? 'Unknown error'} (ip: ${ip})`,
        );
        
        return throwError(() => err);
      }),
    );
  }
}
