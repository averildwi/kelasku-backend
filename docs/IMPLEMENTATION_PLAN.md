# Implementation Plan — KelasKu

Build order derived from `PRD.md` (F-IDs), `DATA_MODEL.md`, `API_SPEC.md`, `SPEC_AUDIT_V2.md` (READY after the second fix round) and the skills. One commit per step, each with its code + DTOs + tests (+ migration when the schema changes). The agent executes step by step; each step ends with the verification commands from `git-workflow` rule 5–6.

> Branch discipline: the first step creates `feat/sprint-0-foundation` (never work on `main`). Later steps commit onto the branch in order; topic branches per step are optional — if used, they branch from the previous step.

## Step 0 — Scaffolds (DONE, do not redo)

Already committed on `main`: `82cbc0c` initial, `6c339a8` prisma scaffold, `76cf389` nest-common scaffold. `src/common/`, `src/prisma/`, `generated/prisma`, `prisma.config.ts` exist (auth preflight rule 24 passes).

## Step 1 — docs: commit the finalized specs

- **Branch**: `feat/sprint-0-foundation` (created from `main`)
- **Commit**: `docs(prd): add finalized prd, data model, api spec and audits`
- **Files**: `docs/PRD.md`, `docs/DATA_MODEL.md`, `docs/API_SPEC.md`, `docs/FOLDER_STRUCTURE.md`, `docs/SPEC_AUDIT.md`, `docs/SPEC_AUDIT_V2.md`, `docs/PRD.draft-v1.md`, `docs/FOLDER_STRUCTURE.draft-v1.md`
- **Delivers**: traceable baseline for every later step.
- **Tests**: none (docs only).
- **Verify**: lint not required (no TS touched); `git status` clean afterwards.

## Step 2 — feat(common): auth types + project env schema

- **Commit**: `refactor(common): type auth-user against the prisma global role enum`
- **Files**:
  - `src/common/types/auth-user.ts` — `RoleName = GlobalRole`, `UserId = string`, `JwtPayload { sub, email, tv }` (the three edits allowed by rule 24)
- **Commit 2**: `feat(config): add project env schema`
- **Files**: `src/config/env.schema.ts` (OTP_SENDER, RESEND_API_KEY, MAIL_FROM, OTP_TTL_MINUTES, OTP_RESEND_COOLDOWN_SECONDS, CLOUDINARY_URL, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, TZ), `.env.example` (same keys + `JWT_EXPIRES_IN="15m"` note; no secrets)
- **Delivers**: F-AUTH-* prerequisites, F-WB-1/F-NOTIF-1 config.
- **Tests**: `src/config/env.schema.spec.ts` (boot fails without required vars when the feature is on; console sender forbidden in production is covered in the mail step).
- **Verify**: `npx eslint "{src,apps,libs,test}/**/*.ts"`, `npm run test`.

## Step 3 — feat(prisma): full schema + first migration + partial indexes

- **Commit**: `feat(prisma): add kelasku schema with membership and office partial indexes`
- **Files**: `prisma/schema.prisma` (per `DATA_MODEL.md`: User, OtpCode, Classroom, ClassMember, Announcement, AnnouncementRead, Subject, LessonSchedule, WhiteboardNote, WhiteboardImage, PicketGroup, PicketMember, Poll, PollOption, PollVote, CashTransaction, CashDue, CashDuePayment, DeviceToken, Notification, NotificationLog), migration folder from `npx prisma migrate dev --name add_kelasku_schema`, plus the partial-index SQL appended into that migration:
  - `one_active_membership (userId) WHERE isActive`
  - `one_active_ketua (classId) WHERE role='KETUA' AND isActive`
  - `one_active_bendahara (classId) WHERE role='BENDAHARA' AND isActive`
  Then `npx prisma generate` (Prisma 7 does not regenerate on migrate).
- **Delivers**: BR-2/BR-1 backstops, all entities.
- **Tests**: none beyond compile; schema correctness is exercised by later service specs.
- **Verify**: `npx prisma generate`, `npm run build`, lint, `npm run test`.
- **Risk / needs user**: `prisma migrate dev` requires a reachable PostgreSQL. If Prisma prompts to reset or refuses, STOP and report (rule 15 — no workarounds). If no DB is available, commit the schema only and report "migration not created".
- **Also in this commit**: `package.json` jest `moduleNameMapper` for `.js` imports if missing (nest-testing rule 11) — otherwise its own commit first.

## Step 4 — feat(common): mail port (OTP sender)

- **Commit**: `feat(common): add otp sender port with resend and console adapters`
- **Files**: `src/common/mail/otp-sender.ts`, `resend-otp-sender.ts`, `console-otp-sender.ts`, `mail.module.ts`; `app.module.ts` (import MailModule)
- **Delivers**: F-AUTH-1/3 transport.
- **Tests**: `console-otp-sender` refuses production (inline spec or covered in env spec).

## Step 5 — feat(auth): core (login / me / change-password / logout-all) + JWT strategy

