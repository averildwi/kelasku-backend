# API Spec — KelasKu

From `docs/PRD.md` (F-IDs, BR-IDs) and `docs/DATA_MODEL.md`. A coding agent implements this with the skills; the skills win over this file.

## Conventions

- **Envelope** → `nest-response-and-errors` (plain value / `MessageResponse` / `Paginated` / `RawResponse`; errors carry the reason phrase or a Prisma code in `error`).
- **Prefix & routes** → `nest-architecture` rule 12 (`[PUBLIC]` / `[AUTH]` / exact `@Roles` list; kebab-case plural under `/api`; state changes as `POST :id/<verb>` with `@HttpCode(200)`).
- **Auth endpoints** → `nest-auth-and-security` rule 21 (endpoint set, throttle values, `MessageResponse` for login, `accessToken` field name).
- **DTO rules** → `nest-validation-and-config` (DTO classes per body/query, `UpdateDto extends PartialType(CreateDto)`, list DTOs extend `PaginationDto`, `@ToBoolean()` for query booleans, `@ApiProperty` on every field).
- **Prisma query rules** → `nest-prisma` (explicit `select`, `$transaction` for list+count and multi-step writes, no awaits in loops).
- ID type: **uuid** → every `:id`/`:xxxId` param uses `ParseUUIDPipe`.
- App-wide roles: `WALI_KELAS`, `MURID` (Prisma enum `GlobalRole`, field `User.globalRole` — per the `per-resource-roles` naming rule). Per-class roles `KETUA`/`BENDAHARA`/`MEMBER` (`ClassRole` on `ClassMember.role`) are checked **in the service**; `WALI` is the effective role of the user matching `Classroom.homeroomTeacherId` and is **not** an enum value. The Swagger prefix shows only the app-wide `@Roles` list; the per-class rule is stated in each endpoint's description. API field names: `globalRole` for the app-wide role, `classRole` for the per-class role.

## Modules

### Auth — `src/auth/`

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature/BR |
|---|---|---|---|---|---|---|---|
| POST | `/auth/register` | [PUBLIC] Register and send a verification code | none | — | 5/min | 201, `MessageResponse(null)` | F-AUTH-1, BR-18 |
| POST | `/auth/verify-otp` | [PUBLIC] Verify the email with a code | none | — | 5/min | 200 `{ accessToken }` | F-AUTH-1, BR-17 |
| POST | `/auth/resend-otp` | [PUBLIC] Resend a verification code | none | — | 3/min | 200, identical message always | F-AUTH-1, BR-17 |
| POST | `/auth/login` | [PUBLIC] Log in with email and password | none | — | 5/min | 200 `{ accessToken }` | F-AUTH-2 |
| POST | `/auth/forgot-password` | [PUBLIC] Request a password reset code | none | — | **5/min** | 200, identical message always | F-AUTH-3 |
| POST | `/auth/reset-password` | [PUBLIC] Reset the password with a code | none | — | 5/min | 200, `tokenVersion`+1 | F-AUTH-3, BR-17 |
| POST | `/auth/change-password` | [AUTH] Change the password | JwtAuthGuard | — | 5/min | 200 `{ accessToken }`, `tokenVersion`+1 | F-AUTH-3 |
| POST | `/auth/logout-all` | [AUTH] End every session | JwtAuthGuard | — | global | 200 `null` | F-AUTH-4 |
| GET | `/auth/me` | [AUTH] Get my profile and class context | JwtAuthGuard | — | global | 200 profile | F-AUTH-4, F-ONBOARD-1 |

Endpoint shapes follow the skill's rule 21 table; bodies are `RegisterDto { name, email, password, globalRole: 'WALI_KELAS'|'MURID' }`, `LoginDto`, `VerifyOtpDto { email, code }`, `RequestCodeDto { email }`, `ResetPasswordDto { email, code, newPassword }`, `ChangePasswordDto { currentPassword, newPassword }`. `globalRole` here is the one allowed self-registration input (never accepted on any other body).

`GET /auth/me` response `data`:
```
{ id, name, email, globalRole, avatarUrl, emailVerifiedAt, createdAt,
  needsOnboarding: boolean,                      // WALI_KELAS with 0 classes, or MURID without active membership
  activeClass: { id, name, classRole } | null,   // MURID: their ACTIVE membership; never contains the join code
  classes: [ { id, name, memberCount } ] }              // WALI_KELAS only
```

