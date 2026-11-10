# PRD — KelasKu Backend

> Product Requirements Document untuk sisi **backend** aplikasi KelasKu.
> Stack: NestJS 11 · Prisma 7 (PostgreSQL, adapter `pg`) · JWT (access + refresh) · Socket.IO · Firebase Cloud Messaging · Cloudinary · `@nestjs/schedule`.

---

## 1. Ringkasan Produk

KelasKu adalah aplikasi manajemen kelas untuk sekolah. Satu **kelas** dikelola oleh seorang **Wali Kelas**, berisi sejumlah **Murid**, dan beberapa murid bisa diberi peran khusus (**Ketua**, **Bendahara**). Aplikasi menyatukan pengumuman, jadwal pelajaran, catatan papan tulis, jadwal piket, tugas, polling, dan kas kelas, dengan push notification sebagai tulang punggung komunikasi.

### 1.1 Tujuan
- Satu tempat untuk semua informasi kelas (tidak tercecer di grup chat).
- Murid yang tidak masuk tetap bisa mengejar materi (foto papan tulis).
- Transparansi kas kelas & status bayar tiap murid.
- Mengurangi lupa piket / deadline lewat pengingat otomatis.

### 1.2 Di luar cakupan (Non-goals)
- Chat realtime antar user.
- Penilaian / rapor / absensi resmi sekolah.
- Integrasi pembayaran online (kas dicatat manual).
- Multi-sekolah / admin sekolah (bisa ditambah nanti).

---

## 2. Aktor & Role

Ada **2 lapis role**:

### 2.1 Role akun (global, `User.role`)
| Role         | Keterangan |
|--------------|------------|
| `WALI_KELAS` | Guru. Bisa membuat & memegang **banyak kelas**. |
| `MURID`      | Siswa. Hanya bisa tergabung di **1 kelas aktif** dalam satu waktu. |

### 2.2 Role di dalam kelas (per kelas, efektif)
| Role kelas  | Sumber | Keterangan |
|-------------|--------|------------|
| `WALI`      | `Classroom.homeroomTeacherId` | Pemilik kelas. |
| `KETUA`     | `ClassMember.role` | Maks. 1 per kelas, ditunjuk wali. |
| `BENDAHARA` | `ClassMember.role` | Maks. 1 per kelas, ditunjuk wali. |
| `MEMBER`    | `ClassMember.role` | Murid biasa (default saat join). |
| `SYSTEM`    | — | Cron job & notifikasi otomatis. |

> Satu murid hanya punya satu role kelas. Jika murid yang sedang `BENDAHARA` dijadikan `KETUA`, role bendaharanya lepas (dan sebaliknya). Ketua/Bendahara lama otomatis turun ke `MEMBER`.

### 2.3 Matriks Akses Ringkas
| Aksi | WALI | KETUA | BENDAHARA | MEMBER |
|------|:----:|:-----:|:---------:|:------:|
| Kelola kelas (lock, kuota, kick, assign role) | ✅ | ❌ | ❌ | ❌ |
| Buat pengumuman | ✅ | ✅ | ❌ | ❌ |
| Lihat read receipt pengumuman (F2) | ✅ | ✅ | ❌ | ❌ |
| CRUD mapel & jadwal pelajaran | ✅* | ✅ | ❌ | ❌ |
| Upload catatan papan tulis | ❌** | ✅ | ✅ | ✅ |
| Atur jadwal piket | ✅* | ✅ | ❌ | ❌ |
| CRUD tugas (F2) | ✅ | ✅ | ❌ | ❌ |
| Buat polling | ✅ | ✅ | ❌ | ❌ |
| Vote polling | ❌ | ✅ | ✅ | ✅ |
| Catat kas & status bayar | ❌*** | ✅ | ✅ | ❌ |
| Lihat semua data kelas | ✅ | ✅ | ✅ | ✅ |

\* Di tabel fitur hanya Ketua; Wali diberi akses juga sebagai *supervisor* (bisa dimatikan).
\*\* Wali boleh menghapus catatan yang tidak pantas (moderasi).
\*\*\* Wali hanya *read-only* untuk kas.

