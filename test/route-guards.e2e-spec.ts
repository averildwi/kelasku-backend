import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
  Reflector,
} from '@nestjs/core';
import { DECORATORS } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import type { RoleName } from '../src/common/types/auth-user';
import { PrismaService } from '../src/prisma/prisma.service';

type Handler = (...args: unknown[]) => unknown;

/** The Swagger prefix the guards imply (nest-architecture rule 12). */
function expectedPrefix(guards: unknown[], roles: RoleName[] | undefined) {
  if (!guards.includes(JwtAuthGuard)) return '[PUBLIC]';
  return roles?.length ? `[${roles.join('/')}]` : '[AUTH]';
}

/**
 * Per-route guards fail open: a forgotten @UseGuards leaves a route public
 * without any error. This test makes that visible. Every route in AppModule
 * must carry the summary prefix its guards imply, so an unguarded route has to
 * be labeled [PUBLIC] on purpose.
 */
describe('Route guards (meta)', () => {
  it('every route has guards that match its Swagger prefix', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    })
      // Only metadata is read, so no database connection is needed.
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    const discovery = moduleRef.get(DiscoveryService);
    const scanner = moduleRef.get(MetadataScanner);
    const reflector = moduleRef.get(Reflector);
    const problems: string[] = [];
    let routes = 0;

    for (const { metatype, instance } of discovery.getControllers()) {
      if (!metatype || !instance) continue;
      const prototype = Object.getPrototypeOf(instance) as Record<
        string,
        Handler
      >;
      for (const name of scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name];
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        routes += 1;
        const where = `${metatype.name}.${name}`;
        const targets = [handler, metatype];
        const guards = reflector.getAllAndMerge<unknown[]>(
          GUARDS_METADATA,
          targets,
        );
        const roles = reflector.getAllAndOverride<RoleName[] | undefined>(
          ROLES_KEY,
          targets,
        );
        const operation = reflector.get<
          { summary?: string; description?: string } | undefined
        >(DECORATORS.API_OPERATION, handler);
        const prefix = expectedPrefix(guards, roles);

        if (!operation?.summary?.startsWith(`${prefix} `)) {
          problems.push(
            `${where}: summary must start with "${prefix} ", got "${operation?.summary ?? ''}"`,
          );
        }
        if (roles?.length && !guards.includes(RolesGuard)) {
          problems.push(`${where}: @Roles without RolesGuard is not enforced`);
        }
        if (roles?.length && !guards.includes(JwtAuthGuard)) {
          problems.push(
            `${where}: @Roles without JwtAuthGuard always answers 401`,
          );
        }
        // A [PUBLIC] route guarded by something else (webhook secret, OAuth) says so.
        if (
          prefix === '[PUBLIC]' &&
          guards.length > 0 &&
          !operation?.description
        ) {
          problems.push(
            `${where}: non-JWT guard on a [PUBLIC] route needs a description`,
          );
        }
      }
    }

    expect(routes).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});
