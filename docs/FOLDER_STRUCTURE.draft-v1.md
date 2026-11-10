# Folder Structure — KelasKu Backend

Struktur **feature-based modules** di atas fondasi yang sudah ada (`src/common`, `src/prisma`, `generated/prisma`). Item bertanda `(ada)` sudah tersedia dari `@averildwi/nest-common` / `@averildwi/nest-prisma`; sisanya akan dibuat.

```
kelasku-backend/
├── docs/
│   ├── PRD.md
│   ├── API_SPEC.md
│   └── FOLDER_STRUCTURE.md
├── generated/prisma/                    (ada) output Prisma client — jangan diedit
├── prisma/
│   ├── schema.prisma                    (ada) semua model
│   ├── migrations/                      hasil `prisma migrate dev`
│   └── seed.ts                          data dummy (wali, murid, kelas)
├── src/
│   ├── main.ts                          (ada) + setGlobalPrefix('api/v1'), helmet
│   ├── app.module.ts                    (ada) daftar semua module
│   │
│   ├── common/                          kode lintas modul, tanpa logika bisnis
│   │   ├── config/
│   │   │   ├── app-config.module.ts     (ada)
│   │   │   ├── base-env.schema.ts       (ada)
│   │   │   └── project-env.schema.ts    env tambahan + override JWT_EXPIRES_IN default 15m
│   │   ├── constants/
│   │   │   ├── error-codes.ts           enum ErrorCode (CLASS_LOCKED, CLASS_FULL, ...)
│   │   │   └── notification-types.ts
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts (ada) @CurrentUser('sub') → userId
│   │   │   ├── roles.decorator.ts        (ada) role akun: WALI_KELAS | MURID
│   │   │   ├── class-roles.decorator.ts  @ClassRoles('WALI','KETUA') — pola sama dgn roles.decorator
│   │   │   ├── current-member.decorator.ts  ambil req.classMember — pola sama dgn current-user
│   │   │   ├── public.decorator.ts       @Public() → dibaca JwtAuthGuard
│   │   │   └── to-boolean.decorator.ts   @ToBoolean() — fix 'false' → true dari implicit conversion
│   │   ├── dto/
│   │   │   ├── pagination.dto.ts        (ada) base class semua query DTO list
│   │   │   └── date-range.dto.ts        extends PaginationDto + from / to
│   │   ├── filters/
│   │   │   ├── global-exception.filter.ts  (ada) HTTP
│   │   │   ├── prisma-exception.filter.ts  (ada) HTTP
│   │   │   └── ws-exception.filter.ts      Socket.IO, pakai buildErrorResponse
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts        (ada, DIMODIFIKASI) + Reflector untuk @Public()
│   │   │   ├── roles.guard.ts           (ada) dipakai apa adanya
│   │   │   └── class-role.guard.ts      cek keanggotaan & role dari :classId
│   │   ├── hashing/                     (ada) scrypt — KHUSUS password
│   │   ├── helpers/
│   │   │   ├── error-response.helper.ts (ada) dipakai juga oleh ws-exception.filter
│   │   │   ├── paginate.helper.ts       (ada) bangun meta → dibungkus Paginated
│   │   │   ├── domain-error.helper.ts   domainError(Exception, code, message)
│   │   │   ├── prisma-error.helper.ts   isUniqueViolation(err, field?)
│   │   │   ├── token-hash.helper.ts     sha256 untuk refresh token (deterministik)
│   │   │   ├── class-code.helper.ts     generator kode 6 karakter
│   │   │   └── date.helper.ts           tomorrowDayOfWeek(), WIB utils
│   │   ├── interceptors/                (ada) logger + transform
│   │   ├── pipes/                       (ada) validation pipe config
│   │   └── types/
│   │       ├── jwt-payload.type.ts      JwtPayload { sub, role } — kontrak RolesGuard & CurrentUser
│   │       └── request-context.type.ts  req.user: JwtPayload, req.classMember
│   │
│   ├── prisma/                          (ada) PrismaModule (global) + PrismaService
│   │
│   ├── infra/                           integrasi pihak ketiga
│   │   ├── storage/
│   │   │   ├── storage.module.ts
│   │   │   ├── storage.service.ts       upload/delete Cloudinary
│   │   │   └── image-file.validator.ts  ParseFilePipe: mime & size
│   │   └── firebase/
│   │       ├── firebase.module.ts
│   │       └── firebase.service.ts      firebase-admin messaging
│   │
│   └── modules/
│       ├── auth/                        A1
│       │   ├── auth.module.ts
│       │   ├── auth.controller.ts
│       │   ├── auth.service.ts
│       │   ├── token.service.ts         issue/rotate/revoke refresh token
│       │   ├── strategies/
│       │   │   └── jwt.strategy.ts
│       │   ├── dto/
│       │   │   ├── register.dto.ts
│       │   │   ├── login.dto.ts
│       │   │   ├── refresh-token.dto.ts
│       │   │   └── logout.dto.ts
│       │   └── auth.service.spec.ts
│       │
│       ├── users/                       profil (me)
│       │   ├── users.module.ts
│       │   ├── users.controller.ts
│       │   ├── users.service.ts
│       │   └── dto/{update-profile,change-password}.dto.ts
│       │
│       ├── classes/                     A2–A6
│       │   ├── classes.module.ts
│       │   ├── classes.controller.ts    CRUD kelas, join, leave, regenerate-code
│       │   ├── classes.service.ts
│       │   ├── members.controller.ts    list, kick, restore, assign role
│       │   ├── members.service.ts
│       │   ├── class-access.service.ts  dipakai ClassRoleGuard (resolve role user di kelas)
│       │   ├── dto/
│       │   │   ├── create-class.dto.ts
│       │   │   ├── update-class.dto.ts
│       │   │   ├── join-class.dto.ts
│       │   │   ├── kick-member.dto.ts
│       │   │   ├── assign-role.dto.ts
│       │   │   └── query-members.dto.ts
│       │   └── classes.service.spec.ts  test join: locked, full, race condition
│       │
│       ├── announcements/               B1, B2
│       │   ├── announcements.module.ts
│       │   ├── announcements.controller.ts
│       │   ├── announcements.service.ts
│       │   └── dto/{create,update,query}-announcement.dto.ts
│       │
│       ├── subjects/                    C1 (mapel)
│       │   ├── subjects.module.ts
│       │   ├── subjects.controller.ts
│       │   ├── subjects.service.ts
│       │   └── dto/{create,update}-subject.dto.ts
│       │
│       ├── schedules/                   C1 (jadwal pelajaran)
│       │   ├── schedules.module.ts
│       │   ├── schedules.controller.ts
│       │   ├── schedules.service.ts     cek bentrok jam
│       │   └── dto/{create,update,replace-day,query}-schedule.dto.ts
│       │
│       ├── whiteboards/                 D1
│       │   ├── whiteboards.module.ts
│       │   ├── whiteboards.controller.ts  FilesInterceptor('images', 5)
│       │   ├── whiteboards.service.ts
│       │   └── dto/{create,update,query}-whiteboard.dto.ts
│       │
│       ├── pickets/                     E1, E2
│       │   ├── pickets.module.ts
│       │   ├── pickets.controller.ts
│       │   ├── pickets.service.ts
│       │   ├── pickets.scheduler.ts     @Cron('0 18 * * *') — F2
│       │   └── dto/replace-picket-day.dto.ts
│       │
│       ├── assignments/                 F1, F2 (Fase 2)
│       │   ├── assignments.module.ts
│       │   ├── assignments.controller.ts
│       │   ├── assignments.service.ts
│       │   ├── assignments.scheduler.ts @Cron('0 * * * *')
│       │   └── dto/{create,update,query}-assignment.dto.ts
│       │
│       ├── polls/                       G1
│       │   ├── polls.module.ts
│       │   ├── polls.controller.ts
│       │   ├── polls.service.ts
│       │   ├── polls.gateway.ts         Socket.IO namespace /polls
│       │   ├── ws-jwt.guard.ts          auth handshake
│       │   └── dto/{create-poll,vote,query-poll}.dto.ts
│       │
│       ├── cash/                        H1
│       │   ├── cash.module.ts
│       │   ├── cash.controller.ts       summary + transactions
│       │   ├── cash.service.ts
│       │   ├── dues.controller.ts       iuran & status bayar
│       │   ├── dues.service.ts
│       │   ├── dto/
│       │   │   ├── create-transaction.dto.ts
│       │   │   ├── void-transaction.dto.ts
│       │   │   ├── create-due.dto.ts
│       │   │   ├── update-payment.dto.ts
│       │   │   └── query-transaction.dto.ts
│       │   └── cash.service.spec.ts
│       │
│       └── notifications/               I1
│           ├── notifications.module.ts
│           ├── notifications.controller.ts  inbox
│           ├── devices.controller.ts        register/unregister FCM token
│           ├── notifications.service.ts     sendToClass / sendToUsers (simpan inbox + FCM)
│           ├── notifications.listener.ts    @OnEvent('announcement.created'), dll
│           ├── events/
│           │   └── notification.events.ts   class AnnouncementCreatedEvent, ...
│           └── dto/{register-device,query-notification}.dto.ts
│
└── test/
    ├── jest-e2e.json                    (ada)
    ├── app.e2e-spec.ts                  (ada)
    ├── auth.e2e-spec.ts
    ├── classes.e2e-spec.ts
    └── utils/
        └── test-app.factory.ts          bootstrap app + reset DB
```