- **Commit**: `feat(auth): add core login and session endpoints with token version revocation`
- **Files** (copy from the reference implementation, do not rewrite): `src/auth/auth.module.ts`, `strategies/jwt.strategy.ts`, `auth.service.ts` (core methods only), `auth.controller.ts` (login, me, change-password, logout-all), `dto/login.dto.ts`, `dto/change-password.dto.ts`; `app.module.ts` (ThrottlerModule.forRoot + APP_GUARD ThrottlerGuard + AuthModule)
- **Delivers**: F-AUTH-2/3/4 (core), BR-18 baseline (email normalize comes with register).
- **Tests**: `src/auth/strategies/jwt.strategy.spec.ts`, `src/auth/auth.service.spec.ts` (dummy-hash login, identical 401 bodies, status after password, tv bump on change/logout-all).
- **Note**: `DEFAULT_ROLE` from the reference is **dropped**; register arrives in step 6 (both self-registration roles get a token on verify — PRD assumption 6).

## Step 6 — feat(auth): register + OTP flows

- **Commit**: `feat(auth): add register with email verification and password reset otp`
- **Files**: `src/auth/otp/otp.service.ts`, `decorators/auth-fields.decorator.ts`, `dto/{register,verify-otp,request-code,reset-password}.dto.ts`, extend `auth.service.ts` + `auth.controller.ts` (register, verify-otp, resend-otp, forgot-password, reset-password)
- **Delivers**: F-AUTH-1, F-AUTH-3 (reset), BR-17, BR-18; `verify-otp` issues a token for both roles (documented deviation).
- **Tests**: `src/auth/otp/otp.service.spec.ts` (20 parallel guesses → ≤ 5 compares; parallel correct → exactly one success; cooldown; silent send failure).

## Step 7 — test: route-guards meta-test + auth e2e

- **Commit**: `test(auth): add route guards meta-test and auth e2e coverage`
- **Files**: `test/route-guards.e2e-spec.ts` (from test-recipes.md, required), `test/auth.e2e-spec.ts`, `test/utils/test-app.factory.ts`, `test/jest-e2e.json` update if needed, `package.json` script `test:e2e` with `node --experimental-vm-modules`
- **Delivers**: the fail-open brake for every later controller.
- **Verify**: e2e needs a real PostgreSQL (recipe note). If no DB is available, unit specs still gate the commit and e2e is flagged "deferred, needs DB".

## Step 8 — feat(users): profile

- **Commit**: `feat(users): add profile update endpoint`
- **Files**: `src/users/users.module.ts`, `users.controller.ts`, `users.service.ts`, `dto/update-profile.dto.ts`, `app.module.ts`; spec.
- **Delivers**: F-AUTH-4.

## Step 9 — feat(classrooms): class management

- **Commit**: `feat(classrooms): add classroom create list detail update and code regeneration`
- **Files**: `src/classrooms/classrooms.module.ts`, `classrooms.controller.ts`, `classrooms.service.ts`, `dto/{create-classroom,update-classroom,query-classroom}.dto.ts`, `src/common/helpers/class-code.helper.ts` (BR-6), spec (`code alphabet/length, uniqueness retry, quota BR-4`).
- **Delivers**: F-CLASS-1, BR-4/5/6.

## Step 10 — feat(classrooms): membership lifecycle

- **Commit**: `feat(classrooms): add join leave kick restore and assign role with row locking`
- **Files**: `src/classrooms/members.controller.ts`, `members.service.ts`, `dto/{join-classroom,kick-member,assign-role,query-member}.dto.ts`, spec (BR-1 demote-in-transaction, BR-2/3 errors, BR-7 soft kick, BR-8 role revert, 409 invalid states incl. restore-of-LEFT).
- **Delivers**: F-CLASS-2..6, BR-1/2/3/7/8.
- **Also**: e2e parallel-join race test (BR-12) in `test/classrooms.e2e-spec.ts` (needs DB; defer like step 7 if not).

## Step 11 — feat(announcements)

- **Commit**: `feat(announcements): add announcement crud with read receipts`
- **Files**: module/controller/service, `dto/{create,update,query}-announcement.dto.ts`, spec (BR-9 ownership, BR-10 idempotent receipts + stats vs active members).
- **Delivers**: F-ANN-1, F-ANN-2, BR-9/10. (Push fan-out wired in step 13 via event emission — emit from step 13 on, no dependency now.)

## Step 12 — feat(subjects) + feat(lesson-schedules)

- **Commit**: `feat(subjects): add subject crud with soft delete`
- **Files**: module/controller/service, DTOs, spec.
- **Commit 2**: `feat(lesson-schedules): add weekly schedule with overlap validation`
- **Files**: module/controller/service, `dto/{create,replace-day,query}-lesson-schedule.dto.ts`, spec (BR-11 start<end, overlap 409, replace-day transaction).
- **Delivers**: F-SUBJ-1, F-SCHED-1, BR-11/11b.

## Step 13 — feat(common): push infrastructure + devices + inbox