The join code is the wali's invitation secret: it is only ever returned by `POST /classrooms` (to the homeroom teacher) and `POST .../regenerate-code`. Members never see it.

**Users — `src/users/`** (all `[AUTH]`, ownership = self, checked in the service)

| Method | Path | Summary | Throttle | Success | Feature |
|---|---|---|---|---|---|
| PATCH | `/users/me` | [AUTH] Update my profile (name, avatarUrl) | global | 200 profile | F-AUTH-4 |

Errors: `400` wrong current password; `401` invalid credentials / session invalid; `403` account disabled / email not verified (only after a correct password — owner-only reveal); `409` email registered (register only). No endpoint reveals whether an email exists (resend/forgot always answer the same, BR-17/rule 12).

`verify-otp` returns `{ accessToken }` for **both** self-registration roles (`WALI_KELAS` and `MURID`) — a documented deviation from the reference implementation's single-`DEFAULT_ROLE` check: drop the role gate, keep the `isActive` check (PRD assumption 6).

---

### Classrooms — `src/classrooms/`

Per-class roles resolved in the service from `ClassMember` + `homeroomTeacherId` (the wali is never a `ClassMember` — relation-based, per the audit decision). Prefix shows app-wide roles only; a service-level role check is described in each endpoint.

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature/BR |
|---|---|---|---|---|---|---|---|
| POST | `/classrooms` | [WALI_KELAS] Create a classroom | JwtAuthGuard+RolesGuard | WALI_KELAS | global | 201 classroom (with `code`) | F-CLASS-1, BR-6 |
| GET | `/classrooms` | [WALI_KELAS] List my classrooms | … | WALI_KELAS | global | 200 `Paginated` | F-CLASS-1 |
| GET | `/classrooms/:classId` | [WALI_KELAS/MURID] Get classroom detail (service: homeroom teacher of this class, or an ACTIVE member) | … | both | global | 200 detail | F-CLASS-1 |
| PATCH | `/classrooms/:classId` | [WALI_KELAS] Update settings (name, schoolName, academicYear, isLocked, maxStudents) | … | WALI_KELAS | global | 200 detail | F-CLASS-4, BR-4, BR-5 |
| POST | `/classrooms/:classId/regenerate-code` | [WALI_KELAS] Regenerate the join code | … | WALI_KELAS | global | 200 `{ code }` | F-CLASS-1, BR-6 |
| POST | `/classrooms/join` | [MURID] Join a classroom by code | … | MURID | **6/min** | 201 `{ classId, name, classRole: 'MEMBER' }` | F-CLASS-2, BR-2/3/4/12 |
| POST | `/classrooms/:classId/leave` | [MURID] Leave my classroom | … | MURID | global | 200 `MessageResponse(null)` | F-CLASS-3, BR-8 |
| GET | `/classrooms/:classId/members` | [WALI_KELAS/MURID] List members (active) | … | both | global | 200 `Paginated` | F-CLASS-6 |
| GET | `/classrooms/:classId/members/inactive` | [WALI_KELAS] List kicked/left members | … | WALI_KELAS | global | 200 `Paginated` | F-CLASS-3, F-CLASS-6 |
| POST | `/classrooms/:classId/members/:memberId/kick` | [WALI_KELAS] Kick a member (service: homeroom teacher of this class) | … | WALI_KELAS | global | 200 `MessageResponse(null)` | F-CLASS-3, BR-7/8 |
| POST | `/classrooms/:classId/members/:memberId/restore` | [WALI_KELAS] Restore a kicked member (service: homeroom teacher of this class) | … | WALI_KELAS | global | 200 member | F-CLASS-6, BR-2 |
| POST | `/classrooms/:classId/members/:memberId/assign-role` | [WALI_KELAS] Assign KETUA/BENDAHARA/MEMBER (service: homeroom teacher of this class) | … | WALI_KELAS | global | 200 member | F-CLASS-5, BR-1 |