---

## Pemanfaatan `src/common`

Prinsip: **pakai yang sudah ada dulu**, tambah file baru hanya untuk kebutuhan yang belum di-cover, dan ikuti pola file yang sudah ada.

### Peta pemakaian

| File (ada) | Status | Dipakai di | Catatan |
|---|---|---|---|
| `config/app-config.module.ts` | apa adanya | `app.module.ts` | `AppConfigModule.forProject(projectEnvSchema)` |
| `config/base-env.schema.ts` | apa adanya | — | Override nilai default lewat `projectEnvSchema` (`concat`), tidak diedit |
| `decorators/current-user.decorator.ts` | apa adanya | semua controller | `@CurrentUser('sub')` = userId, `@CurrentUser()` = `JwtPayload` |
| `decorators/roles.decorator.ts` | apa adanya | `classes` (buat kelas, join) | Untuk **role akun** saja |
| `dto/pagination.dto.ts` | apa adanya | semua query DTO list | `extends PaginationDto`, service pakai `q.skip` & `q.limit` |
| `filters/global-exception.filter.ts` | apa adanya | global | Sumber format error + `error` code domain |
| `filters/prisma-exception.filter.ts` | apa adanya | global | Fallback; P2002 yang punya arti bisnis ditangkap di service |
| `guards/jwt-auth.guard.ts` | **dimodifikasi** | global (`APP_GUARD`) | Tambah dukungan `@Public()` |
| `guards/roles.guard.ts` | apa adanya | global (`APP_GUARD`) | Butuh `req.user.role` dari `JwtStrategy` |
| `hashing/hashing.service.ts` | apa adanya | `auth`, `users` | **Hanya password** (salt acak → tidak bisa di-lookup) |
| `helpers/error-response.helper.ts` | apa adanya | `ws-exception.filter.ts` | Format error WS sama dengan HTTP |
| `helpers/paginate.helper.ts` | apa adanya | service list | Hasilnya dibungkus `Paginated` di controller |
| `interceptors/logger.interceptor.ts` | apa adanya | global (HTTP) | Tidak dipasang di gateway (pakai `switchToHttp`) |
| `interceptors/transform.interceptor.ts` | apa adanya | global | `Paginated`, `MessageResponse`, `RawResponse`, bypass `StreamableFile` |
| `pipes/validation.pipe.config.ts` | apa adanya | global + gateway | `createValidationPipe()` juga dipasang di `PollsGateway` via `@UsePipes` |

