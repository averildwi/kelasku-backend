import { Controller, INestApplication, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { OtpService } from '../src/auth/otp/otp.service';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PrismaExceptionFilter } from '../src/common/filters/prisma-exception.filter';
import { HashingService } from '../src/common/hashing/hashing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingOtpSender, createApp } from './utils/test-app.factory';

let ipCounter = 0;
/** A fresh client IP per test, so the strict auth limits of one test do not hit the next. */
const nextIp = () => `203.0.113.${++ipCounter}`;
const uniqueEmail = () =>
  `user-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

describe('Auth (e2e, real database)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let otp: CapturingOtpSender;
  let http: App;

  beforeAll(async () => {
    ({ app, otp } = await createApp());
    // The tests play the role of one proxy that sets X-Forwarded-For.
    app.set('trust proxy', 1);
    prisma = app.get(PrismaService);
    http = app.getHttpServer();
  });
  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { endsWith: '@example.com' } },
    });
    await app.close();
  });

  /** register -> code from the captured sender -> verify; returns the token. */
  async function registerVerified(
    email = uniqueEmail(),
    password = 'correct horse',
    globalRole: 'WALI_KELAS' | 'MURID' = 'MURID',
  ) {
    const ip = nextIp();
    await request(http)
      .post('/api/auth/register')
      .set('X-Forwarded-For', ip)
      .send({ name: 'Test User', email, password, globalRole })
      .expect(201);
    const res = await request(http)
      .post('/api/auth/verify-otp')
      .set('X-Forwarded-For', ip)
      .send({ email, code: otp.lastCodeFor(email) })
      .expect(200);
    return {
      email,
      password,
      token: (res.body as { data: { accessToken: string } }).data.accessToken,
    };
  }

  const me = (token: string) =>
    request(http).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  const login = (email: string, password: string, ip = nextIp()) =>
    request(http)
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email, password });

  it('login returns data.accessToken in the body and no token in a header or URL', async () => {
    const { email, password } = await registerVerified();
    const res = await login(email, password).expect(200);
    const body = res.body as { message: string; data: { accessToken: string } };
    expect(body.message).toBe('Login successful');
    expect(typeof body.data.accessToken).toBe('string');
    expect(res.headers.location).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
    await me(body.data.accessToken).expect(200);
  });

  it('answers an unknown email and a wrong password identically', async () => {
    const { email } = await registerVerified();
    const strip = (b: Record<string, unknown>) => ({
      ...b,
      timestamp: undefined,
    });
    const unknown = await login('nobody@example.com', 'whatever1');
    const wrong = await login(email, 'whatever1');
    expect(unknown.status).toBe(401);
    expect(strip(unknown.body as Record<string, unknown>)).toEqual(
      strip(wrong.body as Record<string, unknown>),
    );
  });

  it('answers forgot-password the same for a known and an unknown email', async () => {
    const { email } = await registerVerified();
    const ip = nextIp();
    const a = await request(http)
      .post('/api/auth/forgot-password')
      .set('X-Forwarded-For', ip)
      .send({ email });
    const b = await request(http)
      .post('/api/auth/forgot-password')
      .set('X-Forwarded-For', ip)
      .send({ email: 'nobody@example.com' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect((a.body as { message: string }).message).toBe(
      (b.body as { message: string }).message,
    );
  });

  it('rejects the old token after a password reset (tokenVersion)', async () => {
    const { email, token } = await registerVerified();
    await me(token).expect(200);
    const ip = nextIp();
    await request(http)
      .post('/api/auth/forgot-password')
      .set('X-Forwarded-For', ip)
      .send({ email })
      .expect(200);
    await request(http)
      .post('/api/auth/reset-password')
      .set('X-Forwarded-For', ip)
      .send({
        email,
        code: otp.lastCodeFor(email),
        newPassword: 'brand new pass',
      })
      .expect(200);
    await me(token).expect(401);
    await login(email, 'brand new pass').expect(200);
  });

  it('change-password keeps this device (new token) and logs out the others', async () => {
    const { email, password, token: other } = await registerVerified();
    const res = await request(http)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${other}`)
      .send({ currentPassword: password, newPassword: 'another pass 1' })
      .expect(200);
    await me(other).expect(401);
    await me(
      (res.body as { data: { accessToken: string } }).data.accessToken,
    ).expect(200);
    await login(email, 'another pass 1').expect(200);
  });

  it('logout-all ends every token of the user', async () => {
    const { token } = await registerVerified();
    await request(http)
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await me(token).expect(401);
  });

  it('a disabled user is rejected at once, and a role change applies on the next request', async () => {
    const { email, token } = await registerVerified();
    await me(token).expect(200);

    await prisma.user.update({
      where: { email },
      data: { globalRole: 'WALI_KELAS' },
    });
    const res = await me(token).expect(200);
    expect((res.body as { data: { globalRole: string } }).data.globalRole).toBe(
      'WALI_KELAS',
    );

    await prisma.user.update({ where: { email }, data: { isActive: false } });
    await me(token).expect(401);
  });

  it('register never replaces the password of an existing unverified account', async () => {
    const email = uniqueEmail();
    const ip = nextIp();
    await request(http)
      .post('/api/auth/register')
      .set('X-Forwarded-For', ip)
      .send({
        name: 'Victim',
        email,
        password: 'victim pass 1',
        globalRole: 'MURID',
      })
      .expect(201);
    const before = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { passwordHash: true },
    });
    await request(http)
      .post('/api/auth/register')
      .set('X-Forwarded-For', ip)
      .send({
        name: 'Attacker',
        email,
        password: 'attacker pass',
        globalRole: 'MURID',
      })
      .expect(409);
    const after = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { passwordHash: true },
    });
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it('rejects an extra body field (whitelist + DTO)', async () => {
    const email = uniqueEmail();
    const res = await request(http)
      .post('/api/auth/register')
      .set('X-Forwarded-For', nextIp())
      .send({
        name: 'Test User',
        email,
        password: 'correct horse',
        globalRole: 'MURID',
        role: 'ADMIN',
      })
      .expect(400);
    expect((res.body as { message: string[] }).message).toEqual([
      'role: property role should not exist',
    ]);
  });

  it('/auth/me never returns passwordHash or tokenVersion', async () => {
    const { token } = await registerVerified();
    const res = await me(token).expect(200);
    const data = (res.body as { data: Record<string, unknown> }).data;
    expect(Object.keys(data).sort()).toEqual([
      'createdAt',
      'email',
      'emailVerifiedAt',
      'globalRole',
      'id',
    ]);
  });

  it('OTP on PostgreSQL: 20 parallel wrong guesses spend exactly MAX attempts; a correct code is consumed once', async () => {
    const { email } = await registerVerified();
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    const service = app.get(OtpService);
    const hashing = app.get(HashingService);
    const make = async (code: string) =>
      prisma.otpCode.create({
        data: {
          userId: user.id,
          purpose: 'PASSWORD_RESET',
          codeHash: await hashing.hash(code),
          expiresAt: new Date(Date.now() + 60_000),
        },
        select: { id: true },
      });

    const wrong = await make('111111');
    const guesses = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        service.consume(user.id, 'PASSWORD_RESET', '000000', () =>
          Promise.resolve(true),
        ),
      ),
    );
    expect(guesses.every((g) => g.status === 'rejected')).toBe(true);
    const row = await prisma.otpCode.findUniqueOrThrow({
      where: { id: wrong.id },
      select: { attempts: true },
    });
    expect(row.attempts).toBe(5);

    await prisma.otpCode.updateMany({
      where: { userId: user.id },
      data: { usedAt: new Date() },
    });
    await make('222222');
    let successes = 0;
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        service.consume(user.id, 'PASSWORD_RESET', '222222', () => {
          successes += 1;
          return Promise.resolve(true);
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(successes).toBe(1);
  });
});

