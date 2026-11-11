# KelasKu Backend

Backend for **KelasKu**, a classroom-management app for Indonesian schools: one homeroom
teacher (**wali kelas**) manages a class of students — announcements with read receipts,
weekly lesson schedules, whiteboard photos for absent students, picket (cleaning) duty,
polls, and the class cash fund (transactions and per-member dues).

Built with [NestJS](https://nestjs.com/) 11, [Prisma](https://www.prisma.io/) 7 and
PostgreSQL. The Flutter client talks to a single REST API under `/api`.

The product spec lives in [`docs/`](./docs): [`PRD.md`](./docs/PRD.md),
[`DATA_MODEL.md`](./docs/DATA_MODEL.md), [`API_SPEC.md`](./docs/API_SPEC.md) and
[`FOLDER_STRUCTURE.md`](./docs/FOLDER_STRUCTURE.md). Coding conventions live in the project
skills under [`.opencode/skills/`](./.opencode/skills).

## Requirements

- Node.js 22+
- npm 10+
- PostgreSQL 14+ (a reachable database is required to run the app, run migrations and run the e2e suite)

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your local env file and fill in the values
cp .env.example .env

# 3. Create the schema (and Prisma client)
npx prisma migrate dev

# 4. Generate the Prisma client (Prisma 7 does not regenerate on migrate)
npx prisma generate
```

## Environment variables

Copy [`.env.example`](./.env.example) to `.env`. Every variable is validated at boot with
Joi (`src/common/config/base-env.schema.ts` + `src/config/env.schema.ts`); a missing or
invalid required value stops the app.

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | yes | — | PostgreSQL connection string, e.g. `postgresql://user:pass@localhost:5432/kelasku?schema=public`. |
| `PORT` | no | `3000` | HTTP port the server listens on. |
| `NODE_ENV` | no | `development` | One of `development`, `production`, `test`. |
| `FRONTEND_URL` | no | `*` | Comma-separated list of allowed CORS origins. Empty means no cross-origin access. Never set `*` in production. |
| `JWT_SECRET` | yes | — | Secret used to sign access tokens (min 16 chars). |
| `JWT_EXPIRES_IN` | no | `7d` | Access-token lifetime (e.g. `15m`, `7d`). |
| `TRUST_PROXY_HOPS` | no | `0` | Number of reverse proxies in front of the app (used to resolve the client IP for throttling). `0` when directly exposed. Never a boolean. |
| `OTP_SENDER` | no | `resend` | OTP delivery adapter: `resend` (real email) or `console` (prints codes to stdout; refuses to start in production). |
| `RESEND_API_KEY` | when `OTP_SENDER=resend` | — | [Resend](https://resend.com) API key. |
| `MAIL_FROM` | when `OTP_SENDER=resend` | — | From address for OTP emails, e.g. `KelasKu <no-reply@example.com>`. |
| `OTP_TTL_MINUTES` | no | `10` | OTP validity in minutes (1..60). |
| `OTP_RESEND_COOLDOWN_SECONDS` | no | `60` | Minimum seconds between two OTP sends to the same address. |
| `CLOUDINARY_URL` | yes | — | Cloudinary URL (`cloudinary://<key>:<secret>@<cloud>`); used for whiteboard photos and cash proof images. |
| `FIREBASE_PROJECT_ID` | yes | — | Firebase project id for FCM push notifications. |
| `FIREBASE_CLIENT_EMAIL` | yes | — | Firebase service-account client email. |
| `FIREBASE_PRIVATE_KEY` | yes | — | Firebase service-account private key (multiline, keep the `\n` escapes). |
| `TZ` | no | `Asia/Jakarta` | Timezone for scheduled jobs (picket H-1 reminder). |

No secrets are committed; `.env` is git-ignored.

## Run

```bash
# development (watch mode)
npm run start:dev

# production build + run
npm run build
npm run start:prod
```

Swagger UI is served at [`/docs`](http://localhost:3000/docs) (toggle **Authorize** and paste
the `accessToken` from `/api/auth/login` or `/api/auth/verify-otp`).

## Test

```bash
# unit tests
npm run test

# e2e tests (needs a reachable PostgreSQL via DATABASE_URL)
npm run test:e2e

# coverage
npm run test:cov

# lint (whole project)
npx eslint "{src,apps,libs,test}/**/*.ts"
```

The e2e suite includes the required route-guard meta-test (every route must carry a guard or
an explicit `[PUBLIC]` label) and the parallel-join race test (BR-12). On PostgreSQL + Prisma 7
the e2e runner needs `node --experimental-vm-modules`, which `npm run test:e2e` already sets.

## Project layout

```
src/
  main.ts                 app wiring (CORS, pipes, interceptors, filters, Swagger)
  app.module.ts           root module; registers every feature module
  common/                 shared infrastructure (config, guards, filters, mail, notifications, upload)
  prisma/                 PrismaModule + PrismaService
  config/env.schema.ts    project-specific Joi env schema
  auth/ users/ classrooms/ announcements/ subjects/ lesson-schedules/
  whiteboards/ pickets/ polls/ cash-transactions/ cash-dues/ devices/ notifications/
test/                     e2e specs + app factory
prisma/                   schema + migrations
docs/                     PRD, data model, API spec, implementation plan
```

## License

UNLICENSED — internal project.
