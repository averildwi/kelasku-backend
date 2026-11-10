# Data Model — KelasKu

Prisma schema draft following `nest-prisma`: uuid IDs (decided in the brief), `@@map` on every model, `createdAt`/`updatedAt` everywhere, explicit `onDelete`, soft delete only where the PRD approved it (`User` via `isActive`, `ClassMember` via `status`; plus soft-delete columns on `Announcement`, `Subject`, `WhiteboardNote`, `Poll` for history). Auth models follow `nest-auth-and-security` exactly (`User`, `OtpCode`).

> Final version — supersedes the schema sketch inside `PRD.draft-v1.md` (no `RefreshToken`, no WebSocket tables, OTP flows added).

## Schema draft

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../generated/prisma"
  moduleFormat = "cjs"
}

datasource db {
  provider = "postgresql"
}

// ---------- enums ----------

enum GlobalRole {
  WALI_KELAS
  MURID
}

enum ClassRole {
  KETUA
  BENDAHARA
  MEMBER
}

enum MemberStatus {
  ACTIVE
  KICKED
  LEFT
}

enum OtpPurpose {
  EMAIL_VERIFICATION
  PASSWORD_RESET
}

enum DevicePlatform {
  ANDROID
  IOS
  WEB
}

enum NotificationType {
  ANNOUNCEMENT_NEW
  ROLE_ASSIGNED
  KICKED
  POLL_NEW
  PICKET_REMINDER
  CASH_DUE_NEW
}

enum CashType {
  INCOME
  EXPENSE
}

enum PaymentStatus {
  UNPAID
  PAID
}

// ---------- auth ----------

model User {
  id              String    @id @default(uuid()) @db.Uuid
  name            String
  email           String    @unique // stored lowercased + trimmed (the DTO normalizes it)
  passwordHash    String?
  globalRole      GlobalRole
  avatarUrl       String?
  isActive        Boolean   @default(true)
  emailVerifiedAt DateTime?
  tokenVersion    Int       @default(0)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  otpCodes        OtpCode[]
  memberships     ClassMember[]
  ownedClassrooms Classroom[] @relation("homeroomTeacher")
  announcements   Announcement[]
  whiteboardNotes WhiteboardNote[]
  polls           Poll[]
  cashRecords     CashTransaction[] @relation("recordedBy")
  duesCreated     CashDue[]
  paymentsMarked  CashDuePayment[]  @relation("recordedBy")
  deviceTokens    DeviceToken[]
  notifications   Notification[]
  votes           PollVote[]
  reads           AnnouncementRead[]
  picketSeats     PicketMember[]

  @@map("users")
}

model OtpCode {
  id        String     @id @default(uuid()) @db.Uuid
  userId    String     @db.Uuid
  purpose   OtpPurpose
  codeHash  String
  attempts  Int        @default(0)
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, purpose, createdAt])
  @@map("otp_codes")
}

// ---------- classroom ----------

model Classroom {
  id                String    @id @default(uuid()) @db.Uuid
  name              String
  schoolName        String?
  academicYear      String?
  code              String    @unique // 6 chars, unambiguous alphabet, globally unique among ALL classes (BR-6; classes are never deleted in v1, so no code is ever released)
  isLocked          Boolean   @default(false)
  maxStudents       Int? // caps ACTIVE members only; null = unlimited
  homeroomTeacherId String     @db.Uuid
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  homeroomTeacher   User      @relation("homeroomTeacher", fields: [homeroomTeacherId], references: [id], onDelete: Restrict)

  members           ClassMember[]
  announcements     Announcement[]
  subjects          Subject[]
  lessonSchedules   LessonSchedule[]
  whiteboardNotes   WhiteboardNote[]
  picketGroups      PicketGroup[]
  polls             Poll[]
  cashTransactions  CashTransaction[]
  cashDues          CashDue[]

  @@index([homeroomTeacherId])
  @@map("classrooms")
  // No deletion endpoint in v1 (audit decision): rows are never removed, so
  // every child row (incl. the cash ledger) stays intact without cascade rules.
}

model ClassMember {
  id          String       @id @default(uuid()) @db.Uuid
  classId     String       @db.Uuid
  userId      String       @db.Uuid
  role        ClassRole    @default(MEMBER)
  status      MemberStatus @default(ACTIVE)
  isActive    Boolean      @default(true) // false = KICKED or LEFT (brief decision)
  joinedAt    DateTime     @default(now())
  leftAt      DateTime?
  kickedById  String?      @db.Uuid
  kickReason  String?
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
  classroom   Classroom    @relation(fields: [classId], references: [id], onDelete: Cascade)
  user        User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  kickedBy    User?        @relation("kickedBy", fields: [kickedById], references: [id], onDelete: SetNull)

  picketSeats PicketMember[]

  @@unique([classId, userId])
  @@index([userId, status])
  @@map("class_members")
}