---

## 3. Breakdown Fitur

Legenda prioritas: **MVP** = rilis pertama, **F2** = Fase 2.

### Modul A — Auth & Kelas

#### A1. Register / Login — `MVP` — Wali Kelas, Murid
- Register: `name`, `email`, `password`, `role` (`WALI_KELAS` | `MURID`).
- Login email + password → `accessToken` JWT (`JWT_EXPIRES_IN`, 15m) + `refreshToken` opaque (`JWT_REFRESH_EXPIRES_IN`, 30d).
- Payload access token: `JwtPayload { sub, role }`, sesuai kontrak `RolesGuard` (`user.role`) & `@CurrentUser('sub')`.
- Refresh token = random 32 byte (bukan JWT), **dirotasi** tiap dipakai, disimpan **SHA-256**-nya di DB (`RefreshToken.tokenHash`, deterministik agar bisa di-lookup), bisa di-revoke (logout / logout semua device).
- Password di-hash memakai `HashingService` (scrypt) yang sudah ada. **Hanya untuk password**, karena salt acak membuat hasilnya tidak bisa dipakai untuk lookup token.
- Email duplikat: tangkap P2002 di service → `409 EMAIL_TAKEN` (bukan pesan generik `PrismaExceptionFilter`).
- `GET /auth/me` mengembalikan profil + `activeClass` / `classes` + flag `needsOnboarding`.

**Acceptance criteria**
- Email unik (case-insensitive, disimpan lowercase).
- Password min. 8 karakter.
- Refresh token yang sudah dipakai ulang → semua token user di-revoke (reuse detection).

