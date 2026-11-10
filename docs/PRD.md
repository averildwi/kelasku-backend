# PRD — KelasKu

> Backend for KelasKu, a classroom-management app for Indonesian schools (NestJS, Flutter client).
> Conventions for HOW to build live in the project skills (`nest-architecture`, `nest-prisma`, `nest-auth-and-security`, `nest-validation-and-config`, `nest-response-and-errors`, `nest-testing`, `git-workflow`). This document describes WHAT the product does and must not contradict them.
> Final version — supersedes `PRD.draft-v1.md` (kept as a structural reference only). Decisions that changed: no refresh tokens (access token + `tokenVersion`), no WebSocket, OTP email verification is in, per-route guards, `KETUA`/`BENDAHARA` are per-class roles.

---

## 1. Overview

**Problem.** Class information in Indonesian schools is scattered across group chats: announcements get buried, students who are absent cannot see the whiteboard, duty (piket) and cash-collection status are tracked manually, and the homeroom teacher has no single place to manage the class.

**Target users.** One homeroom teacher (**wali kelas**) and their students (typically 20–40) per class, at any school. One teacher may manage several classes (e.g. two grades); a student belongs to exactly one class at a time.

**Success criteria (measurable).**
- A homeroom teacher can create a class, invite students via a 6-character code, and assign roles in under 5 minutes.
- A `NotificationLog` row for every targeted active member exists within 30 s of an announcement being published (the measurable proxy for push delivery; actual device delivery depends on FCM and is not tracked in v1).
- Absent students can find the latest whiteboard photo per subject within 3 taps.
- Cash balance shown in the app matches the treasurer's manual tally 100 % (every transaction is attributable to a member).
- Picket and deadline reminders are delivered at H-1 without manual action, with no duplicate pushes for the same event/user/day.

---

## 2. Roles and permissions

Two layers of roles, as decided in the project brief:

- **App-wide role** (`User.globalRole`, Prisma enum `GlobalRole`, per the `per-resource-roles` naming rule): `WALI_KELAS` (teacher) and `MURID` (student). Used with `@Roles` / `RolesGuard`.
- **Per-class role** (`ClassMember.role`, Prisma enum `ClassRole`): `KETUA`, `BENDAHARA`, `MEMBER`. `WALI` is not a value of the enum — it is the effective role of the user matching `Classroom.homeroomTeacherId`. Checked **in the service** per `per-resource-roles` (the API_SPEC will decide the exact `@Roles` lists per endpoint).

| Capability | WALI_KELAS (app) | Homeroom teacher of this class (`WALI`) | KETUA | BENDAHARA | MEMBER (murid) |
|---|---|---|---|---|---|
| Create class | ✅ (creates own class) | — | ❌ | ❌ | ❌ |
| Update class settings (lock, quota, rename) | ✅ if homeroom | ✅ | ❌ | ❌ | ❌ |
| Generate / regenerate class code | ✅ if homeroom | ✅ | ❌ | ❌ | ❌ |
| Kick / restore member | ✅ if homeroom | ✅ | ❌ | ❌ | ❌ |
| Assign `KETUA` / `BENDAHARA` / `MEMBER` | ✅ if homeroom | ✅ | ❌ | ❌ | ❌ |
| Delete class | ❌ (not in v1) | ❌ (not in v1) | ❌ | ❌ | ❌ |
| Join class via code | ❌ | ❌ | ❌ | ❌ | ✅ |
| Leave class | — (not a member; a wali never joins their own class) | ❌ | ✅ (own membership) | ✅ | ✅ |
| Create / edit / delete announcement | ✅ if homeroom | ✅ | ✅ | ❌ | ❌ |
| Mark announcement read; see own read status | ✅ if homeroom | ✅ | ✅ | ✅ | ✅ |
| Read-receipt statistics (who read) | ✅ if homeroom | ✅ | ✅ | ❌ | ❌ |
| Manage subjects (`mapel`) | ✅ if homeroom | ✅ | ✅ | ❌ | ❌ |
| Manage lesson schedules | ✅ if homeroom | ✅ | ✅ | ❌ | ❌ |
| Upload whiteboard note | ✅ if homeroom | ✅ | ✅ | ✅ | ✅ |
| Update whiteboard note | ✅ if homeroom (own notes only) | ✅ own notes only | ✅ own notes only | ✅ own notes only | ✅ own notes only |
| Delete whiteboard note | ✅ if homeroom (any note, moderation) | ✅ any note | ✅ any note | ❌ | ✅ own only |
| Manage picket groups | ✅ if homeroom | ✅ | ✅ | ❌ | ❌ |
| Create poll | ✅ if homeroom | ✅ | ✅ | ❌ | ❌ |
| Vote in poll | ❌ (the wali never votes) | ❌ (no vote) | ✅ | ✅ | ✅ |
| Close / delete poll | ✅ if homeroom | ✅ any poll | ✅ own poll only | ❌ | ❌ |
| Withdraw own vote | — | ❌ | ✅ | ✅ | ✅ |
| Record cash transaction / dues / payments | ❌ (read-only) | ❌ (read-only) | ❌ | ✅ | ❌ |
| View cash summary / transactions / dues | ✅ if homeroom | ✅ | ✅ | ✅ | ✅ |
| View own notification inbox / manage devices | ✅ | ✅ | ✅ | ✅ | ✅ |