describe('Throttling and trust proxy (e2e)', () => {
  let app: NestExpressApplication;
  afterEach(async () => {
    await app.close();
  });

  const attempt = (a: INestApplication, xff?: string) => {
    const r = request(a.getHttpServer() as App).post('/api/auth/login');
    if (xff) r.set('X-Forwarded-For', xff);
    return r.send({ email: 'nobody@example.com', password: 'whatever1' });
  };

  it('answers the 6th login within a minute with 429', async () => {
    ({ app } = await createApp());
    for (let i = 0; i < 5; i++) expect((await attempt(app)).status).toBe(401);
    expect((await attempt(app)).status).toBe(429);
  });

  it('trust proxy 0: a forged X-Forwarded-For does not buy a fresh bucket', async () => {
    ({ app } = await createApp());
    app.set('trust proxy', 0);
    for (let i = 0; i < 5; i++) await attempt(app, `198.51.100.${i}`);
    expect((await attempt(app, '198.51.100.99')).status).toBe(429);
  });

  it('trust proxy 1: one client is limited without locking out another', async () => {
    ({ app } = await createApp());
    app.set('trust proxy', 1);
    for (let i = 0; i < 5; i++) await attempt(app, '198.51.100.7');
    expect((await attempt(app, '198.51.100.7')).status).toBe(429);
    expect((await attempt(app, '198.51.100.8')).status).toBe(401);
  });
});

describe('CORS with a configured FRONTEND_URL (e2e)', () => {
  it('allows the configured origin and rejects another', async () => {
    const { app } = await createApp();
    const allowed = await request(app.getHttpServer())
      .options('/api/auth/login')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST');
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );

    const evil = await request(app.getHttpServer())
      .options('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });
});

@Controller('test-duplicate')
class DuplicateController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  create() {
    return this.prisma.user.create({
      data: { name: 'Duplicate', email: DUPLICATE, globalRole: 'MURID' },
      select: { id: true },
    });
  }
}
const DUPLICATE = 'duplicate@example.com';

describe('Exception filter order (e2e)', () => {
  it.each([
    ['Global first, then Prisma (main.ts order)', 409, true],
    ['reversed', 500, false],
  ])('P2002 with filters %s -> %i', async (_name, expected, mainTsOrder) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DuplicateController],
      providers: [PrismaService],
    }).compile();
    const app = moduleRef.createNestApplication();
    const filters = [new GlobalExceptionFilter(), new PrismaExceptionFilter()];
    app.useGlobalFilters(...(mainTsOrder ? filters : filters.reverse()));
    await app.init();
    const prisma = app.get(PrismaService);
    await prisma.user.deleteMany({ where: { email: DUPLICATE } });

    await request(app.getHttpServer() as App)
      .post('/test-duplicate')
      .expect(201);
    const res = await request(app.getHttpServer() as App).post(
      '/test-duplicate',
    );
    expect(res.status).toBe(expected);

    await prisma.user.deleteMany({ where: { email: DUPLICATE } });
    await app.close();
  });
});