#### A2. Buat kelas + generate kode unik — `MVP` — Wali Kelas
- Input: `name` (mis. "XII IPA 2"), `schoolName?`, `academicYear?`, `maxStudents?`.
- Sistem membuat `code` 6 karakter dari alfabet tanpa karakter ambigu (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`), retry bila bentrok (unique index).
- **Wajib setelah buat akun**: wali tanpa kelas → `needsOnboarding = true`; frontend memaksa ke layar buat kelas. Backend tidak memblokir endpoint lain, cukup flag.
- Wali bisa **regenerate kode** (kode lama hangus).

#### A3. Join kelas via kode — `MVP` — Murid
Validasi berurutan (pesan error berbeda tiap kasus):
1. Kode ada & kelas tidak dihapus → `404 CLASS_NOT_FOUND`.
2. Murid belum punya kelas aktif → `409 ALREADY_IN_CLASS`.
3. Kelas tidak `isLocked` → `403 CLASS_LOCKED`.
4. Jumlah member aktif `< maxStudents` (jika di-set) → `403 CLASS_FULL`.
5. Murid pernah di-kick dari kelas ini → `403 KICKED_FROM_CLASS` (wali bisa *un-kick* / restore).

Langkah 2–4 dijalankan di **transaksi** (`SELECT ... FOR UPDATE` pada baris kelas) agar kuota tidak jebol saat join bersamaan.

#### A4. Kick murid — `MVP` — Wali Kelas
- **Soft delete**: `ClassMember.status = KICKED`, isi `leftAt`, `kickedById`, `kickReason?`.
- Data historis (pengumuman dibaca, vote, catatan papan tulis, pembayaran kas) **tetap tersimpan** dan tetap tampil dengan nama murid.
- Jika yang di-kick Ketua/Bendahara → role dilepas.
- Murid ter-kick langsung kehilangan akses ke endpoint kelas (dicek di `ClassRoleGuard`), device token di-unsubscribe dari topic kelas.
- Murid juga bisa **keluar sendiri** (`status = LEFT`).

#### A5. Lock kelas / limit maksimal siswa — `MVP` — Wali Kelas
- `isLocked: boolean` dan `maxStudents: int | null`.
- Menurunkan `maxStudents` di bawah jumlah member aktif diperbolehkan, hanya mencegah join baru.

#### A6. Assign role Ketua (+ Bendahara) — `MVP` — Wali Kelas
- `PATCH /classes/:classId/members/:memberId/role` body `{ role: KETUA | BENDAHARA | MEMBER }`.
- Maks. 1 Ketua & 1 Bendahara: pemegang lama otomatis jadi `MEMBER` dalam satu transaksi.
- Kirim notifikasi ke murid yang ditunjuk.

---

### Modul B — Announcement

#### B1. Buat & kirim pengumuman — `MVP` — Ketua, Wali Kelas
- Field: `title`, `content`, `isPinned?`, `attachments?` (opsional, Cloudinary).
- Setelah tersimpan → push notification FCM ke semua member aktif kelas (kecuali pembuat) + simpan ke inbox `Notification`.
- Edit & hapus (soft delete) oleh pembuat atau Wali.
- List: pinned di atas, lalu terbaru; paginasi.

#### B2. Read receipt — `F2` — Ketua, Wali Kelas
- Tabel `AnnouncementRead (announcementId, userId, readAt)` — unique pair.
- Client memanggil `POST /announcements/:id/read` saat membuka detail (idempotent).
- `GET .../reads` → `{ readCount, unreadCount, read: [...], unread: [...] }` dihitung terhadap member aktif saat ini.
- Catatan: tabel bisa dibuat sejak MVP agar endpoint `read` sudah dipanggil client, hanya endpoint statistik yang F2.

---

### Modul C — Jadwal Pelajaran

#### C1. Set jadwal pelajaran — `MVP` — Ketua
- **Mapel (`Subject`)** per kelas: `name`, `teacherName`, `color?`. Dipakai juga untuk tag papan tulis & tugas.
- **Jadwal (`LessonSchedule`)**: `dayOfWeek` (1=Senin … 7=Minggu), `startTime`, `endTime` (format `HH:mm`, zona `Asia/Jakarta`), `subjectId`, `room?`.
- Validasi: `startTime < endTime`, tidak boleh bentrok dengan slot lain di hari yang sama.
- Endpoint `GET .../schedules?day=` dan `GET .../schedules/today`.
- Opsional: endpoint *bulk replace* satu hari untuk kemudahan UI.

---

### Modul D — Papan Tulis

#### D1. Upload foto catatan papan tulis — `MVP` — Ketua, Murid
- Upload `multipart/form-data`: `images[]` (1–5 file, jpg/png/webp, maks 5 MB/file), `subjectId`, `date` (YYYY-MM-DD), `caption?`.
- File diunggah ke **Cloudinary** folder `kelasku/{classId}/whiteboard`, yang disimpan: `url`, `publicId`, `width`, `height`.
- Filter list: `subjectId`, `date`, `from`/`to`; urut tanggal terbaru.
- Hapus: uploader, Ketua, atau Wali (soft delete + hapus asset di Cloudinary via job).

---

### Modul E — Jadwal Piket

#### E1. Atur jadwal piket — `MVP` — Ketua
- `PicketGroup` per hari: `dayOfWeek`, `name?` (mis. "Kelompok Senin"), daftar member.
- Satu murid boleh di lebih dari satu hari (fleksibel), namun tidak dobel di hari yang sama.
- Endpoint replace anggota satu hari (`PUT`) agar UI drag-and-drop gampang.
- `GET .../pickets/me` → hari piket saya.
- Member yang di-kick otomatis dikeluarkan dari grup piket.

#### E2. Reminder H-1 piket — `F2` — Sistem
- Cron setiap hari **18:00 WIB**: cari grup piket dengan `dayOfWeek = besok`, kirim push ke anggotanya.
- Hanya hari sekolah (konfigurasi `SCHOOL_DAYS`, default Senin–Jumat); opsional tabel libur nanti.
- Idempotensi lewat `NotificationLog` (unique `type + refId + userId + date`) agar tidak dobel kalau cron jalan dua kali.

---

### Modul F — Tugas

> Tabel fitur hanya menyebut *reminder*; agar reminder bisa jalan, dibutuhkan **CRUD tugas** (diasumsikan Fase 2 bersama reminder-nya).

#### F1. CRUD tugas — `F2` — Ketua, Wali Kelas
- Field: `title`, `description?`, `subjectId`, `deadline` (datetime), `attachments?`.
- Push notif ke kelas saat tugas baru dibuat.

#### F2. Reminder H-1 deadline — `F2` — Sistem
- Cron tiap jam: tugas dengan `deadline` di rentang `[now+24h, now+25h)` dan `reminderSentAt IS NULL` → kirim push ke semua member aktif, set `reminderSentAt`.

---

### Modul G — Polling

#### G1. Buat & vote polling — `MVP`
- Pembuat: Ketua, Wali. Voter: semua murid aktif.
- Field: `question`, `options[]` (2–10), `deadline?`, `allowMultiple` (default false), `isAnonymous` (default false).
- Vote: satu kali per user (bisa **ganti pilihan** sebelum deadline). Lewat deadline / ditutup manual → `403 POLL_CLOSED`.
- **Hasil realtime** via Socket.IO namespace `/polls`, room `poll:{pollId}` → event `poll:results` setiap ada vote.
- Jika `isAnonymous`, daftar voter per opsi tidak dikembalikan.
- Push notif saat polling baru dibuat.

---

### Modul H — Kas Kelas

#### H1. Catat pemasukan/pengeluaran + status bayar — `MVP` — Ketua, Bendahara
- **Transaksi kas (`CashTransaction`)**: `type` (`INCOME` | `EXPENSE`), `amount` (integer rupiah), `description`, `date`, `proofImage?`.
- **Iuran (`CashDue`)**: tagihan per murid, mis. "Kas Minggu 1 Oktober" `amount = 5000`, `dueDate`. Saat dibuat, sistem membuat `CashDuePayment` status `UNPAID` untuk setiap member aktif.
- Tandai bayar → `PAID`, `paidAt`, `recordedById`; otomatis membuat `CashTransaction INCOME` yang terhubung (dibatalkan → transaksi ikut di-void).
- Ringkasan: `balance`, `totalIncome`, `totalExpense`, tunggakan per murid.
- Transaksi **tidak dihapus permanen**: hanya `void` dengan alasan (audit trail).
- Semua member bisa melihat ringkasan & status bayar (transparansi).

---

### Modul I — Notifikasi

#### I1. Push notification (FCM) — `MVP` — Sistem
- `DeviceToken`: `userId`, `token` (unique), `platform` (`ANDROID` | `IOS` | `WEB`), `lastSeenAt`. Register saat login, hapus saat logout.
- `NotificationService.sendToClass(classId, payload, { excludeUserIds })` dan `sendToUsers(userIds, payload)` — kirim via `firebase-admin` `sendEachForMulticast` (batch 500), token invalid (`registration-token-not-registered`) otomatis dihapus.
- Setiap notifikasi juga disimpan di tabel `Notification` (inbox in-app): `type`, `title`, `body`, `data` (JSON deep-link), `readAt`.
- Pengiriman **asynchronous** (tidak memblokir response API) — MVP memakai `EventEmitter2` (`@nestjs/event-emitter`); bisa ditingkatkan ke BullMQ + Redis bila beban naik.
- Payload `data` standar: `{ type, classId, refId }` untuk deep-link di app.

Tipe notifikasi: `ANNOUNCEMENT_NEW`, `ROLE_ASSIGNED`, `KICKED`, `POLL_NEW`, `ASSIGNMENT_NEW`, `PICKET_REMINDER`, `ASSIGNMENT_REMINDER`, `CASH_DUE_NEW`.

---

## 4. Model Data (Draft Prisma)

```prisma
enum UserRole        { WALI_KELAS MURID }
enum ClassMemberRole { MEMBER KETUA BENDAHARA }
enum MemberStatus    { ACTIVE KICKED LEFT }
enum Platform        { ANDROID IOS WEB }
enum CashType        { INCOME EXPENSE }
enum PaymentStatus   { UNPAID PAID }

model User {
  id           String   @id @default(uuid())
  name         String
  email        String   @unique
  passwordHash String
  role         UserRole
  avatarUrl    String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  // relations: memberships, ownedClasses, refreshTokens, deviceTokens, notifications ...
}

model RefreshToken {
  id        String    @id @default(uuid())
  userId    String
  tokenHash String    @unique   // sha256(token), BUKAN HashingService
  family    String    // untuk reuse detection
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())
}