### 1. Error domain — tanpa class exception baru

`GlobalExceptionFilter` sudah mengambil `message` & `error` dari object response `HttpException`, jadi cukup:

```ts
// common/constants/error-codes.ts
export enum ErrorCode {
  CLASS_NOT_FOUND = 'CLASS_NOT_FOUND',
  CLASS_LOCKED = 'CLASS_LOCKED',
  CLASS_FULL = 'CLASS_FULL',
  // ...
}

// common/helpers/domain-error.helper.ts
type HttpExceptionCtor = new (objectOrError?: any) => HttpException;

export const domainError = (Ex: HttpExceptionCtor, error: ErrorCode, message: string) =>
  new Ex({ message, error });

// pemakaian di service
throw domainError(ForbiddenException, ErrorCode.CLASS_LOCKED, 'Kelas sedang dikunci');
// → { statusCode: 403, message: 'Kelas sedang dikunci', data: null, error: 'CLASS_LOCKED', timestamp }
```

### 2. Unique violation (P2002) yang punya arti bisnis

`PrismaExceptionFilter` mengubah P2002 jadi `409 "Data sudah ada (duplikat)"` dengan `error: "P2002"`, pesan generik yang tidak cukup untuk client. Untuk kasus spesifik, tangkap di service:

```ts
// common/helpers/prisma-error.helper.ts
import { Prisma } from '../../../generated/prisma/client';

export function isUniqueViolation(err: unknown, field?: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  if (!field) return true;
  const target = (err.meta?.target ?? []) as string[] | string;
  return Array.isArray(target) ? target.includes(field) : target.includes(field);
}
```