Ownership-based checks (in the service): edit own announcement, close/delete own poll, update/delete own whiteboard note (murid), edit own profile, view own notification inbox. Role-based (`@Roles`): everything marked in the table above. "✅ if homeroom" = the app-wide role (`WALI_KELAS`) is wide enough to reach the service, which then checks `homeroomTeacherId` — **the wali is never a `ClassMember`**; their powers are relation-based, not membership-based. The API_SPEC prefix lists the app-wide roles and the description states the per-class rule, per `per-resource-roles` (naming: app-wide role = `globalRole`, per-class role = `role` on `ClassMember`).

---

## 3. Glossary

| Term | Meaning |
|---|---|
| **Kelas (classroom)** | One homeroom class, created by a wali kelas, joined by students via code. |
| **Wali kelas** | Homeroom teacher; owner of the classroom. |
| **Ketua** | Student class president, appointed by the wali. |
| **Bendahara** | Student treasurer, appointed by the wali; manages class cash. |
| **Kode kelas** | 6-character join code, unambiguous alphabet, unique while the class exists. |
| **Papan tulis (whiteboard note)** | 1–5 photos of the physical whiteboard, tagged with subject + date, for absent students. |
| **Piket** | Rotating classroom-cleaning duty; groups per weekday. |
| **Kas kelas** | Shared class fund: transactions (in/out) and per-member dues with payment status. |
| **Iuran** | A due (e.g. "Kas minggu 1") charged to every active member; each member has a payment status. |
| **Push notification** | FCM message to a member's device; also stored in the in-app inbox. |

---

## 4. Features

Modules (plural kebab-case, per `nest-architecture` rule 2): auth is the standard `auth` module; features live in `classrooms` (including member management: join/kick/restore/assign-role), `announcements`, `subjects`, `lesson-schedules`, `whiteboards`, `pickets`, `polls`, `cash-transactions`, `cash-dues`, `devices`, `notifications`.

### F-AUTH-1 — Register (wali kelas & murid) — MVP
Goal: a visitor creates an account as `WALI_KELAS` or `MURID` and must verify the email before logging in.
- **Given** an unregistered email, **when** the user registers with name/email/password/role, **then** the account exists with `emailVerifiedAt = null`, an OTP is sent, and the response contains no token.
- **Given** a registered (even unverified) email, **when** someone registers again, **then** `409` and nothing changes.
- **Given** a valid code, **when** verified before expiry, **then** `emailVerifiedAt` is set and an access token is issued.

### F-AUTH-2 — Login — MVP
Goal: a verified user signs in with email + password.
- **Given** a verified account, **when** correct credentials, **then** `{ accessToken }` is returned.
- **Given** wrong password, unknown email, or a `passwordHash = null` row, **when** logging in, **then** the same generic `401` (status is checked after the password, per skill rule 12).
- **Given** a correct password for an unverified or disabled account, **when** logging in, **then** `403` ('Email is not verified' / 'Account is disabled') — the status is revealed only to someone who knows the password.

### F-AUTH-3 — Password flows — MVP
Goal: users can recover and change passwords without revealing account existence.
- Forgot-password sends a `PASSWORD_RESET` OTP with identical responses for known/unknown emails.
- Reset with a valid code sets a new password and bumps `tokenVersion` (all sessions die).
- Change-password (authenticated) requires the current password, bumps `tokenVersion`, returns a new access token.

### F-AUTH-4 — Profile & session — MVP
Goal: users see who they are and can end all sessions.
- `GET /auth/me` returns profile + class context (`activeClass` for students, `classes` for teachers, `needsOnboarding` flag).
- `POST /auth/logout-all` bumps `tokenVersion` → every token dies.
- Users can update their own profile (name, avatar).