- `POST /classrooms/:classId/members/:memberId/kick` body: `KickMemberDto { reason?: string (max 200) }`.
- `assign-role` body: `AssignRoleDto { classRole: 'KETUA'|'BENDAHARA'|'MEMBER' }` — a class role is **never** accepted on any other body (no mass assignment).
- `POST /classrooms/join` body: `JoinClassroomDto { code: string (6 chars) }` — 404 unknown code, 409 already in a class, 403 locked / full / kicked-before.
- Transaction + row lock (`FOR UPDATE` on the classroom row, advisory lock on `userId`) for join/restore/assign-role/kick/leave (BR-12, BR-1). Invalid states: kick of an already-KICKED/LEFT member → `409 already inactive`; restore of an ACTIVE member → `409 already active`; restore of a LEFT member → `409 'Member was not kicked — re-join via code'`.
- No `DELETE /classrooms` in v1 (audit decision): a class cannot be deleted, so the cash ledger and all history stay intact.

### Announcements — `src/announcements/`

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature/BR |
|---|---|---|---|---|---|---|---|
| POST | `/classrooms/:classId/announcements` | [WALI_KELAS/MURID] Create an announcement (service: author is WALI or KETUA) | … | WALI_KELAS, MURID | global | 201 announcement | F-ANN-1, BR-9 |
| GET | `/classrooms/:classId/announcements` | [WALI_KELAS/MURID] List (pinned first; filters `isPinned`; each item carries `isRead`) | … | both | global | 200 `Paginated` | F-ANN-1, BR-10 |
| GET | `/classrooms/:classId/announcements/:announcementId` | [WALI_KELAS/MURID] Detail | … | both | global | 200 detail (includes `myReadAt`) | F-ANN-1 |
| PATCH | `/classrooms/:classId/announcements/:announcementId` | [WALI_KELAS/MURID] Update (service: author or homeroom teacher) | … | both | global | 200 detail | F-ANN-1, BR-9 |
| DELETE | `/classrooms/:classId/announcements/:announcementId` | [WALI_KELAS/MURID] Delete (soft; service: author or homeroom teacher) | … | both | global | 200 `MessageResponse(null)` | F-ANN-1, BR-9 |
| POST | `/classrooms/:classId/announcements/:announcementId/read` | [WALI_KELAS/MURID] Mark as read (idempotent) | … | both | global | 200 `{ readAt }` | F-ANN-2, BR-10 |
| GET | `/classrooms/:classId/announcements/:announcementId/reads` | [WALI_KELAS/MURID] Read receipts (service: WALI or KETUA) | … | both | global | 200 `{ readCount, unreadCount, read[], unread[] }` | F-ANN-2, BR-10 |

Create body: `CreateAnnouncementDto { title (1..150), content (1..5000), isPinned? }`. Push `ANNOUNCEMENT_NEW` to all other active members (async).

### Subjects — `src/subjects/`

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature/BR |
|---|---|---|---|---|---|---|---|
| GET | `/classrooms/:classId/subjects` | [WALI_KELAS/MURID] List subjects (includes soft-deleted for history views) | … | both | global | 200 `Paginated` | F-SUBJ-1 |
| POST | `/classrooms/:classId/subjects` | [WALI_KELAS/MURID] Create (service: WALI or KETUA) | … | both | global | 201 subject | F-SUBJ-1 |
| PATCH | `/classrooms/:classId/subjects/:subjectId` | [WALI_KELAS/MURID] Update (WALI or KETUA) | … | both | global | 200 subject | F-SUBJ-1 |
| DELETE | `/classrooms/:classId/subjects/:subjectId` | [WALI_KELAS/MURID] Delete (soft; WALI or KETUA) | … | both | global | 200 `MessageResponse(null)` | F-SUBJ-1 |

`CreateSubjectDto { name (1..60), teacherName? (≤60), color? (hex) }`.

### Lesson schedules — `src/lesson-schedules/`

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature/BR |
|---|---|---|---|---|---|---|---|
| GET | `/classrooms/:classId/lesson-schedules` | [WALI_KELAS/MURID] Weekly schedule grouped by day (filter `day`) | … | both | global | 200 (not paginated; ≤ ~50 slots) | F-SCHED-1, BR-11b |
| GET | `/classrooms/:classId/lesson-schedules/today` | [WALI_KELAS/MURID] Today's slots (Asia/Jakarta) | … | both | global | 200 slots[] | F-SCHED-1 |
| POST | `/classrooms/:classId/lesson-schedules` | [WALI_KELAS/MURID] Create slot (WALI or KETUA) | … | both | global | 201 slot | F-SCHED-1, BR-11 |
| PUT | `/classrooms/:classId/lesson-schedules/days/:day` | [WALI_KELAS/MURID] Replace one day's slots (WALI or KETUA) | … | both | global | 200 day slots | F-SCHED-1, BR-11 |
| DELETE | `/classrooms/:classId/lesson-schedules/:scheduleId` | [WALI_KELAS/MURID] Delete slot (WALI or KETUA) | … | both | global | 200 `MessageResponse(null)` | F-SCHED-1 |

