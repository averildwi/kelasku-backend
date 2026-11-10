# Folder Structure — KelasKu

> Derived from the finalized `PRD.md`, `DATA_MODEL.md` and `API_SPEC.md` (post-audit). The old draft is archived as `FOLDER_STRUCTURE.draft-v1.md` (it described refresh tokens, `@Public()`, a Socket.IO gateway and `api/v1` — all superseded).

Skills are the source of truth for conventions; this file only lays out WHERE files go. Infrastructure shared by features lives in `src/common/<kind>/` (`nest-architecture` rules 1+5); features live in `src/<feature>/` with plural kebab-case folders (rule 2); project env in `src/config/env.schema.ts`.

```
kelasku-backend/
├── docs/
│   ├── PRD.md                          finalized spec
│   ├── DATA_MODEL.md                   finalized schema draft
│   ├── API_SPEC.md                     finalized endpoint spec
│   ├── SPEC_AUDIT.md / SPEC_AUDIT_V2.md   audit rounds
│   ├── PRD.draft-v1.md / FOLDER_STRUCTURE.draft-v1.md   archived drafts (reference only)
│   └── (later) IMPLEMENTATION_PLAN.md
├── generated/prisma/                   prisma client output — never edited
├── prisma/
│   ├── schema.prisma                   per DATA_MODEL.md (+ partial indexes via migration SQL)
│   ├── migrations/
│   └── seed.ts                         optional; no default passwords (skill rule 15)
├── src/
│   ├── main.ts                         wiring per nest-architecture rule 10 (trust proxy, api prefix, CORS, pipes, interceptors, filters, Swagger)
│   ├── app.module.ts                   imports: PrismaModule, AppConfigModule.forProject(projectEnvSchema), HashingModule, MailModule, ThrottlerModule.forRoot, AuthModule, feature modules; providers: [ThrottlerGuard as APP_GUARD]
│   │
│   ├── common/                         existing scaffolds + additions below
│   │   ├── config/{app-config.module.ts, base-env.schema.ts}          (ada)
│   │   ├── decorators/{current-user.decorator.ts, roles.decorator.ts} (ada)
│   │   ├── dto/pagination.dto.ts                                      (ada)
│   │   ├── filters/{global-exception.filter.ts, prisma-exception.filter.ts} (ada)
│   │   ├── guards/{jwt-auth.guard.ts, roles.guard.ts}                 (ada, dipakai per-route)
│   │   ├── hashing/{hashing.module.ts, hashing.service.ts}            (ada)
│   │   ├── helpers/{error-response.helper.ts, paginate.helper.ts}     (ada)
│   │   ├── interceptors/{logger.interceptor.ts, transform.interceptor.ts} (ada)
│   │   ├── pipes/validation.pipe.config.ts                            (ada)
│   │   ├── mail/                        otp sender port + adapters (from the auth reference)
│   │   ├── notifications/               shared push sender (decided: common, not a feature module)
│   │   │   ├── notifications.module.ts  @Global()
│   │   │   ├── firebase.service.ts      firebase-admin messaging wrapper
│   │   │   └── push-sender.service.ts   sendToUsers(userIds, payload) + NotificationLog claim (BR-16)
│   │   ├── upload/                      Cloudinary
│   │   │   ├── upload.module.ts         @Global()
│   │   │   └── storage.service.ts       upload/delete for whiteboard images + proof images
│   │   ├── helpers/                     additions:
│   │   │   ├── class-code.helper.ts     6-char unambiguous code generator (BR-6)
│   │   │   └── date.helper.ts           Asia/Jakarta helpers (todayWib, tomorrowDayOfWeek)
│   │   ├── types/auth-user.ts           (ada; dirubah sesuai rule 24: GlobalRole, UserId, AuthUser)
│   │   └── config/env additions         none — see src/config/
│   │
│   ├── config/
│   │   └── env.schema.ts                projectEnvSchema: OTP_*, RESEND_API_KEY, MAIL_FROM, CLOUDINARY_URL, FIREBASE_*, TZ
│   ├── prisma/                          (ada) PrismaModule + PrismaService
│   │
│   ├── auth/                            from the reference implementation (copy, don't rewrite)
│   │   ├── auth.module.ts / auth.controller.ts / auth.service.ts
│   │   ├── strategies/jwt.strategy.ts
│   │   ├── otp/otp.service.ts
│   │   ├── decorators/auth-fields.decorator.ts
│   │   ├── dto/{login,register,verify-otp,request-code,reset-password,change-password}.dto.ts
│   │   └── auth.service.spec.ts
│   │
│   ├── users/
│   │   ├── users.module.ts / users.controller.ts / users.service.ts
│   │   ├── dto/update-profile.dto.ts
│   │   └── users.service.spec.ts
│   │
│   ├── classrooms/                      F-CLASS-1..6 (+ member management lives here)
│   │   ├── classrooms.module.ts
│   │   ├── classrooms.controller.ts     create, list, detail, update, regenerate-code
│   │   ├── classrooms.service.ts        code generation, quota checks (BR-4/5/6)
│   │   ├── members.controller.ts        join, leave, list, inactive list, kick, restore, assign-role
│   │   ├── members.service.ts           BR-1/2/3/7/8/12 transactions + row locks
│   │   ├── dto/{create,update,join}-classroom.dto.ts, kick-member.dto.ts, assign-role.dto.ts, query-member.dto.ts
│   │   └── *.service.spec.ts            join race (BR-12), assign-role (BR-1), kick (BR-7/8)
│   │
│   ├── announcements/                   F-ANN-1/2
│   │   ├── announcements.{module,controller,service}.ts
│   │   ├── dto/{create,update,query}-announcement.dto.ts
│   │   └── announcements.service.spec.ts (BR-9/10)
│   │
│   ├── subjects/                        F-SUBJ-1
│   │   ├── subjects.{module,controller,service}.ts
│   │   ├── dto/{create,update}-subject.dto.ts
│   │   └── subjects.service.spec.ts
│   │
│   ├── lesson-schedules/                F-SCHED-1
│   │   ├── lesson-schedules.{module,controller,service}.ts
│   │   ├── dto/{create,replace-day,query}-lesson-schedule.dto.ts
│   │   └── lesson-schedules.service.spec.ts (BR-11/11b)
│   │
│   ├── whiteboards/                     F-WB-1
│   │   ├── whiteboards.{module,controller,service}.ts   FilesInterceptor('images', 5)
│   │   ├── dto/{create,update,query}-whiteboard.dto.ts
│   │   └── whiteboards.service.spec.ts  (BR-13)
│   │
│   ├── pickets/                         F-PICKET-1/2
│   │   ├── pickets.{module,controller,service}.ts
│   │   ├── pickets.scheduler.ts         @Cron('0 18 * * *', { timeZone: 'Asia/Jakarta' }) → push-sender
│   │   ├── dto/replace-picket-day.dto.ts
│   │   └── pickets.service.spec.ts      (BR-16 idempotency)
│   │
│   ├── polls/                           F-POLL-1 (REST only, no gateway)
│   │   ├── polls.{module,controller,service}.ts
│   │   ├── dto/{create-poll,vote,query-poll}.dto.ts
│   │   └── polls.service.spec.ts        (BR-14)
│   │
│   ├── cash-transactions/               F-CASH-1
│   │   ├── cash-transactions.{module,controller,service}.ts
│   │   ├── dto/{create,void,query}-cash-transaction.dto.ts
│   │   └── cash-transactions.service.spec.ts (BR-15)
│   │
│   ├── cash-dues/                       F-CASH-2
│   │   ├── cash-dues.{module,controller,service}.ts
│   │   ├── dto/{create-due,query-due}.dto.ts
│   │   └── cash-dues.service.spec.ts    (pay/unpay transaction, computed UNPAID)
│   │
│   ├── devices/                         F-NOTIF-1
│   │   ├── devices.{module,controller,service}.ts
│   │   └── dto/register-device.dto.ts
│   │
│   └── notifications/                   F-NOTIF-1 (inbox only; sending is in common/notifications)
│       ├── notifications.{module,controller,service}.ts
│       ├── dto/query-notification.dto.ts
│       └── notifications.service.spec.ts (BR-16 claim)
│
└── test/
    ├── jest-e2e.json                    (ada)
    ├── route-guards.e2e-spec.ts         REQUIRED meta-test (skill rule 4)
    ├── auth.e2e-spec.ts
    ├── classrooms.e2e-spec.ts           incl. parallel-join race (BR-12)
    └── utils/test-app.factory.ts        bootstrap + DB reset for e2e
```