### F-CLASS-1 — Create classroom with unique join code — MVP (actor: WALI_KELAS)
Goal: the teacher creates a class and gets a shareable code.
- **Given** a verified teacher, **when** creating a class with `name` (+ optional school/year/quota), **then** the class exists with an auto-generated unique 6-char code, the creator is recorded as `homeroomTeacherId`, and the response contains the code.
- **Given** a teacher with ≥ 1 class, **when** creating another, **then** it succeeds (teachers may hold several classes).

### F-CLASS-2 — Join classroom via code — MVP (actor: MURID)
Goal: a student joins exactly one active class using the code.
- **Given** a valid code of an unlocked, non-full class, **when** a student without an active membership joins, **then** an `ACTIVE` `ClassMember` row is created.
- **Given** a student who was previously kicked from that class, **when** rejoining, **then** `403` (the wali must restore first).
- **Given** a full or locked class, **when** joining, **then** `403` with a distinct reason.
- **Given** two students joining the last slot in parallel, **when** both requests commit, **then** exactly one succeeds (BR-12).

### F-CLASS-3 — Kick member — MVP (actor: homeroom teacher)
Goal: remove a disruptive member while keeping every historical record.
- **Given** an `ACTIVE` member, **when** kicked, **then** the membership row is kept with `isActive = false`, `leftAt` set, `status = KICKED`, optional reason, and their historical rows (reads, votes, cash payments, whiteboard notes) remain intact.
- **Given** the kicked member is KETUA or BENDAHARA, **when** kicked, **then** their role reverts to `MEMBER` on the inactive row (historical trace preserved).
- **Given** the kicked member, **when** they try any class endpoint, **then** they get `403`.

### F-CLASS-4 — Lock class / limit quota — MVP (actor: homeroom teacher)
Goal: stop new joins.
- Locking sets `isLocked`; any subsequent join gets `403 CLASS_LOCKED`.
- `maxStudents` (nullable) caps **active** members; lowering it below the current count is allowed and only blocks new joins.

### F-CLASS-5 — Assign roles (ketua / bendahara) — MVP (actor: homeroom teacher)
Goal: appoint exactly one ketua and one bendahara.
- **Given** an `ACTIVE` member, **when** assigned `KETUA`, **then** any previous `KETUA` reverts to `MEMBER` in the same transaction, and the new ketua gets a notification.
- **Given** a member who is currently `BENDAHARA`, **when** assigned `KETUA`, **then** the bendahara slot is freed (one office per member, BR-1) and the previous ketua is demoted.
- Same semantics for `BENDAHARA`. Setting a member back to `MEMBER` is always allowed.

### F-CLASS-6 — Member list & restore — MVP (actor: members read, homeroom teacher restores)
Goal: visibility of the roster and a way to undo a kick.
- Members list shows `name`, `classRole`, `status`; non-active rows are visible to the homeroom teacher only.
- **Given** a kicked member with no active membership elsewhere, **when** restored by the wali, **then** `status = ACTIVE` again with `joinedAt` reset to now (a fresh term; the previous kick stays in the audit columns `kickedById`/`kickReason` until restored clears them).
- Re-join after `LEFT` **reactivates the existing row** (`@@unique([classId, userId])`): `status = ACTIVE`, `isActive = true`, `leftAt`/`kickedById`/`kickReason` cleared, `joinedAt = now`. Historical rows (reads, votes, payments) reference the member by id and stay intact.

### F-ANN-1 — Announcement CRUD + push — MVP
Goal: ketua/wali broadcast information to the class.
- **Given** a ketua or homeroom teacher, **when** creating an announcement, **then** it is stored and every other active member gets a push notification + inbox entry.
- Edit/delete by the author or the homeroom teacher (ownership in the service).
- List: pinned first, then newest; paginated; each item carries `isRead` for the current user.

### F-ANN-2 — Read receipt — MVP (moved up from Fase 2 per brief feature list #2)
Goal: ketua/wali see who has read an announcement.
- **Given** a member opens an announcement, **when** the client calls the read endpoint, **then** a receipt row is stored (idempotent, `readAt` from the first call).
- **Given** an announcement, **when** the ketua/wali request receipts, **then** they see counts + the read/unread member lists computed against current active members.

### F-SUBJ-1 — Subject CRUD — MVP (actor: ketua or wali)
Goal: maintain the `mapel` list used by schedules, whiteboard tags, and (future) assignments.
- Create/rename/set teacher name/color; soft-delete a subject that is referenced by schedules/whiteboards (history stays intact).

### F-SCHED-1 — Lesson schedule CRUD — MVP (actor: ketua or wali)
Goal: the weekly timetable per class.
- Slots are `(dayOfWeek 1–7, startTime, endTime, subjectId, room?)`; `startTime < endTime`; no overlap with another slot on the same day (BR-13).
- Readable by all members, grouped by day; "today" view for the client.