`CreateLessonScheduleDto { subjectId (uuid), dayOfWeek 1..7 (@IsInt @Min(1) @Max(7)), startTime 'HH:mm' (@Matches(/^([01]\d|2[0-3]):[0-5]\d$/)), endTime, room? (≤30) }`. Errors: 400 start ≥ end, 409 overlap (`SCHEDULE_CONFLICT` business message; `ConflictException`). Per PRD open question (answered in Open questions below): slots are hard-deleted; a soft-deleted subject can no longer gain new slots.

### Whiteboards — `src/whiteboards/`

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature/BR |
|---|---|---|---|---|---|---|---|
| POST | `/classrooms/:classId/whiteboards` | [WALI_KELAS/MURID] Upload note (any active member incl. homeroom) — `multipart/form-data` | … | both | **10/min** | 201 note | F-WB-1, BR-13 |
| GET | `/classrooms/:classId/whiteboards` | [WALI_KELAS/MURID] List (filters `subjectId`, `date`, `from`, `to`) | … | both | global | 200 `Paginated` | F-WB-1 |
| GET | `/classrooms/:classId/whiteboards/:whiteboardId` | [WALI_KELAS/MURID] Detail with images | … | both | global | 200 detail | F-WB-1 |
| PATCH | `/classrooms/:classId/whiteboards/:whiteboardId` | [WALI_KELAS/MURID] Update caption/subject/date (service: uploader only) | … | both | global | 200 detail | F-WB-1, BR-13 |
| DELETE | `/classrooms/:classId/whiteboards/:whiteboardId` | [WALI_KELAS/MURID] Delete (service: uploader, KETUA, or homeroom teacher; soft + async Cloudinary cleanup) | … | both | global | 200 `MessageResponse(null)` | F-WB-1, BR-13 |

Multipart fields: `images` (1–5 files), `subjectId`, `date` (YYYY-MM-DD ≤ today WIB), `caption?` (≤500). File validation with `ParseFilePipe`/`FileValidator` (mime + 5 MB). Response images: `{ id, url, width, height, position }` (no `cloudinaryPublicId`). Update rule (service): the **uploader only** — officers moderate by deleting, not editing. Delete rule (service): the uploader, any KETUA, or the homeroom teacher — a member without an office cannot delete another member's note. Create is one `$transaction` (note + `createMany` images) after the Cloudinary uploads.

### Pickets — `src/pickets/`

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature/BR |
|---|---|---|---|---|---|---|---|
| GET | `/classrooms/:classId/pickets` | [WALI_KELAS/MURID] Groups for the whole week | … | both | global | 200 groups[] (not paginated; ≤ 7) | F-PICKET-1 |
| GET | `/classrooms/:classId/pickets/me` | [MURID] My duty days | … | MURID | global | 200 `{ days: number[] }` | F-PICKET-1 |
| PUT | `/classrooms/:classId/pickets/days/:day` | [WALI_KELAS/MURID] Replace a day's group (WALI or KETUA) | … | both | global | 200 group | F-PICKET-1 |
| DELETE | `/classrooms/:classId/pickets/days/:day` | [WALI_KELAS/MURID] Delete a day's group (WALI or KETUA) | … | both | global | 200 `MessageResponse(null)` | F-PICKET-1 |

`ReplacePicketDayDto { name?, memberIds: string[] (uuid[], max 40, no duplicates) }`. `:day` is validated with `@IsInt @Min(1) @Max(7)` — use a `ParseIntPipe` + DTO, or an action-style body; the implementation must not accept junk (BR-11b).

**Reminder (F-PICKET-2, BR-16)**: no endpoint. Daily cron at 18:00 `Asia/Jakarta` notifies the members of tomorrow's group; `NotificationLog` claim makes it idempotent.