## Key rules recap (details live in the skills)

- **Guards**: per controller/handler `@UseGuards(JwtAuthGuard, RolesGuard)` + `@ApiBearerAuth('access-token')`; `[PUBLIC]`/`[AUTH]`/`@Roles` prefixes; **no global auth guard, no `@Public()`**. Meta-test mandatory.
- **JWT**: payload `{ sub, email, tv }`; `request.user` is `AuthUser`; role read from DB per request. No refresh tokens.
- **Per-class roles**: service-level checks (`ForbiddenException`), Swagger prefix lists app-wide roles only.
- **Realtime**: none. Polling results are plain REST (`GET`).
- **Routes**: `app.setGlobalPrefix('api')` — `/api/classrooms/...`, not `/api/v1/...`.
- **Transactions**: join/restore/kick/assign-role, due create/pay/unpay, vote replace, whiteboard create — all `$transaction`; partial indexes `one_active_membership`/`one_active_ketua`/`one_active_bendahara` applied via migration SQL.
- **No deletion** of classrooms; soft delete only where DATA_MODEL says; cash transactions are void-only.
- **Prisma**: explicit `select` everywhere, client imported by relative path (`../../generated/prisma/client`), list+count via `$transaction([...])`, no awaits in loops.
- **Env**: only via `ConfigService`; project vars in `src/config/env.schema.ts` + `.env.example`; `JWT_*` stays in the base schema.
