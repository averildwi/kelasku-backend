import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingOtpSender, createApp } from './utils/test-app.factory';

let sequence = 0;
const uniqueEmail = () => `cls-${Date.now()}-${++sequence}@example.com`;

interface Registered {
  email: string;
  password: string;
  token: string;
}

describe('Classrooms membership (e2e, real database)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let otp: CapturingOtpSender;
  let http: App;
  const classroomIds: string[] = [];

  beforeAll(async () => {
    ({ app, otp } = await createApp());
    prisma = app.get(PrismaService);
    http = app.getHttpServer();
  });

  afterAll(async () => {
    // Classrooms first: homeroomTeacherId is a Restrict foreign key.
    await prisma.classroom.deleteMany({ where: { id: { in: classroomIds } } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: '@example.com' } },
    });
    await app.close();
  });

  async function registerVerified(
    globalRole: 'WALI_KELAS' | 'MURID',
  ): Promise<Registered> {
    const email = uniqueEmail();
    const password = 'correct horse';
    await request(http)
      .post('/api/auth/register')
      .send({ name: 'Test User', email, password, globalRole })
      .expect(201);
    const res = await request(http)
      .post('/api/auth/verify-otp')
      .send({ email, code: otp.lastCodeFor(email) })
      .expect(200);
    return {
      email,
      password,
      token: (res.body as { data: { accessToken: string } }).data.accessToken,
    };
  }

  it('lets exactly one of two parallel joins take the last seat (BR-12)', async () => {
    const wali = await registerVerified('WALI_KELAS');
    const created = await request(http)
      .post('/api/classrooms')
      .set('Authorization', `Bearer ${wali.token}`)
      .send({ name: 'Race Class', maxStudents: 1 })
      .expect(201);
    const classroom = (created.body as { data: { id: string; code: string } })
      .data;
    classroomIds.push(classroom.id);

    const [studentA, studentB] = await Promise.all([
      registerVerified('MURID'),
      registerVerified('MURID'),
    ]);

    const join = (token: string) =>
      request(http)
        .post('/api/classrooms/join')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: classroom.code });

    const [a, b] = await Promise.all([
      join(studentA.token),
      join(studentB.token),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 403]);
    const active = await prisma.classMember.count({
      where: { classId: classroom.id, isActive: true },
    });
    expect(active).toBe(1);
  });
});