### Polls — `src/polls/`

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature/BR |
|---|---|---|---|---|---|---|---|
| POST | `/classrooms/:classId/polls` | [WALI_KELAS/MURID] Create a poll (WALI or KETUA) | … | both | global | 201 poll | F-POLL-1 |
| GET | `/classrooms/:classId/polls` | [WALI_KELAS/MURID] List (filter `status=open|closed`) | … | both | global | 200 `Paginated` | F-POLL-1 |
| GET | `/classrooms/:classId/polls/:pollId` | [WALI_KELAS/MURID] Detail + results | … | both | global | 200 detail | F-POLL-1, BR-14 |
| POST | `/classrooms/:classId/polls/:pollId/votes` | [MURID] Vote (replaces previous; homeroom teacher gets 403) | … | MURID | **10/min** | 200 results | F-POLL-1, BR-14 |
| DELETE | `/classrooms/:classId/polls/:pollId/votes` | [MURID] Withdraw my vote | … | MURID | global | 200 results | F-POLL-1 |
| POST | `/classrooms/:classId/polls/:pollId/close` | [WALI_KELAS/MURID] Close (creator or homeroom teacher) | … | both | global | 200 detail | F-POLL-1 |
| DELETE | `/classrooms/:classId/polls/:pollId` | [WALI_KELAS/MURID] Delete (soft; creator or homeroom teacher) | … | both | global | 200 `MessageResponse(null)` | F-POLL-1 |

`CreatePollDto { question (1..200), options: string[] (2..10, each 1..60), deadline? (future), allowMultiple? , isAnonymous? }`. `VoteDto { optionIds: string[] (1, or 2..10 when allowMultiple) }`. Results hide voter lists when `isAnonymous`. Errors: 403 poll closed / not allowed to vote, 400 invalid option or option count, 409 vote already withdrawn (DELETE). Vote replace and withdrawal are `$transaction` (delete+create pairs). Close: `409 already closed` on repeat.

### Cash transactions — `src/cash-transactions/`

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature/BR |
|---|---|---|---|---|---|---|---|
| GET | `/classrooms/:classId/cash/summary` | [WALI_KELAS/MURID] Balance, totals, outstanding | … | both | global | 200 summary | F-CASH-1/2 |
| GET | `/classrooms/:classId/cash/transactions` | [WALI_KELAS/MURID] Ledger (filters `type`, `from`, `to`, voided included) | … | both | global | 200 `Paginated` | F-CASH-1 |
| POST | `/classrooms/:classId/cash/transactions` | [WALI_KELAS/MURID] Record (service: BENDAHARA only; optional proof upload) | … | both | **10/min** | 201 transaction | F-CASH-1, BR-15 |
| POST | `/classrooms/:classId/cash/transactions/:transactionId/void` | [WALI_KELAS/MURID] Void (BENDAHARA only) | … | both | global | 200 transaction | F-CASH-1, BR-15 |

`CreateCashTransactionDto { type: 'INCOME'|'EXPENSE', amount (@IsInt @Min(1)), description (1..200), date (YYYY-MM-DD ≤ today WIB) }`, multipart optional `proof` image. `VoidTransactionDto { reason (1..200) }`. Errors: 403 not the bendahara, 409 already voided, 400 bad amount/date.
### Cash dues — `src/cash-dues/`

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature/BR |
|---|---|---|---|---|---|---|---|
| GET | `/classrooms/:classId/cash/dues` | [WALI_KELAS/MURID] List dues with counts | … | both | global | 200 `Paginated` | F-CASH-2 |
| POST | `/classrooms/:classId/cash/dues` | [WALI_KELAS/MURID] Create due (BENDAHARA only; snapshots UNPAID rows for all active members) | … | both | **6/min** | 201 due | F-CASH-2, BR-15 |
| GET | `/classrooms/:classId/cash/dues/:dueId` | [WALI_KELAS/MURID] Detail with per-member payments | … | both | global | 200 detail | F-CASH-2 |
| DELETE | `/classrooms/:classId/cash/dues/:dueId` | [WALI_KELAS/MURID] Delete (BENDAHARA; only before any payment) | … | both | global | 200 `MessageResponse(null)` | F-CASH-2 |
| POST | `/classrooms/:classId/cash/dues/:dueId/payments/:memberId/pay` | [WALI_KELAS/MURID] Mark paid (BENDAHARA) | … | both | global | 200 payment (+ linked income tx) | F-CASH-2, BR-15 |
| POST | `/classrooms/:classId/cash/dues/:dueId/payments/:memberId/unpay` | [WALI_KELAS/MURID] Revert to unpaid (BENDAHARA; voids linked tx) | … | both | global | 200 payment | F-CASH-2, BR-15 |
| GET | `/classrooms/:classId/cash/members/:memberId` | [WALI_KELAS/MURID] One member's dues & outstanding | … | both | global | 200 member detail | F-CASH-2 |