| Kasus | Penanganan |
|---|---|
| Register email duplikat | `catch` → `domainError(ConflictException, EMAIL_TAKEN, ...)` |
| Kode kelas bentrok | `catch` → retry generate (maks 5x) |
| Vote ganda / read receipt ganda | Hindari dengan `upsert` / `createMany({ skipDuplicates: true })` |
| Index partial "1 kelas aktif" | `catch` → `ALREADY_IN_CLASS` |

Selain kasus di atas, biarkan jatuh ke `PrismaExceptionFilter`.

### 3. `JwtAuthGuard` global + `@Public()`

```ts
// common/decorators/public.decorator.ts
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// common/guards/jwt-auth.guard.ts (modifikasi)
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) { super(); }

  canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    return isPublic ? true : super.canActivate(ctx);
  }
}

// app.module.ts: urutan penting, Jwt dulu baru Roles
providers: [
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
]
```

`ClassRoleGuard` **tidak** global; dipasang per controller via `@UseGuards(ClassRoleGuard)` karena hanya relevan untuk route `:classId`.

### 4. Kontrak `JwtPayload`

`RolesGuard` membaca `user.role`, `@CurrentUser('sub')` membaca `user.sub`, jadi strategy wajib mengembalikan bentuk ini:

```ts
// common/types/jwt-payload.type.ts
export interface JwtPayload { sub: string; role: 'WALI_KELAS' | 'MURID'; }

// modules/auth/strategies/jwt.strategy.ts
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {   // nama 'jwt' = AuthGuard('jwt')
  constructor(config: ConfigService) {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: config.getOrThrow('JWT_SECRET') });
  }
  validate(payload: JwtPayload): JwtPayload {
    return { sub: payload.sub, role: payload.role };
  }
}
```

### 5. Hashing: password vs refresh token