// One active membership per student (BR-2) cannot be a plain unique index in
// Prisma (needs a partial index). Enforced in the service inside the join
// transaction; concurrency answered with pg_advisory_xact_lock(userId) plus
// the classroom row lock (BR-12). Applied manually after migration:
// CREATE UNIQUE INDEX one_active_membership
//   ON "class_members" ("userId") WHERE "isActive" = true;
//
// One office per class among active members (BR-1) gets the same treatment
// (audit finding #5) — applied in the same migration:
// CREATE UNIQUE INDEX one_active_ketua
//   ON "class_members" ("classId") WHERE "role" = 'KETUA' AND "isActive" = true;
// CREATE UNIQUE INDEX one_active_bendahara
//   ON "class_members" ("classId") WHERE "role" = 'BENDAHARA' AND "isActive" = true;
// The service still performs the demote-then-promote write in one $transaction;
// the indexes are the race backstop (the loser gets P2002 -> 409).

// ---------- announcements ----------

model Announcement {
  id        String    @id @default(uuid()) @db.Uuid
  classId   String    @db.Uuid
  authorId  String    @db.Uuid
  title     String
  content   String
  isPinned  Boolean   @default(false)
  deletedAt DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  classroom Classroom    @relation(fields: [classId], references: [id], onDelete: Cascade)
  author    User         @relation(fields: [authorId], references: [id], onDelete: Restrict)
  reads     AnnouncementRead[]

  @@index([classId, isPinned, createdAt])
  @@map("announcements")
}

model AnnouncementRead {
  announcementId String   @db.Uuid
  userId         String   @db.Uuid
  readAt         DateTime @default(now()) // business data, so not a pure pivot
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  announcement   Announcement @relation(fields: [announcementId], references: [id], onDelete: Cascade)
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([announcementId, userId])
  @@map("announcement_reads")
}

// ---------- subjects & schedules ----------

model Subject {
  id          String    @id @default(uuid()) @db.Uuid
  classId     String    @db.Uuid
  name        String
  teacherName String?
  color       String?
  deletedAt   DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  classroom   Classroom       @relation(fields: [classId], references: [id], onDelete: Cascade)
  schedules   LessonSchedule[]
  whiteboards WhiteboardNote[]

  @@index([classId])
  @@map("subjects")
}

model LessonSchedule {
  id        String @id @default(uuid()) @db.Uuid
  classId   String @db.Uuid
  subjectId String @db.Uuid
  dayOfWeek Int // 1 = Monday .. 7 = Sunday
  startTime String // "HH:mm", Asia/Jakarta local
  endTime   String
  room      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  classroom Classroom @relation(fields: [classId], references: [id], onDelete: Cascade)
  subject   Subject   @relation(fields: [subjectId], references: [id], onDelete: Restrict)

  @@index([classId, dayOfWeek])
  @@map("lesson_schedules")
}

// ---------- whiteboard ----------

model WhiteboardNote {
  id         String    @id @default(uuid()) @db.Uuid
  classId    String    @db.Uuid
  subjectId  String    @db.Uuid
  uploaderId String    @db.Uuid
  date       DateTime  @db.Date
  caption    String?
  deletedAt  DateTime?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  classroom  Classroom     @relation(fields: [classId], references: [id], onDelete: Cascade)
  subject    Subject       @relation(fields: [subjectId], references: [id], onDelete: Restrict)
  uploader   User          @relation(fields: [uploaderId], references: [id], onDelete: Restrict)
  images     WhiteboardImage[]

  @@index([classId, date])
  @@index([classId, subjectId])
  @@map("whiteboard_notes")
}

model WhiteboardImage {
  id                String @id @default(uuid()) @db.Uuid
  noteId            String @db.Uuid
  url               String
  cloudinaryPublicId String
  width             Int
  height            Int
  position          Int    @default(0)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  note              WhiteboardNote @relation(fields: [noteId], references: [id], onDelete: Cascade)

  @@index([noteId])
  @@map("whiteboard_images")
}

// ---------- pickets ----------

model PicketGroup {
  id        String @id @default(uuid()) @db.Uuid
  classId   String @db.Uuid
  dayOfWeek Int    // 1..7, one group per weekday per class
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  classroom Classroom      @relation(fields: [classId], references: [id], onDelete: Cascade)
  seats     PicketMember[]

  @@unique([classId, dayOfWeek])
  @@map("picket_groups")
}