`CreateCashDueDto { title (1..100), amount (@IsInt @Min(1)), dueDate? }`. Due creation (due + snapshot `createMany` of UNPAID rows), pay (payment update + linked INCOME create) and unpay (payment clear + linked transaction void) are each one `$transaction` — a crashed write can never leave a PAID payment without a ledger entry. Invalid states: pay of an already-PAID payment → `409 already paid`; unpay of an UNPAID → `409 already unpaid`; delete a due with any payment → `409 already in use`. Active members without a snapshot row appear as computed `UNPAID` in the detail (PRD F-CASH-2). `/cash/members/:memberId` — MEMBER sees only their own (ownership check in service); WALI/KETUA/BENDAHARA see anyone's.

### Devices — `src/devices/`

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature/BR |
|---|---|---|---|---|---|---|---|
| PUT | `/devices` | [AUTH] Register/upsert my FCM token | JwtAuthGuard | — | **30/min** | 200 `MessageResponse(null)` | F-NOTIF-1 |
| DELETE | `/devices/:deviceId` | [AUTH] Remove a token (ownership in service) | … | — | global | 200 `MessageResponse(null)` | F-NOTIF-1 |

`RegisterDeviceDto { token (1..4096), platform: 'ANDROID'|'IOS'|'WEB' }`. Upsert on `token` (reassigns to the current user if another account held it).

### Notifications — `src/notifications/`

| Method | Path | Summary | Guard | Roles | Throttle | Success | Feature/BR |
|---|---|---|---|---|---|---|---|
| GET | `/notifications` | [AUTH] My inbox (filter `unread`, classId) | JwtAuthGuard | — | global | 200 `Paginated` | F-NOTIF-1 |
| GET | `/notifications/unread-count` | [AUTH] Unread count | … | — | global | 200 `{ count }` | F-NOTIF-1 |
| POST | `/notifications/:notificationId/read` | [AUTH] Mark one read (idempotent) | … | — | global | 200 `{ readAt }` | F-NOTIF-1 |
| POST | `/notifications/read-all` | [AUTH] Mark all read | … | — | global | 200 `MessageResponse(null)` | F-NOTIF-1 |

---

## Constraints check (per endpoint)

1. **Guard decision**: every route above is `JwtAuthGuard` + `RolesGuard` (prefix `[WALI_KELAS]`, `[MURID]`, `[WALI_KELAS/MURID]`, or `[AUTH]` for no-`@Roles` authenticated), except the `[PUBLIC]` auth block. Per-class role rules (WALI/KETUA/BENDAHARA) live in descriptions + services — the prefix never lies.
2. **Routes**: kebab-case plural, nested `classrooms/:classId/...`, state changes `POST :id/<verb>` with `@HttpCode(200)` (`kick`, `restore`, `assign-role`, `read`, `close`, `void`, `pay`, `unpay`, `read-all`).
3. **Lists & pipes**: every list is paginated or justified (≤ 7/≤ ~50 items); every `:id` has `ParseUUIDPipe`; `:day` validated with int bounds.
4. **Throttle**: login/register/verify/reset/change/forgot 5; resend 3 (+ DB cooldown per BR-17); join 6; poll vote 10; whiteboard upload 10; cash write 10; due create 6; device register 30; all per handler, global 100/min otherwise.
5. **Auth endpoints**: exactly the skill's table + `name`/`role` on register (self-registration inputs), no refresh endpoints.
6. **No privileged body fields**: `globalRole` only on register; `classRole` only on assign-role; `isActive`/`tokenVersion`/`status` nowhere.
7. **No account enumeration**: resend-otp / forgot-password identical responses; login generic `401`; status checked after password.

## Access matrix

Legend: ✅ allowed · 🔒 allowed with per-class/ownership check in the service · ❌ denied by guard or service.