| Data | Alat | Alasan |
|---|---|---|
| Password | `HashingService` (scrypt + salt acak) | Lambat & ber-salt, verifikasi 1:1 via `verify()` |
| Refresh token | `token-hash.helper.ts` (SHA-256) | Token sudah random 256-bit; butuh hash **deterministik** agar bisa `findUnique({ where: { tokenHash } })` |

```ts
// common/helpers/token-hash.helper.ts
export const generateOpaqueToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
```

### 6. Paginasi: `PaginationDto` → `paginate()` → `Paginated`

`paginate()` mengembalikan object biasa `{ data, meta }`; kalau di-return langsung akan dibungkus lagi menjadi `data: { data, meta }`. Selalu bungkus dengan `Paginated`:

```ts
// dto
export class QueryAnnouncementDto extends PaginationDto {
  @IsOptional() @ToBoolean() @IsBoolean() pinned?: boolean;
}

// service
async findAll(classId: string, q: QueryAnnouncementDto) {
  const where = { classId, deletedAt: null };
  const [items, total] = await this.prisma.$transaction([
    this.prisma.announcement.findMany({ where, skip: q.skip, take: q.limit, orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }] }),
    this.prisma.announcement.count({ where }),
  ]);
  return paginate(items, total, q.page!, q.limit!);
}

// controller
@Get()
async findAll(@Param('classId', ParseUUIDPipe) classId: string, @Query() q: QueryAnnouncementDto) {
  const { data, meta } = await this.service.findAll(classId, q);
  return new Paginated(data, meta);
}
```

### 7. Boolean di query / multipart

`enableImplicitConversion: true` di `validationPipeConfig` mengubah string `'false'` menjadi `true` (`Boolean('false')`). Semua field boolean dari query string / `multipart/form-data` wajib pakai:

```ts
// common/decorators/to-boolean.decorator.ts
export const ToBoolean = () =>
  Transform(({ obj, key }) => {
    const v = obj[key];
    if (v === 'true' || v === true || v === '1') return true;
    if (v === 'false' || v === false || v === '0') return false;
    return v;
  });
```
Dipakai di: `?unread=`, `?pinned=`, `isPinned`, `allowMultiple`, `isAnonymous`, `isLocked`.

### 8. Response khusus dari `TransformInterceptor`

| Kebutuhan | Return |
|---|---|
| List | `new Paginated(data, meta)` |
| Kick / hapus / logout dengan pesan | `new MessageResponse(null, 'Murid berhasil dikeluarkan')` |
| Health check / webhook dengan bentuk bebas | `new RawResponse({...})` |
| Export kas CSV (opsional) | `new StreamableFile(buffer, { type: 'text/csv', disposition: 'attachment; filename="kas.csv"' })` |

### 9. WebSocket (`PollsGateway`)

Filter & interceptor global hanya untuk HTTP. Untuk gateway:

```ts
// common/filters/ws-exception.filter.ts
@Catch()
export class WsExceptionFilter extends BaseWsExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const res = exception instanceof HttpException ? (exception.getResponse() as any) : {};
    client.emit('error', buildErrorResponse(status, res.message ?? 'Terjadi kesalahan', res.error ?? 'WsError'));
  }
}

// modules/polls/polls.gateway.ts
@UseFilters(WsExceptionFilter)
@UsePipes(createValidationPipe())
@WebSocketGateway({ namespace: '/polls', cors: { origin: process.env.FRONTEND_URL?.split(',') ?? '*' } })
export class PollsGateway { /* ... */ }
```
Dengan begini `domainError(...)` dan error validasi dari gateway punya bentuk yang sama dengan REST.

### 10. Env: override tanpa mengedit `base-env.schema.ts`