model PicketMember {
  groupId   String   @db.Uuid
  memberId  String   @db.Uuid // references ClassMember
  createdAt DateTime @default(now()) // pure pivot: the two FKs plus createdAt only
  group     PicketGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  member    ClassMember @relation(fields: [memberId], references: [id], onDelete: Cascade)

  @@id([groupId, memberId])
  @@map("picket_members")
}

// ---------- polls ----------

model Poll {
  id            String    @id @default(uuid()) @db.Uuid
  classId       String    @db.Uuid
  creatorId     String    @db.Uuid
  question      String
  deadline      DateTime?
  allowMultiple Boolean   @default(false)
  isAnonymous   Boolean   @default(false)
  closedAt      DateTime?
  deletedAt     DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  classroom     Classroom @relation(fields: [classId], references: [id], onDelete: Cascade)
  creator       User      @relation(fields: [creatorId], references: [id], onDelete: Restrict)
  options       PollOption[]
  votes         PollVote[]

  @@index([classId, createdAt])
  @@map("polls")
}

model PollOption {
  id     String @id @default(uuid()) @db.Uuid
  pollId String @db.Uuid
  label  String
  position Int  @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  poll   Poll       @relation(fields: [pollId], references: [id], onDelete: Cascade)
  votes  PollVote[]

  @@index([pollId])
  @@map("poll_options")
}

model PollVote {
  id        String   @id @default(uuid()) @db.Uuid
  pollId    String   @db.Uuid
  optionId  String   @db.Uuid
  userId    String   @db.Uuid
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  poll      Poll       @relation(fields: [pollId], references: [id], onDelete: Cascade)
  option    PollOption @relation(fields: [optionId], references: [id], onDelete: Cascade)
  user      User       @relation(fields: [userId], references: [id], onDelete: Restrict)

  // One vote per option per user; changing the vote is a delete+create pair.
  @@unique([pollId, optionId, userId])
  @@map("poll_votes")
}

// ---------- cash ----------

model CashTransaction {
  id           String    @id @default(uuid()) @db.Uuid
  classId      String    @db.Uuid
  type         CashType
  amount       Int // integer rupiah, > 0
  description  String
  date         DateTime  @db.Date
  proofUrl     String?
  recordedById String    @db.Uuid
  duePaymentId String?   @db.Uuid @unique // set when auto-created by a due payment
  voidedAt     DateTime?
  voidReason   String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  classroom    Classroom       @relation(fields: [classId], references: [id], onDelete: Cascade)
  recordedBy   User            @relation("recordedBy", fields: [recordedById], references: [id], onDelete: Restrict)
  duePayment   CashDuePayment? @relation(fields: [duePaymentId], references: [id], onDelete: SetNull)

  @@index([classId, date])
  @@index([classId, type])
  @@map("cash_transactions")
}

model CashDue {
  id          String    @id @default(uuid()) @db.Uuid
  classId     String    @db.Uuid
  title       String
  amount      Int
  dueDate     DateTime? @db.Date
  createdById String    @db.Uuid
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  classroom   Classroom      @relation(fields: [classId], references: [id], onDelete: Cascade)
  createdBy   User           @relation(fields: [createdById], references: [id], onDelete: Restrict)
  payments    CashDuePayment[]

  @@index([classId, createdAt])
  @@map("cash_dues")
}

model CashDuePayment {
  id           String         @id @default(uuid()) @db.Uuid
  dueId        String         @db.Uuid
  memberId     String         @db.Uuid // references ClassMember (kept after kick/leave)
  status       PaymentStatus  @default(UNPAID)
  paidAt       DateTime?
  recordedById String?        @db.Uuid
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
  due          CashDue        @relation(fields: [dueId], references: [id], onDelete: Cascade)
  member       ClassMember    @relation(fields: [memberId], references: [id], onDelete: Restrict)
  recordedBy   User?          @relation("recordedBy", fields: [recordedById], references: [id], onDelete: SetNull)
  transaction  CashTransaction?

  @@unique([dueId, memberId])
  @@index([memberId])
  @@map("cash_due_payments")
}

// ---------- notifications ----------

model DeviceToken {
  id         String         @id @default(uuid()) @db.Uuid
  userId     String         @db.Uuid
  token      String         @unique
  platform   DevicePlatform
  lastSeenAt DateTime       @default(now())
  createdAt  DateTime       @default(now())
  updatedAt  DateTime       @updatedAt
  user       User           @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("device_tokens")
}