model Classroom {
  id                String    @id @default(uuid())
  name              String
  schoolName        String?
  academicYear      String?
  code              String    @unique
  isLocked          Boolean   @default(false)
  maxStudents       Int?
  homeroomTeacherId String
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  deletedAt         DateTime?
}

model ClassMember {
  id         String          @id @default(uuid())
  classId    String
  userId     String
  role       ClassMemberRole @default(MEMBER)
  status     MemberStatus    @default(ACTIVE)
  joinedAt   DateTime        @default(now())
  leftAt     DateTime?
  kickedById String?
  kickReason String?
  @@unique([classId, userId])
  @@index([userId, status])
}
// + partial unique index via SQL migration:
//   CREATE UNIQUE INDEX one_active_class_per_user ON "ClassMember"("userId") WHERE status = 'ACTIVE';

model Announcement      { id, classId, authorId, title, content, isPinned, createdAt, updatedAt, deletedAt }
model AnnouncementRead  { announcementId, userId, readAt  @@id([announcementId, userId]) }

model Subject           { id, classId, name, teacherName, color?, deletedAt }
model LessonSchedule    { id, classId, subjectId, dayOfWeek Int, startTime String, endTime String, room? }

model WhiteboardNote    { id, classId, subjectId, uploaderId, date DateTime @db.Date, caption?, createdAt, deletedAt }
model WhiteboardImage   { id, noteId, url, publicId, width, height, order }