- **Commit**: `feat(common): add firebase push sender with notification log claim`
- **Files**: `src/common/notifications/{notifications.module.ts, firebase.service.ts, push-sender.service.ts}`; spec for the BR-16 claim (parallel send → one inbox row + one log row).
- **Commit 2**: `feat(devices): add fcm device token registration`
- **Files**: `src/devices/{devices.module.ts,devices.controller.ts,devices.service.ts}`, `dto/register-device.dto.ts`, spec (upsert reassignment).
- **Commit 3**: `feat(notifications): add in-app notification inbox`
- **Files**: `src/notifications/{notifications.module.ts,notifications.controller.ts,notifications.service.ts}`, `dto/query-notification.dto.ts`, spec (unread filter, read-all).
- **Delivers**: F-NOTIF-1, BR-16 infrastructure; PRD assumption 4 (log covers announcement/poll/due/picket pushes).

## Step 14 — feat(whiteboards) (needs Cloudinary)

- **Commit**: `feat(common): add cloudinary storage service`
- **Files**: `src/common/upload/{upload.module.ts, storage.service.ts}`, spec (folder `kelasku/<classId>/whiteboard`, delete best-effort logging without swallowing).
- **Commit 2**: `feat(whiteboards): add whiteboard note upload with image validation`
- **Files**: `src/whiteboards/{whiteboards.module.ts,whiteboards.controller.ts,whiteboards.service.ts}`, `dto/{create,update,query}-whiteboard.dto.ts`, spec (BR-13: file count/mime/size/date validation; uploader-only update; uploader/KETUA/wali delete; $transaction create).
- **Delivers**: F-WB-1.

## Step 15 — feat(pickets) + H-1 cron

- **Commit**: `feat(pickets): add weekly duty groups with h1 reminder cron`
- **Files**: `src/pickets/{pickets.module.ts,pickets.controller.ts,pickets.service.ts,pickets.scheduler.ts}`, `dto/replace-picket-day.dto.ts`, spec (replace-day, days: number[] for /me; cron calls push-sender with NotificationLog claim).
- **Delivers**: F-PICKET-1, F-PICKET-2, BR-16.

## Step 16 — feat(polls)

- **Commit**: `feat(polls): add polls with vote replace and close`
- **Files**: `src/polls/{polls.module.ts,polls.controller.ts,polls.service.ts}`, `dto/{create-poll,vote,query-poll}.dto.ts`, spec (BR-14: closed 403, wali cannot vote, re-vote delete+create in one transaction, anonymous hides voters).
- **Delivers**: F-POLL-1.

## Step 17 — feat(cash): transactions

- **Commit**: `feat(cash-transactions): add cash ledger with void instead of delete`
- **Files**: `src/cash-transactions/{cash-transactions.module.ts,cash-transactions.controller.ts,cash-transactions.service.ts}`, `dto/{create,void,query}-cash-transaction.dto.ts`, spec (BR-15: amount validation, void keeps row, bendahara-only writes, summary balance).
- **Delivers**: F-CASH-1.

## Step 18 — feat(cash): dues & payments

- **Commit**: `feat(cash-dues): add dues with payment status and linked ledger entries`
- **Files**: `src/cash-dues/{cash-dues.module.ts,cash-dues.controller.ts,cash-dues.service.ts}`, `dto/{create-due,query-due}.dto.ts`, spec (snapshot createMany; pay creates linked INCOME in one transaction; unpay voids it; computed UNPAID for late joiners; 409 invalid states).
- **Delivers**: F-CASH-2, BR-15.

## Step 19 — final pass

- **Commit**: `docs(readme): document environment variables and setup`
- **Files**: `README.md` (env vars table, setup, test commands), remove the stale `app.controller.ts`/`app.service.ts` hello-world if unused (`refactor(app): remove hello world scaffold` as its own commit).
- **Verify (whole project)**: `npx eslint "{src,apps,libs,test}/**/*.ts"`, `npm run test`, `npm run build`, and (DB available) `npm run test:e2e` including the parallel-join race and the meta-test.
- **Delivers**: release readiness for the MVP feature set (F-CLASS..F-NOTIF).

## Deferred (out of scope per brief)

Refresh tokens, Google login, WebSocket, assignments/forums/attendance/exports, classroom deletion. Fase-2 candidates live in `PRD.md` §10.

## Checklist

| Step | Status |
|---|---|
| 1 docs baseline | todo |
| 2 auth types + env schema | todo |
| 3 prisma schema + migration | todo |
| 4 mail port | todo |
| 5 auth core | todo |
| 6 auth register + OTP | todo |
| 7 route-guards meta-test + e2e | todo |
| 8 users profile | todo |
| 9 classrooms management | todo |
| 10 classrooms membership | todo |
| 11 announcements | todo |
| 12 subjects + lesson-schedules | todo |
| 13 push infra + devices + inbox | todo |
| 14 whiteboards (+ cloudinary) | todo |
| 15 pickets + cron | todo |
| 16 polls | todo |
| 17 cash transactions | todo |
| 18 cash dues | todo |
| 19 final pass + README | todo |