model Notification {
  id        String           @id @default(uuid()) @db.Uuid
  userId    String           @db.Uuid
  classId   String?          @db.Uuid
  type      NotificationType
  title     String
  body      String
  data      Json? // { classId, refId } for deep links
  readAt    DateTime?
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  classroom Classroom? @relation(fields: [classId], references: [id], onDelete: SetNull)

  @@index([userId, readAt, createdAt])
  @@map("notifications")
}

model NotificationLog {
  id       String           @id @default(uuid()) @db.Uuid
  type     NotificationType
  refId    String // announcement / poll / due / picket-group id
  userId   String           @db.Uuid
  sentDate DateTime         @db.Date // day bucket, Asia/Jakarta
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt

  // Claim inside the send transaction: a parallel cron run loses the race and skips (BR-16).
  @@unique([type, refId, userId, sentDate])
  @@map("notification_logs")
}
```

## ER diagram

```text
User 1──N OtpCode
User 1──N ClassMember N──1 Classroom          (Classroom 1──1 homeroomTeacher = User)
User 1──N Announcement N──1 Classroom
Announcement 1──N AnnouncementRead N──1 User
Classroom 1──N Subject 1──N LessonSchedule
Classroom 1──N WhiteboardNote 1──N WhiteboardImage
Classroom 1──N PicketGroup 1──N PicketMember N──1 ClassMember
Classroom 1──N Poll 1──N PollOption 1──N PollVote N──1 User
Classroom 1──N CashTransaction N──1 User (recordedBy)
Classroom 1──N CashDue 1──N CashDuePayment 1──0..1 CashTransaction
User 1──N DeviceToken
User 1──N Notification N──0..1 Classroom
NotificationLog (standalone claim rows, unique type+refId+userId+sentDate)
```

## onDelete decisions

| Entity (relation) | onDelete | Reason |
|---|---|---|
| OtpCode → User | Cascade | Codes are worthless without the user |
| ClassMember → Classroom / User | Cascade | Membership cannot outlive either side; history survives because both sides are only soft-removed in v1 |
| ClassMember.kickedBy → User | SetNull | The kicker account may be deactivated; the kick itself must stay traceable via `kickReason`/`leftAt` |
| Classroom → User (homeroomTeacher) | Restrict | Never lose the owner of a class with data |
| Classroom (the row itself) | No delete in v1 | Audit decision: no `DELETE /classrooms` endpoint, so no cascade problem — the cash ledger and all history stay intact |
| Announcement → Classroom / author | Cascade / Restrict | The author row must stay (user is soft-deleted); announcements live as long as the class, which is never deleted in v1 |
| AnnouncementRead → Announcement / User | Cascade / Cascade | Receipt is meaningless without either side |
| Subject → Classroom | Cascade | Class-scoped |
| LessonSchedule → Subject | Restrict | Subject is soft-deleted when referenced; a hard delete must not orphan slots |
| LessonSchedule → Classroom | Cascade | Class-scoped |
| WhiteboardNote → Classroom / uploader / subject | Cascade / Restrict / Restrict | Notes must stay attributable (kick/leave history) |
| WhiteboardImage → Note | Cascade | Part of the note |
| PicketGroup → Classroom | Cascade | Class-scoped |
| PicketMember → Group / ClassMember | Cascade / Cascade | Assignment dies with either side (kick removes picket seats — PRD F-PICKET-1) |
| Poll → Classroom / creator | Cascade / Restrict | Creator must stay attributable |
| PollOption / PollVote → Poll | Cascade | Part of the poll |
| PollVote → User | Restrict | Votes stay attributable; users are soft-deleted, so this never fires in practice |
| Poll (the row itself) | Soft (`deletedAt`) | Votes stay for audit; deletion by creator or homeroom teacher (PRD F-POLL-1) |
| CashTransaction → Classroom / recordedBy | Cascade / Restrict | Audit trail requires the recorder to exist |
| CashTransaction → CashDuePayment | SetNull | The payment row may be removed while its transaction remains in the ledger |
| CashDue → Classroom / createdBy | Cascade / Restrict | Same audit reasoning |
| CashDuePayment → Due / member | Cascade / Restrict | Payment history must survive; members are soft-removed |
| CashDuePayment → recordedBy | SetNull | Recorder may be deactivated; `paidAt` remains |
| DeviceToken → User | Cascade | Tokens are worthless without the user |
| Notification → User / Classroom | Cascade / SetNull | Inbox dies with the user; `SetNull` is a backstop only — classrooms are never deleted in v1 |
| NotificationLog | — | Standalone; rows are pruned by TTL later, no FK |