```ts
// common/config/project-env.schema.ts
export const projectEnvSchema = Joi.object({
  JWT_EXPIRES_IN: Joi.string().default('15m'),          // override default 7d dari base
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),
  CLOUDINARY_CLOUD_NAME: Joi.string().required(),
  CLOUDINARY_API_KEY: Joi.string().required(),
  CLOUDINARY_API_SECRET: Joi.string().required(),
  FIREBASE_PROJECT_ID: Joi.string().required(),
  FIREBASE_CLIENT_EMAIL: Joi.string().required(),
  FIREBASE_PRIVATE_KEY: Joi.string().required(),
  TZ: Joi.string().default('Asia/Jakarta'),
});

// app.module.ts
AppConfigModule.forProject(projectEnvSchema)
```
Refresh token bersifat opaque (bukan JWT) dan di-hash di DB, jadi **tidak butuh `JWT_REFRESH_SECRET`**.

---

## Konvensi

### Penamaan
- File: `kebab-case.<jenis>.ts` (`create-class.dto.ts`, `class-role.guard.ts`).
- Class: `PascalCase` + suffix (`ClassesService`, `CreateClassDto`).
- Route: plural, nested di bawah `/classes/:classId/...` untuk semua resource milik kelas.

### Alur request & otorisasi
```
Request
  → JwtAuthGuard        (APP_GUARD #1, skip jika @Public(); set req.user = JwtPayload)
  → RolesGuard          (APP_GUARD #2, role akun: @Roles('WALI_KELAS'))
  → ClassRoleGuard      (per controller; baca :classId, set req.classMember, cek @ClassRoles(...))
  → ValidationPipe      (createValidationPipe, global)
  → Controller          (tipis: ambil param/DTO, panggil service, bungkus Paginated/MessageResponse)
  → Service             (logika bisnis + Prisma, lempar domainError)
  → TransformInterceptor / GlobalExceptionFilter / PrismaExceptionFilter
```

### Aturan lapisan
- **Controller**: tanpa akses Prisma langsung, tanpa logika bisnis. Pakai `@ApiTags`, `@ApiBearerAuth('access-token')` (nama skema sesuai `main.ts`).
- **Service**: satu-satunya yang memakai `PrismaService`. Operasi multi-tabel pakai `prisma.$transaction`.
- **Antar modul**: hanya lewat service yang di-`exports`, atau lewat **event** (`EventEmitter2`) untuk efek samping seperti notifikasi. Modul fitur tidak meng-import `NotificationsModule` langsung, cukup `emit('announcement.created', payload)`.
- **Error bisnis**: `throw domainError(XxxException, ErrorCode.X, 'pesan')`. Jangan bikin class exception baru.
- **Module global**: `PrismaModule`, `HashingModule`, `AppConfigModule` sudah `@Global()`, jadi **jangan** di-import ulang di feature module.

### Contoh controller lengkap
```ts
@ApiTags('Announcements')
@ApiBearerAuth('access-token')
@UseGuards(ClassRoleGuard)
@Controller('classes/:classId/announcements')
export class AnnouncementsController {
  constructor(private readonly service: AnnouncementsService) {}

  @Post()
  @ClassRoles('WALI', 'KETUA')
  create(
    @Param('classId', ParseUUIDPipe) classId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.service.create(classId, userId, dto);
  }

  @Get()
  async findAll(@Param('classId', ParseUUIDPipe) classId: string, @Query() q: QueryAnnouncementDto) {
    const { data, meta } = await this.service.findAll(classId, q);
    return new Paginated(data, meta);
  }

  @Delete(':id')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentMember() member: ClassMemberContext,
  ) {
    await this.service.remove(id, member);
    return new MessageResponse(null, 'Pengumuman berhasil dihapus');
  }
}
```

### Urutan pengerjaan (selaras milestone PRD)
1. `prisma/schema.prisma` → `common/*` tambahan (lihat bagian di atas) → `modules/auth` → `modules/users`
2. `modules/classes`
3. `infra/firebase` → `modules/notifications`
4. `modules/announcements`, `subjects`, `schedules`, `infra/storage`, `whiteboards`
5. `modules/pickets`, `polls` (+ `ws-exception.filter`), `cash` → **MVP**
6. `assignments`, scheduler piket/tugas, read receipt stats → **Fase 2**