model PicketGroup       { id, classId, dayOfWeek Int, name?  @@unique([classId, dayOfWeek]) }
model PicketMember      { groupId, memberId  @@id([groupId, memberId]) }

model Assignment        { id, classId, subjectId, creatorId, title, description?, deadline, reminderSentAt?, deletedAt }

model Poll              { id, classId, creatorId, question, deadline?, allowMultiple, isAnonymous, closedAt?, createdAt, deletedAt }
model PollOption        { id, pollId, label, order }
model PollVote          { id, pollId, optionId, userId, createdAt  @@unique([pollId, optionId, userId]) }

model CashTransaction   { id, classId, type CashType, amount Int, description, date, proofUrl?, recordedById, duePaymentId? @unique, voidedAt?, voidReason? }
model CashDue           { id, classId, title, amount Int, dueDate?, createdById, createdAt }
model CashDuePayment    { id, dueId, memberId, status PaymentStatus, paidAt?, recordedById?  @@unique([dueId, memberId]) }

model DeviceToken       { id, userId, token @unique, platform Platform, lastSeenAt }
model Notification      { id, userId, classId?, type, title, body, data Json?, readAt?, createdAt }
model NotificationLog   { id, type, refId, userId, sentDate  @@unique([type, refId, userId, sentDate]) }
```

Catatan desain:
- Relasi data historis mengarah ke `ClassMember`/`User`, bukan dihapus → syarat soft-delete kick terpenuhi.
- Uang disimpan `Int` (rupiah) — hindari float.
- Semua waktu disimpan UTC; jam pelajaran disimpan string `HH:mm` lokal `Asia/Jakarta`.

---

## 5. Kebutuhan Non-Fungsional

| Area | Requirement |
|------|-------------|
| Format response | Mengikuti `TransformInterceptor` & `GlobalExceptionFilter` yang sudah ada (`statusCode`, `message`, `data`, `meta?`, `timestamp`). List = `Paginated`, pesan custom = `MessageResponse`. |
| Error domain | `throw new XxxException({ message, error: ErrorCode.X })` via helper `domainError()`; tanpa class exception baru. Socket.IO memakai `WsExceptionFilter` + `buildErrorResponse` agar formatnya identik. |
| Validasi | `class-validator` via `createValidationPipe()` (whitelist + forbidNonWhitelisted), juga dipasang di gateway. Field boolean dari query/multipart wajib `@ToBoolean()` (efek `enableImplicitConversion`). |
| Otorisasi | `JwtAuthGuard` (global, dimodifikasi untuk `@Public()`) → `RolesGuard` (global, role akun) → `ClassRoleGuard` (per controller, role dalam kelas dari `:classId`). |
| Keamanan | Hash password scrypt, rate limit login/join (`@nestjs/throttler`), Helmet, CORS dari `FRONTEND_URL`. |
| Dokumentasi | Swagger di `/docs` (sudah di-setup). |
| Performa | Endpoint list dipaginasi (`PaginationDto`, default 20, maks 100). Index pada `classId` di semua tabel kelas. |
| Zona waktu | `TZ=Asia/Jakarta` untuk cron. |
| Testing | Unit test service (Jest) untuk logika kritikal: join kelas, assign role, kas; e2e untuk alur auth & kelas. |
| Observability | `LoggerInterceptor` yang sudah ada; log error FCM. |

### Env tambahan
Divalidasi oleh `common/config/project-env.schema.ts` lewat `AppConfigModule.forProject(projectEnvSchema)`; `base-env.schema.ts` tidak diedit.
```
JWT_EXPIRES_IN=15m            # override nilai 7d di .env lama
JWT_REFRESH_EXPIRES_IN=30d    # refresh token opaque → tidak perlu JWT_REFRESH_SECRET
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
TZ=Asia/Jakarta
```

### Dependency tambahan
`@nestjs/jwt`, `passport`, `passport-jwt`, `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`, `@nestjs/schedule`, `@nestjs/event-emitter`, `@nestjs/throttler`, `firebase-admin`, `cloudinary`, `multer` types (`@types/multer`), `helmet`.

---

## 6. Rencana Milestone

| Sprint | Isi | Output |
|--------|-----|--------|
| **S0 — Fondasi** | Schema Prisma lengkap + migrasi; tambahan `common/` (`ErrorCode`, `domainError`, `@Public`, `@ToBoolean`, `JwtPayload`, `token-hash`, `prisma-error`, `project-env.schema`, modifikasi `JwtAuthGuard`, `APP_GUARD`); AuthModule (register/login/refresh/logout/me), JWT strategy, `ClassRoleGuard` | Bisa login & akses endpoint terproteksi |
| **S1 — Kelas** | A2–A6: buat kelas, kode, join, kick, lock/limit, assign role, list member | Alur onboarding lengkap |
| **S2 — Notifikasi** | I1: DeviceToken, NotificationService (FCM), inbox, event emitter | Infrastruktur push siap dipakai modul lain |
| **S3 — Konten** | B1 pengumuman (+ endpoint `read`), C1 mapel & jadwal, D1 papan tulis (Cloudinary) | Fitur harian kelas |
| **S4 — Kolaborasi** | E1 piket, G1 polling + Socket.IO, H1 kas & iuran | **Rilis MVP** |
| **S5 — Fase 2** | B2 statistik read receipt, F1 CRUD tugas, E2 & F2 cron reminder | Rilis Fase 2 |

---

## 7. Asumsi & Pertanyaan Terbuka
1. Role pembuat polling tidak eksplisit di tabel → diasumsikan **Ketua & Wali**, voter semua murid.
2. CRUD tugas tidak ada di tabel tapi dibutuhkan untuk reminder → dijadwalkan **Fase 2**.
3. Wali diberi akses tulis jadwal pelajaran & piket sebagai supervisor — konfirmasi apakah perlu dibatasi ke Ketua saja.
4. Apakah murid boleh pindah kelas (keluar lalu join kelas lain)? → Diasumsikan **boleh** (keluar dulu).
5. Lupa password (reset via email) belum termasuk MVP.