| Endpoint group | WALI_KELAS | MURID |
|---|---|---|
| Auth (register/login/otp) | ✅ (public) | ✅ (public) |
| `/auth/me`, `/users/me*`, `/notifications*`, `/devices*` | ✅ | ✅ |
| Create/list own classrooms, update/regenerate | 🔒 homeroom teacher | ❌ |
| Classroom detail, members list (active) | 🔒 homeroom of that class | 🔒 member |
| Members inactive list / kick / restore / assign-role | 🔒 homeroom teacher | ❌ |
| Join / leave | ❌ (a wali never joins their own class; no membership row exists) | 🔒 student, BR-2/3/4 |
| Announcements create/update/delete | 🔒 homeroom | 🔒 KETUA only |
| Announcements read / receipt mark | 🔒 homeroom | 🔒 member |
| Read receipts statistics | 🔒 homeroom | 🔒 KETUA only |
| Subjects / lesson schedules write | 🔒 homeroom | 🔒 KETUA only |
| Whiteboard create | 🔒 homeroom or member | 🔒 member |
| Whiteboard update | 🔒 own notes only | 🔒 uploader only |
| Whiteboard delete | 🔒 any note (moderation) | 🔒 own note, or any note if KETUA |
| Pickets write | 🔒 homeroom | 🔒 KETUA only |
| Polls create | 🔒 homeroom | 🔒 KETUA only |
| Polls close/delete | 🔒 any poll | 🔒 creator only |
| Poll vote / withdraw | ❌ homeroom teacher | 🔒 member, while open |
| Cash summary/ledger/dues read | 🔒 homeroom (read-only) | 🔒 member |
| Cash transactions/dues/payments write | ❌ | 🔒 BENDAHARA only |

## Coverage matrix

| Feature | Endpoints |
|---|---|
| F-AUTH-1 | POST /auth/register · /auth/verify-otp · /auth/resend-otp |
| F-AUTH-2 | POST /auth/login |
| F-AUTH-3 | POST /auth/forgot-password · /auth/reset-password · /auth/change-password |
| F-AUTH-4 | GET /auth/me · POST /auth/logout-all · PATCH /users/me |
| F-ONBOARD-1 | GET /auth/me (`needsOnboarding`, `activeClass`) |
| F-CLASS-1 | POST/GET /classrooms · PATCH + regenerate-code (no DELETE in v1) |
| F-CLASS-2 | POST /classrooms/join |
| F-CLASS-3 | kick · leave · members/inactive |
| F-CLASS-4 | PATCH /classrooms/:classId (isLocked, maxStudents) |
| F-CLASS-5 | assign-role |
| F-CLASS-6 | members list · restore |
| F-ANN-1 | announcements CRUD + list/detail |
| F-ANN-2 | announcements/:id/read · /reads |
| F-SUBJ-1 | subjects CRUD |
| F-SCHED-1 | lesson-schedules GET/POST/PUT day/DELETE |
| F-WB-1 | whiteboards POST/GET/PATCH/DELETE |
| F-PICKET-1 | pickets GET/PUT day/DELETE |
| F-PICKET-2 | (cron — no endpoint) |
| F-POLL-1 | polls CRUD + votes + close |
| F-CASH-1 | cash/summary · transactions POST/GET/void |
| F-CASH-2 | cash/dues CRUD + pay/unpay + members/:memberId |
| F-NOTIF-1 | devices PUT/DELETE · notifications list/count/read/read-all |

Orphans: none (every PRD feature maps to endpoints or a declared cron; every endpoint maps to a feature).

## Test targets (BR → service method → exception)