### F-WB-1 — Upload whiteboard photos — MVP (actor: any active member incl. wali)
Goal: absent students can catch up.
- **Given** 1–5 images (jpg/png/webp, ≤ 5 MB each), a subject, and a date, **when** uploaded, **then** files go to Cloudinary (`kelasku/<classId>/whiteboard`) and one note with N image rows is created (note + images in one `$transaction`, after the Cloudinary uploads).
- List with filters `subjectId`, `date`, `from`/`to`.
- Update (caption/subject/date): the **uploader only** (decided in the audit round — officers moderate by deleting, not editing others' notes). Delete: the uploader, any KETUA, or the wali — a member without an office cannot delete another member's note — soft delete; the Cloudinary assets are removed asynchronously.

### F-PICKET-1 — Picket schedule — MVP (actor: ketua or wali)
Goal: weekly duty groups per weekday.
- One group per weekday per class; members can serve on multiple days but not twice on the same day.
- Replace-the-day endpoint (PUT) for easy drag-and-drop UIs.
- Kicked/departed members are automatically removed from their picket groups.

### F-PICKET-2 — H-1 picket reminder — MVP (actor: system)
Goal: members on duty tomorrow get a push at 18:00 WIB.
- Daily cron computes tomorrow's `dayOfWeek` in `Asia/Jakarta` and notifies the members of that day's group.
- Idempotent per (user, day): no duplicates even if the cron re-runs (BR-16).

### F-POLL-1 — Create & vote in polls — MVP
Goal: quick class decisions; results via plain REST (client refetches; no WebSocket per brief).
- Create: ketua or wali, with 2–10 options, optional deadline, single- or multi-choice, anonymous flag.
- Vote: any active member **except the homeroom teacher** (table says "Ketua, Murid"); change your vote until the deadline (a re-vote deletes and recreates the vote rows in one `$transaction`); withdraw your own vote while open; closed polls reject votes with `403`.
- Close or delete (soft) a poll: its creator or the wali.
- Results endpoint returns counts/percentages per option; voter lists only when not anonymous.

### F-CASH-1 — Cash transactions — MVP (actor: BENDAHARA only)
Goal: transparent class-fund bookkeeping; read-only for everyone else.
- Record `INCOME`/`EXPENSE` with integer-rupiah `amount`, `description`, `date`, optional proof image.
- Transactions are never hard-deleted: void with a reason (audit trail, BR-15).

### F-CASH-2 — Dues & payment status — MVP (actor: BENDAHARA only)
Goal: track who has paid each `iuran`.
- Creating a due snapshots `UNPAID` payment rows for every currently-active member (due + snapshot in one `$transaction` via `createMany`).
- Members who join **after** the due was created have no snapshot row; the per-member outstanding view treats an active member without a payment row as `UNPAID` (computed, not stored), so nobody silently escapes a due.
- Mark `PAID` → records who/when and creates a linked `INCOME` transaction (one `$transaction`); back to `UNPAID` → that transaction is voided with reason `payment reverted` (one `$transaction`).
- Summary: balance, totals, outstanding per member; visible to all members.

### F-NOTIF-1 — Push notification infrastructure — MVP (actor: system)
Goal: one mechanism used by all features above.
- Clients register FCM device tokens (platform-tagged); a token is removed when the client explicitly calls the delete endpoint (with access-token-only auth there is no server-side "logout this device" — the client drops the token).
- Every push is also stored in the user's in-app inbox (`Notification`), with `type`, `title`, `body`, and deep-link `data`.
- Send is asynchronous and must never block or fail the triggering API call.
- Inbox: list with `unread` filter, unread count, mark one/all read.

### F-ONBOARD-1 — Post-registration guidance — MVP (actor: any)
Goal: the client knows what to show next.
- A wali with zero classes gets `needsOnboarding: true` from `/auth/me` (the client forces the create-class screen; the backend does not block other endpoints).
- A murid with no active membership also gets `needsOnboarding: true` (their screen is join-by-code) and `activeClass: null`.

---

## 5. Business rules

| ID | Rule | Tested by (service method → exception) |
|---|---|---|
| BR-1 | A member holds **at most one office** (`KETUA` or `BENDAHARA`) at a time; assigning an office to a member who holds the other one frees the other slot. At most one `KETUA` and one `BENDAHARA` per class; the previous holder reverts to `MEMBER` atomically. | `assignRole` → `ForbiddenException` (member inactive) / success path demotes previous holder |
| BR-2 | A student (`MURID`) has **at most one active membership** across all classes at any time. | `join` / `restore` → `ConflictException` |
| BR-3 | Join is rejected with distinct errors: unknown/deleted class `404`; already-in-a-class `409`; locked `403`; full `403`; kicked-before `403`. | `join` → NotFoundException / ConflictException / ForbiddenException |
| BR-4 | `maxStudents` counts only `ACTIVE` members; `null` = unlimited. Lowering below the current count is allowed (blocks joins only). | `update`, `join` |
| BR-5 | Only the homeroom teacher (`homeroomTeacherId`) may update class settings, regenerate the code, kick, restore, and assign roles — checked in the service. | each method → `ForbiddenException` |
| BR-6 | Class code: 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, globally unique among **all** classes (plain unique constraint; deleted classes never release their code), regenerated on demand (old code dies). | `create`, `regenerateCode` (uniqueness retry ≤ 5) |
| BR-7 | Kick is a soft state change: the row stays with `status = KICKED`, `isActive = false`, `leftAt`, `kickedById`, optional reason; all historical rows (reads, votes, payments, uploads) remain. | `kick` (assert row still exists afterwards) |
| BR-8 | A `KETUA`/`BENDAHARA` who is kicked or leaves reverts to `MEMBER` on their (inactive) row. | `kick`, `leave` |
| BR-9 | Announcement edit/delete: author or homeroom teacher only. Delete is soft (`deletedAt`). | `updateAnnouncement`, `deleteAnnouncement` → `ForbiddenException` |
| BR-10 | Read receipts are unique per (announcement, user) and idempotent; `readAt` = first read. Receipt stats count **current active members** only. | `markRead` (idempotent), `getReadReceipts` |
| BR-11 | Schedule slot validity: `startTime < endTime` (400) and no time overlap with another slot on the same `dayOfWeek` in the same class (409). | `createSchedule`, `updateSchedule`, `replaceDay` → BadRequestException / ConflictException |
| BR-11b | `dayOfWeek` ∈ 1..7; `HH:mm` strings in `Asia/Jakarta` local time. | DTO validation |
| BR-12 | Join/restore uses a **transaction with a row lock on the classroom** (`SELECT … FOR UPDATE` via raw `FOR UPDATE`) so parallel joins of the last slot cannot exceed `maxStudents` (verified concurrency rule). | e2e: two parallel joins, one slot |
| BR-13 | Whiteboard upload: 1–5 images, jpg/png/webp, ≤ 5 MB per file, `date` ≤ today (Asia/Jakarta); note is soft-deleted, images removed from Cloudinary async. | `createWhiteboard` → BadRequestException |
| BR-14 | Poll vote: allowed while the poll is open; a vote replaces the previous one (single-choice) or toggles (multi); closed (`closedAt`/deadline past) → `403`. The homeroom teacher never votes. | `vote` → ForbiddenException |
| BR-15 | Cash amounts are integer rupiah > 0; transactions are voided, never deleted (void stores `voidedAt` + reason); a due payment flipped back to `UNPAID` voids its linked income transaction with reason `"payment reverted"`. | `createTransaction`, `voidTransaction`, `updatePayment` |
| BR-16 | Reminder sends are idempotent per (type, refId, user, date): a `NotificationLog` unique row is claimed inside the transaction that creates the inbox entry; losing the unique race = already sent. | `sendReminder` (parallel cron test) |
| BR-17 | OTP verification is atomic per the skill: claim attempt (`attempts < MAX`, not used, not expired) → compare → consume in the success transaction; max 5 attempts; expiry 10 min; resend cooldown 60 s; issuing retires older codes. | `OtpService` (from the reference implementation) |
| BR-18 | Email uniqueness: stored lowercased/trimmed; register on an existing email (verified or not) → `409`, never an overwrite. | `register` → ConflictException |

---

## 6. State machines

### ClassMember
```
            join (murid)                    kick (wali)            restore (wali)
  [none] ───────────────► ACTIVE ────────────────────────► KICKED ──────────────► ACTIVE
                            │  ▲                                                (only if user
                            │  └──── re-join after leave (BR-2 check) ──┐       has no other
                            ▼ leave (self)                              │       active class)
                          LEFT ◄────────────────────────────────────────┘
```
| From | To | Trigger (who) | Side effects |
|---|---|---|---|
| (none) | ACTIVE | join by MURID | Create `ClassMember` (role MEMBER); check BR-2/3/4/12 |
| ACTIVE | KICKED | kick by homeroom teacher | `leftAt`, `kickedById`, reason; role→MEMBER (BR-8); picket memberships removed; device tokens kept (push fan-out excludes non-active members at send time) |
| ACTIVE | LEFT | leave by the member | `leftAt`; role→MEMBER (BR-8); picket memberships removed |
| KICKED | ACTIVE | restore by homeroom teacher | Only if the user has no other active membership (BR-2); clear `kickedById`/`kickReason`; `joinedAt = now`. Restore of a LEFT member → `409 'Member was not kicked — re-join via code'` |
| LEFT | ACTIVE | re-join via code | Reactivates the existing row (same checks as fresh join, BR-2/3/4/12); `joinedAt = now`, `leftAt` cleared |
| KICKED / LEFT | (row stays) | — | The row is never hard-deleted; history keeps referring to it |

### Poll
```
        create (ketua/wali)         close (creator/wali) or deadline passes
  [none] ─────────────► OPEN ────────────────────────────────────► CLOSED
                          │ vote / change vote (members, not wali)
```
| From | To | Trigger | Side effects |
|---|---|---|---|
| (none) | OPEN | create by KETUA/WALI | Options created; push `POLL_NEW` |
| OPEN | CLOSED | close by creator or homeroom teacher, or deadline passes (lazily evaluated) | `closedAt` set; further votes → 403 |

### CashDuePayment
```
   UNPAID ── mark PAID (bendahara) ──► PAID
     ▲                                    │
     └────── revert (bendahara) ──────────┘  (linked income transaction voided, BR-15)
```
| From | To | Trigger | Side effects |
|---|---|---|---|
| UNPAID | PAID | bendahara | `paidAt`, `recordedById`; linked `INCOME` transaction created |
| PAID | UNPAID | bendahara | `paidAt`/`recordedById` cleared; linked transaction voided with reason |

### OtpCode (per the skill, restated for traceability)
```
  issued ── 5 failed attempts / expiry / consumed / superseded by a resend ──► DEAD (usedAt set or attempts exhausted)
```

### User (deactivation)
`ACTIVE ⇄ INACTIVE` via `isActive` (admin/seed only in v1 — no admin endpoints yet; document-only).

---

## 7. Entities (conceptual)

| Entity | Purpose | Key attributes | Relations | Delete behaviour |
|---|---|---|---|---|
| **User** | Account (wali or murid) | id(uuid), name, email(unique, lowercase), passwordHash, globalRole(`WALI_KELAS`\|`MURID`), isActive, emailVerifiedAt, tokenVersion | 1:N memberships, notifications, devices, otp codes | **Soft** (brief): `isActive` flag; history of announcements/cash must stay attributable. No `deletedAt` — `isActive=false` + tokenVersion bump |
| **Classroom** | One class | id, name, schoolName?, academicYear?, code(unique), isLocked, maxStudents?, homeroomTeacherId | 1:N members, announcements, subjects, schedules, whiteboards, picket groups, polls, dues, transactions | **No deletion endpoint in v1** (decided); rows are never removed, so history incl. the cash ledger stays intact |
| **ClassMember** | Membership + per-class role | id, classId, userId, role(`KETUA`\|`BENDAHARA`\|`MEMBER`), status(`ACTIVE`\|`KICKED`\|`LEFT`), isActive, joinedAt, leftAt?, kickedById?, kickReason? | N:1 user, N:1 classroom | **Soft** (brief): rows survive kick/leave so history stays attributable |
| **Announcement** | Broadcast message | id, classId, authorId, title, content, isPinned, postedAt | N:1 author(User), 1:N reads | **Soft** (`deletedAt`): receipts reference it |
| **AnnouncementRead** | Read receipt | announcementId, userId, readAt | pivot with data → timestamps, unique pair | Hard (Remove all) |
| **Subject** | `Mapel` | id, classId, name, teacherName?, color? | N:1 classroom, 1:N schedules/whiteboards | **Soft** (`deletedAt`) once referenced by schedules/whiteboards |
| **LessonSchedule** | Weekly timetable slot | id, classId, subjectId, dayOfWeek 1–7, startTime "HH:mm", endTime, room? | N:1 subject | Hard (decided: slots are hard-deleted; a soft-deleted subject can no longer gain new slots) |
| **WhiteboardNote** | One board capture | id, classId, subjectId, uploaderId, date, caption? | 1:N images, N:1 uploader | **Soft** (`deletedAt`); images deleted from Cloudinary asynchronously |
| **WhiteboardImage** | One photo | id, noteId, url, cloudinaryPublicId, width, height, order | N:1 note (Cascade with note's hard delete only) | Hard with note |
| **PicketGroup** | Duty group per weekday | id, classId, dayOfWeek, name? | 1:N members | Hard (Restrict? no — Cascade with class) |
| **PicketMember** | Assignment | groupId, memberId | pure pivot | Hard (Cascade) |
| **Poll** | Class vote | id, classId, creatorId, question, deadline?, allowMultiple, isAnonymous, closedAt? | 1:N options, 1:N votes | **Soft** (`deletedAt`); votes stay for audit |
| **PollOption** | Choice | id, pollId, label, order | N:1 poll | Cascade with poll |
| **PollVote** | One user's vote(s) | id, pollId, optionId, userId | N:1 poll/option/user; unique (pollId, optionId, userId) | Hard (re-vote deletes+recreates) |
| **CashTransaction** | Fund movement | id, classId, type(INCOME\|EXPENSE), amount Int, description, date, proofUrl?, recordedById, duePaymentId? (unique), voidedAt?, voidReason? | N:1 class, N:1 recorder | **Never deleted** — void only (BR-15) |
| **CashDue** | One iuran | id, classId, title, amount, dueDate?, createdById | 1:N payments | Restrict while payments exist (delete only before any payment) |
| **CashDuePayment** | Member's payment status | id, dueId, memberId, status, paidAt?, recordedById? | unique (dueId, memberId) | Hard |
| **DeviceToken** | FCM token | id, userId, token(unique), platform, lastSeenAt | N:1 user | Hard |
| **Notification** | In-app inbox entry | id, userId, classId?, type, title, body, data Json?, readAt? | N:1 user | Hard, with TTL cleanup later |
| **NotificationLog** | Idempotency for pushes | id, type, refId, userId, sentDate | unique (type, refId, userId, sentDate) | Hard |
| **OtpCode** | Email verification / reset codes | id, userId, purpose, codeHash, attempts, expiresAt, usedAt | N:1 user (Cascade) | Hard |

---

## 8. Non-functional

- **Auth approach**: per the brief — access token only + `tokenVersion` revocation, OTP email verification, `HashingService` async scrypt, throttler per `nest-auth-and-security` (login/register/OTP = 5/min, resend = 3/min, global 100/min), `TRUST_PROXY_HOPS=0` for now. Guard pattern: **per-route `@UseGuards(JwtAuthGuard, RolesGuard)`**, `[PUBLIC]`/`[AUTH]`/`@Roles` prefixes, meta-test `route-guards.e2e-spec.ts` required. No refresh tokens, no Google login.
- **Pagination**: every list endpoint uses `PaginationDto` (page/limit, max 100) and `Paginated` marker; filters declared per endpoint in API_SPEC.
- **Rate-limit hotspots**: login, register, verify-otp, resend-otp, forgot/reset password, join (per code brute-force), device registration.
- **File upload**: whiteboard 1–5 images per note, jpg/png/webp, ≤ 5 MB each, Cloudinary (signed upload from backend), folder `kelasku/<classId>/whiteboard`; max ~15 MB request body.
- **Async jobs**: cron (picket reminder H-1 18:00 WIB, `Asia/Jakarta`), async push fan-out (event-driven, must not block responses), async Cloudinary cleanup. No queue infra in v1 (in-process events), revisit if push fan-out becomes slow.
- **Audit/logging**: `LoggerInterceptor` (existing) for HTTP; log push send failures without tokens; cash voids and role changes are auditable from data (`voidedAt`, `kickedById`, etc.), no separate audit table in v1.
- **Time zone**: store datetimes in UTC; schedules/dates are `Asia/Jakarta` local; cron timezone pinned to `Asia/Jakarta`.
- **Testing**: unit tests per BR (service methods + exceptions listed in section 5), e2e for auth + class flows, route-guards meta-test. See `nest-testing`.
- **i18n**: all user-facing messages, test names, comments and commits in English (global rule 1 of AGENTS.md).

---

## 9. Edge cases & abuse cases

| # | Case | Handling |
|---|---|---|
| 1 | Two students join the last slot in parallel | BR-12: row-lock transaction on the classroom row; exactly one succeeds, the other gets `CLASS_FULL` |
| 2 | Parallel role reassignment (two tabs) | Single `$transaction` demoting the old ketua & promoting the new one; **partial unique indexes** `one_active_ketua` / `one_active_bendahara` (`WHERE role = 'KETUA' AND isActive = true`) as a hard backstop — the loser of the race gets a P2002 → 409 |
| 3 | Duplicate form submits (double-tap) | Unique constraints: (announcement,user) receipt, (poll,option,user) vote, (dueId,memberId); upserts make repeats idempotent |
| 4 | Join-code brute force | Throttle `POST /classrooms/join` (per IP, 6-char alphabet → 33^6 ≈ 1.29 B combos, but still throttled) |
| 5 | OTP brute force | BR-17: atomic attempt claim, max 5, cooldown 60 s, resend throttled |
| 6 | Enumeration via register/forgot/resend | Rule 12: identical responses; register may return 409 (deliberate exception), forgot/resend always identical |
| 7 | Mass assignment (`role`, `isActive`, `status`, `tokenVersion` in body) | Whitelist + `forbidNonWhitelisted` DTOs; role/status are never body fields; assign-role is its own endpoint |
| 8 | Ownership bypass (member edits another's announcement) | Service checks author/wali, throws `ForbiddenException` (BR-9) |
| 9 | Kicked member still holds a valid JWT | Membership checks read the DB per request (service-level, no cache) → 403 immediately |
| 10 | Kicked member's FCM token still subscribed | Push fan-out targets current active members at send time; kicked users are excluded, their device tokens are not class-scoped |
| 11 | Wali of class A tries wali endpoints on class B | BR-5: service checks `homeroomTeacherId` per class |
| 12 | Cash amount tampering (client sends negative/float) | DTO `IsInt` + `Min(1)`; server-side only (BR-15) |
| 13 | Vote after deadline race (request lands exactly at deadline) | Server-time comparison inside the vote transaction; first check wins, late ones get `POLL_CLOSED` |
| 14 | Cloudinary upload succeeds but DB write fails | Upload to Cloudinary **first**, then create the note + image rows in one `$transaction`; if the transaction fails, delete the just-uploaded assets before rethrowing — no orphaned assets, no note without images |
| 15 | Cron double-run (process restart) | BR-16 `NotificationLog` unique claim inside the send transaction |
| 16 | Student tries to join a class while being kicked from another | BR-2 still allows joining a *different* class (one active membership max, not one-ever) |

---

## 10. Out of scope & open questions

**Out of scope (v1)** — per brief: Google login; refresh-token rotation; WebSocket/realtime (polling results refetched via REST); payments/webhooks; assignments/deadline tracker, forum, attendance, exports (ideas only, not confirmed); **deleting a classroom** (decided in the audit round).

**Open questions (for the user, non-blocking):**
1. Should `AnnouncementRead` be created lazily for old announcements when a new member joins? (Proposed: no — receipts are only for members active at read time.)
2. Maximum classes per teacher (proposed: none for MVP).
3. In-app inbox retention (proposed: keep forever in v1).

---

## 11. Traceability

| Feature | BRs | Planned modules (`src/<feature>/`) |
|---|---|---|
| F-AUTH-1..4, F-ONBOARD-1 | BR-17, BR-18 | `auth`, `users` |
| F-CLASS-1..6 | BR-1..BR-8 | `classrooms` (member endpoints live here too) |
| F-ANN-1, F-ANN-2 | BR-9, BR-10 | `announcements` |
| F-SUBJ-1 | — | `subjects` |
| F-SCHED-1 | BR-11, BR-11b | `lesson-schedules` |
| F-WB-1 | BR-13 | `whiteboards` (+ `common/upload` Cloudinary) |
| F-PICKET-1, F-PICKET-2 | BR-16 | `pickets` (the cron lives in `pickets` and calls the shared sender in `src/common/notifications/`) |
| F-POLL-1 | BR-14 | `polls` |
| F-CASH-1, F-CASH-2 | BR-15 | `cash-transactions`, `cash-dues` |
| F-NOTIF-1 | BR-16 | `devices`, `notifications` (the shared push sender lives in `src/common/notifications/`, per `nest-architecture` rules 1+5) |
| (cross) BR-12 row lock | BR-12 | `classrooms` (join/restore transactions) |

Assumptions made while writing this PRD:
1. "Read receipt" statistics are MVP because the brief's feature list #2 includes read receipt in v1 (the old draft had it as Fase 2).
2. Poll creation by wali is allowed (wali as supervisor, confirmed in Q&A); the wali still does not vote.
3. Subject deletion is soft; schedule slots are hard-deleted rows that keep their historical meaning.
4. The `NotificationLog` also covers announcement/poll pushes (type+refId per announcement, not per user) to keep "one push per user per announcement" idempotent under retries — retry re-claims nothing, so the sender dedupes per user with the same log row.
5. Cloudinary asset deletion is best-effort async; failed deletions are logged, not retried in v1.
6. Both self-registration roles (`WALI_KELAS`, `MURID`) receive an access token on successful `verify-otp` (decided in the audit round; a documented deviation from the reference implementation's single-default-role check).
7. Forgot-password is throttled at 5/min per skill rule 10 (only resend-otp stays at 3/min).
8. The wali is never a `ClassMember`; per `per-resource-roles` naming, the app-wide field is `globalRole` (`GlobalRole`) and the per-class field is `role` (`ClassRole`).