| BR | Service method | Expected exception / assertion |
|---|---|---|
| BR-1 | `ClassMembersService.assignRole` | Previous holder demoted in one transaction; `ForbiddenException` for inactive member |
| BR-2 | `ClassMembersService.join` / `restore` | `ConflictException('You already belong to a class')` |
| BR-3 | `ClassMembersService.join` | `NotFoundException` unknown · `ForbiddenException` locked/full/kicked (distinct messages) |
| BR-4 | `ClassroomsService.update` / `join` | Quota counts ACTIVE only; lowering below current count succeeds |
| BR-5 | all homeroom-only methods | `ForbiddenException('Only the homeroom teacher can …')` |
| BR-6 | `ClassroomsService.create` / `regenerateCode` | Code matches alphabet/length; unique; regenerate changes it |
| BR-7 | `ClassMembersService.kick` | Row still exists with status KICKED + `leftAt`; historical rows untouched |
| BR-8 | `kick` / `leave` | Role reverted to MEMBER on the inactive row |
| BR-9 | `AnnouncementsService.update/remove` | `ForbiddenException` for non-author non-homeroom |
| BR-10 | `AnnouncementsService.markRead/getReceipts` | Idempotent readAt; unread list = current active members |
| BR-11 | `LessonSchedulesService.create/update/replaceDay` | `BadRequestException` start ≥ end; `ConflictException` overlap |
| BR-11b | `CreateLessonScheduleDto` / `ReplacePicketDayDto` | `BadRequestException` for dayOfWeek outside 1..7 and malformed `HH:mm` (DTO validation tests) |
| BR-12 | e2e: two parallel joins, one seat | Exactly one 201, one 403; active members == maxStudents |
| BR-13 | `WhiteboardsService.create` | 400 for >5 files / wrong mime / future date; Cloudinary called with the right folder |
| BR-14 | `PollsService.vote` | `ForbiddenException` when closed / homeroom teacher; re-vote replaces |
| BR-15 | `CashTransactionsService.*`, `CashDuesService.*` | `BadRequestException` amount ≤ 0 / future date; void keeps row with `voidedAt`; unpay voids linked tx with reason |
| BR-16 | `PicketsService` cron → shared sender in `src/common/notifications/` (parallel call test) | Exactly one inbox row + one log row per (type, refId, user, date); the cron lives in `pickets`, the sender/log mechanics in `src/common/notifications/` |
| BR-17 | `OtpService.consume` (from the reference) | Parallel wrong guesses ≤ 5 attempts; parallel correct → exactly one success |
| BR-18 | `AuthService.register` | `ConflictException`; no update of the existing row |
| — (meta) | `test/route-guards.e2e-spec.ts` | Required in every project (skill rule 4): every handler has `JwtAuthGuard` (+ `RolesGuard`/`@Roles`) or a `[PUBLIC]` summary, and the prefix matches `@Roles` |

## Environment variables

Base schema (`base-env.schema.ts`, from nest-common — not edited): `DATABASE_URL` (required), `PORT` (default 3000), `NODE_ENV` (development/production/test), `FRONTEND_URL` (comma-separated origins; empty = no CORS), `JWT_SECRET` (required), `JWT_EXPIRES_IN` (default `7d`), `TRUST_PROXY_HOPS` (default 0).

`projectEnvSchema` (`src/config/env.schema.ts`, per `nest-validation-and-config` rule 11 + `nest-auth-and-security` rule 25):

| Var | Constraint | Used by |
|---|---|---|
| `JWT_EXPIRES_IN` | string, default `7d` (stays in the **base** schema per skill rule 25 — the project schema must not redeclare it) | auth |
| `OTP_SENDER` | `resend` \| `console`, default `resend` | MailModule |
| `RESEND_API_KEY` | required when `OTP_SENDER=resend` | ResendOtpSender |
| `MAIL_FROM` | required when `OTP_SENDER=resend` | ResendOtpSender |
| `OTP_TTL_MINUTES` | int 1..60, default 10 | OtpService |
| `OTP_RESEND_COOLDOWN_SECONDS` | int ≥ 0, default 60 | OtpService |
| `CLOUDINARY_URL` | `cloudinary://<key>:<secret>@<cloud>`, required, uri | `common/upload` (StorageService) |
| `FIREBASE_PROJECT_ID` | required | `common/notifications` (FirebaseService) |
| `FIREBASE_CLIENT_EMAIL` | required | same |
| `FIREBASE_PRIVATE_KEY` | required (multiline) | same |
| `TZ` | string, default `Asia/Jakarta` | cron scheduling (pickets reminder) |

All of the above go in `.env.example` too. No fallback secrets anywhere (`nest-validation-and-config` rule 14).

## Gaps in PRD (answered, carried into the spec)

- Audit round decisions: no `DELETE /classrooms` in v1; whiteboard delete = uploader/KETUA/WALI and whiteboard update = uploader only; forgot-password throttle 5/min; verify-otp issues a token for both self-registration roles; wali is relation-based (never a `ClassMember`); app-wide field renamed `globalRole` (`GlobalRole`), API fields `globalRole`/`classRole`; shared push sender in `src/common/notifications/`; restore of a LEFT member → 409.
- Schedule slots hard-delete; soft-deleted subjects cannot gain new slots (Restrict keeps history).
- Wali does **not** vote (kept as in the PRD access table).
- Receipts only for members active at read time; no class cap; inbox kept forever.
