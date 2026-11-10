# Spec Audit — KelasKu (PRD / DATA_MODEL / API_SPEC vs skills)

## 1. Verdict

**FIX FIRST**

Three blockers (one self-contradiction inside the PRD, one PRD-vs-DATA_MODEL contradiction that would destroy the cash audit trail, one auth-flow contradiction) plus several major gaps must be resolved before implementation starts.

## 2. Findings

### 2a. Checklist PASS / FAIL

**Auth and access**

| Check | Result | Location / evidence |
|---|---|---|
| Every endpoint has a guard decision; prefix equals guards/roles | PASS | API_SPEC every table has a Guard column; "Constraints check" §1 states the rule explicitly; no `[X]` prefix allows a wider `@Roles` list anywhere. |
| No `role`/`isActive`/`tokenVersion` in request bodies (register exception) | PASS | API_SPEC "Constraints check" §6; only `RegisterDto.role` and `AssignRoleDto.role`, both declared as the sole allowed inputs. No password policy duplicated. |
| No endpoint leaks account existence; status checked after password | PASS | API_SPEC "Users" errors note + "Constraints check" §7; matches skill rule 12 and reference-implementation login order. |
| Throttle on login-like/code-sending endpoints; none at class level; global throttler | PASS (one value deviates) | API_SPEC "Constraints check" §4. FAIL detail: `forgot-password` = 3/min, but skill rule 10 table puts forgot-password in the **5** group (only resend-otp/"send me a code" is 3). See table row 8. |
| Every `:id` has a pipe matching uuid | PASS | API_SPEC "Conventions" bullet 7 + "Constraints check" §3; `:day` explicitly handled with int bounds. |
| Ownership rules for every "only the owner/leader may..." PRD sentence; per-resource checks service-level; Swagger prefixes list only app-wide roles | PASS | PRD §2 closing paragraph; API_SPEC "Conventions" bullet 8 + per-endpoint descriptions; matches `per-resource-roles.md` checklist. |
| Auth endpoint set/shapes match rule 21 | PARTIAL FAIL | All endpoints, field name `accessToken`, `MessageResponse` for login, `/auth/me` profile, `logout-all`, OTP purposes, register-never-updates — present. FAIL: rule 11 says only the **default self-registration role** gets a token on verify; the reference (`AuthService.verifyEmail`, `verified.role !== DEFAULT_ROLE → null`) issues a token to **nobody** when both self-registered roles are `WALI_KELAS`/`MURID`. API_SPEC "Auth" table (`verify-otp → 200 { accessToken }`) does not address this. See table row 6. |
| tokenVersion bumps on reset/change/logout-all | PASS | API_SPEC Auth table rows reset-password/change-password/logout-all; PRD §7 User row. |
| Route-guard meta-test reflected in docs | PARTIAL FAIL | PRD §8 "Testing" names `route-guards.e2e-spec.ts`; API_SPEC "Test targets" table omits it entirely. See table row 17. |

**Data (nest-prisma)**

| Check | Result | Location / evidence |
|---|---|---|
| `@@map` on every model | PASS | DATA_MODEL schema — every model carries `@@map(...)` including `notification_logs`. |
| Both timestamps on every model (pure-pivot exception) | PASS | All models have `createdAt`+`updatedAt`. `PicketMember` has `createdAt` only and nothing but the two FKs → qualifies for the rule-3 pure-pivot exception (PRD §7 also calls it "pure pivot"). `AnnouncementRead` correctly does **not** use the exception: it carries `readAt` business data and has both timestamps. |
| Explicit `onDelete` on every relation | PASS | DATA_MODEL "onDelete decisions" table covers every FK; `NotificationLog` has no FK (declared standalone). |
| Soft delete only where approved | PASS | `deletedAt` on Announcement/Subject/WhiteboardNote/Poll only; User via `isActive`, ClassMember via `status`+`isActive`; CashTransaction void-only (`voidedAt`/`voidReason`); no other soft columns. |
| uuid ID type consistent, `@db.Uuid`, ParseUUIDPipe in spec | PASS | Every `@id`/FK is `@db.Uuid` (polymorphic `NotificationLog.refId` reasonably plain); API_SPEC conventions bullet 7. |
| Multi-step writes flagged for `$transaction` | FAIL | Join/restore/assign-role/kick/leave are flagged (API_SPEC Classrooms notes), but due creation (due + snapshot payment rows), pay (payment + linked income transaction), unpay (payment + void transaction), vote replace (delete+create), whiteboard create (note + N images) are **not** flagged anywhere. See table row 9. |
| Concurrency answers for every limit rule | PARTIAL FAIL | `maxStudents`: BR-12 row lock + e2e (PASS). One active membership: partial unique index + `pg_advisory_xact_lock` (DATA_MODEL comment, PASS). One office per member (BR-1): PRD §9 case 2 claims "unique/partial index as a backstop" but DATA_MODEL contains **no** such index — service transaction only. See table row 5. |
| No N+1 implied; list+count uses `$transaction([findMany, count])` | PARTIAL FAIL | List+count rule stated in API_SPEC conventions. N+1: due snapshot (20–40 payment rows) and push fan-out/inbox rows are not stated as `createMany`/batch; whiteboard images likewise. See table row 9. |

**Responses and validation**

| Check | Result | Location / evidence |
|---|---|---|
| Markers named correctly; no `{ message, data }` from services; RawResponse only for third parties | PASS | API_SPEC "Conventions" bullet 1; no RawResponse usage (none needed); no service-level envelope described. |
| Status codes (201 creates / 200 non-create POST / 409 / 403 / 404 / 400) | PASS | Every create returns 201; every state-change POST documented as 200 ("Constraints check" §2); 409 register/join/already-voided; 403 ownership rows; 404 missing; 400 invalid state. |
| Query booleans `@ToBoolean`; list DTOs extend PaginationDto | PASS | API_SPEC conventions bullet 4; `isPinned`/`unread` filters; non-paginated lists justified (≤7, ≤~50). |
| Every implied env var consistent and listed somewhere | FAIL | No document lists the env var set. Implied but never named: `OTP_SENDER`, `FIREBASE_*` (FCM service account), `CLOUDINARY_*`, `TZ`; `JWT_*`, `OTP_TTL_MINUTES`, `OTP_RESEND_COOLDOWN_SECONDS`, `RESEND_API_KEY`, `MAIL_FROM`, `TRUST_PROXY_HOPS`, `FRONTEND_URL`, `PORT`, `NODE_ENV`, `DATABASE_URL` are only implied. Skill rule 25 requires them in `projectEnvSchema` + `.env.example`. See table row 10. |
| Messages English, short, sentence case, no trailing period | PASS | All quoted messages comply ("You already belong to a class", "Email is already registered"); business codes (`CLASS_LOCKED`, `POLL_CLOSED`, `SCHEDULE_CONFLICT`) are identifiers, not prose. |

**Traceability**

| Check | Result | Location / evidence |
|---|---|---|
| Every F-ID maps to endpoints and BRs | PASS | API_SPEC "Coverage matrix" covers F-AUTH-1..F-NOTIF-1 (F-PICKET-2 = declared cron). |
| Every BR maps to a test target | PARTIAL FAIL | BR-1..BR-18 present in "Test targets" except **BR-11b** (dayOfWeek 1..7 / HH:mm validation). See table row 18. |
| No orphan endpoints | PARTIAL FAIL | `DELETE /classrooms/:classId` maps to F-CLASS-1 but no PRD feature/access-table row grants class deletion, and its semantics contradict PRD §7. `DELETE .../polls/:id`, `DELETE .../votes` (withdraw) and whiteboard PATCH exist only in API_SPEC — PRD F-POLL-1/F-WB-1 never describe them. See rows 3, 14. |

**State machines (endpoint + role + invalid-state error per transition)**

| Check | Result | Location / evidence |
|---|---|---|
| ClassMember | PARTIAL FAIL | join/kick/restore/leave all have endpoints, roles and errors — except: kick of a non-`ACTIVE` member has no defined error; re-join after `LEFT` has no defined row semantics (see row 7); restore of a `LEFT` member undefined (restore is KICKED-only). |
| Poll | PASS | create (WALI/KETUA), close (creator/homeroom), vote-when-closed → 403, deadline lazily evaluated. |
| CashDuePayment | PARTIAL FAIL | pay/unpay defined with roles and linked-transaction side effects, but paying an already-`PAID` payment has no defined error (unique `duePaymentId` would surface as raw P2002 → 409 "Data already exists"). |
| OtpCode | PASS | Attempts/expiry/consume/supersede fully specified (PRD BR-17, skill rule 11). |

**Product logic**

| Check | Result | Location / evidence |
|---|---|---|
| PRD internal contradictions | FAIL | Three found: whiteboard delete rights (row 2), unverified-email status code (row 4), wali "✅ if member" (row 12). Plus garbled text and untethered claims (rows 11, 13). |
| PRD access matrix vs API_SPEC access matrix | FAIL | Line-by-line: matches except (a) whiteboard delete for BENDAHARA, (b) leave for WALI_KELAS, (c) the "🔒 member" cells that presuppose wali membership. See rows 2, 3, 12. |
| DATA_MODEL supports every field API_SPEC responses reference | PASS (with note) | `memberCount`, `myReadAt`, `needsOnboarding`, cash "outstanding per member" are all computed values over existing columns, not missing model fields. Exception: `activeClass.code` "only for WALI of it" is incoherent (row 12). |

### 2b. Problem table

| # | Severity | Doc + section | Problem | Suggested fix |
|---|---|---|---|---|
| 1 | blocker | DATA_MODEL "onDelete decisions" (Classroom rows) vs PRD §7 "Entities" Classroom row | PRD §7 says Classroom hard delete is **"Restrict while members exist"**; DATA_MODEL cascades Classroom → ClassMember/Announcement/Subject/Whiteboard/Picket/Poll/CashDue/CashTransaction. A classroom delete would cascade-delete cash transactions, directly violating F-CASH-1 "Transactions are never hard-deleted" and BR-7's history-retention rationale. | Pick one: Restrict from Classroom while any child exists (matches PRD), or declare in the PRD that class deletion is a deliberate full wipe including the ledger. The current mix is impossible. |
| 2 | blocker | PRD §2 access table row "Delete whiteboard note" vs PRD F-WB-1 vs API_SPEC Whiteboards DELETE | PRD access table gives BENDAHARA ✅ delete (any); F-WB-1 text says "delete by uploader, ketua, or wali" (no BENDAHARA); API_SPEC follows F-WB-1. The PRD contradicts itself. | Decide once. If the access table is right, add BENDAHARA to F-WB-1 and the API_SPEC DELETE description. |
| 3 | blocker | API_SPEC "Classrooms" DELETE /classrooms + DATA_MODEL cascade vs PRD §2 access table, §7 | `DELETE /classrooms/:classId` exists in the API but appears in no PRD capability row or feature; PRD §7 says hard delete is "not in v1 UI". An endpoint no PRD rule governs is untestable. | Either remove the endpoint from v1 or add a feature (F-CLASS-x) with access rule, BR, and delete semantics consistent with row 1. |
| 4 | blocker | PRD F-AUTH-2 vs skill `nest-auth-and-security` rule 12 + reference `auth.service.ts` login vs API_SPEC "Users" errors note | PRD says unverified email gets **"the same generic 401"**. The skill/reference and API_SPEC throw **403 'Email is not verified'** (and 403 'Account is disabled') *after* a correct password — a deliberate owner-only reveal. Three documents, two different behaviours. | Fix PRD F-AUTH-2: generic 401 covers unknown email/wrong password/null passwordHash; after a correct password, 403 for unverified/disabled (owner only). API_SPEC is already right. |
| 5 | major | PRD §9 edge case 2 vs DATA_MODEL ClassMember | Edge case 2 relies on "unique/partial index as a backstop" for one-ketua/one-bendahara, but DATA_MODEL has no such index — only the service transaction. Two parallel `assign-role` calls can both succeed without it. | Add the partial unique indexes to the DATA_MODEL (like the `one_active_membership` index): `CREATE UNIQUE INDEX one_ketua ON class_members ("classId") WHERE role = 'KETUA' AND "isActive" = true;` and the same for BENDAHARA — or delete the "backstop" claim from the PRD and accept the transaction-only answer explicitly. |
| 6 | major | API_SPEC Auth table (`verify-otp`) vs skill rule 11 + reference `AuthService.verifyEmail` | Rule 11: only the **default self-registration role** gets a token from EMAIL_VERIFICATION. The reference gates on `role !== DEFAULT_ROLE → null`. With two self-registration roles (`WALI_KELAS`, `MURID`) the gate either never issues a token or must be removed — the spec says `{ accessToken }` unconditionally and never reconciles this. | State explicitly: both self-registered roles receive a token on verify, and the implementer must drop/replace the reference's `DEFAULT_ROLE` check (a conscious, documented deviation). |
| 7 | major | PRD §6 ClassMember state machine + F-CLASS-6 vs DATA_MODEL `@@unique([classId, userId])` | Re-join after `LEFT` ("LEFT → ACTIVE re-join via code") cannot create a second row for the same (classId, userId). Whether join upserts/reactivates the existing row — and whether `joinedAt`/`leftAt` are cleared or kept — is unspecified, yet F-CLASS-6 claims "join history preserved via joinedAt/leftAt". | Specify: re-join reactivates the existing row (`status=ACTIVE`, `leftAt=null`); decide whether `joinedAt` is reset (and then history must live elsewhere) or kept (and then drop the "history preserved" claim). |
| 8 | major | API_SPEC Auth table `forgot-password` (3/min) vs skill rule 10 table | Skill rule 10 lists forgot-password at **5**; only resend-otp-style endpoints are 3. The spec deviates from the skill it cites as authoritative ("the skills win over this file"). | Either change the spec to 5 or get an explicit user-approved exception; do not silently deviate from rule 10. |
| 9 | major | API_SPEC Cash dues table + Polls table + Whiteboards table | Multi-step writes not flagged for `$transaction` (skill prisma rule 11): due creation (due + snapshot payment rows for all active members), pay (payment update + INCOME transaction create), unpay (payment clear + transaction void), vote replace (delete+create), whiteboard create (note + up to 5 image rows — also needs `createMany`, prisma rule 13). A crashed pay could leave a PAID payment with no ledger entry, breaking the 100%-tally success criterion. | Add "in a `$transaction`" to each of these endpoints and state `createMany` for image rows, payment snapshots and inbox fan-out. |
| 10 | major | all three docs (no env-var inventory) | No document lists required env vars. Implied but unnamed anywhere: `OTP_SENDER`, `FIREBASE_*` (FCM credentials for F-NOTIF-1), `CLOUDINARY_*` (folder/keys for F-WB-1), `TZ`; `JWT_EXPIRES_IN`, `OTP_TTL_MINUTES`, `OTP_RESEND_COOLDOWN_SECONDS` are implied but not named either. Rule 25 / validation rule 12 require schema + `.env.example`. | Add an "Environment variables" section to API_SPEC (or a new doc): base vars + `projectEnvSchema` project vars, each with required/optional and which feature reads it. |
| 11 | major | PRD §2 access table ("✅ if member" cells, "Homeroom teacher of this class (WALI)" column) | The wali's powers are conditioned on being "a member", but nothing can make the homeroom teacher a `ClassMember`: join is `[MURID]`-only, `ClassRole` has no WALI value (correctly). So "View cash summary ✅ if member", "Create announcement ✅ if member", etc. are unimplementable as written. API_SPEC correctly resolves this via `homeroomTeacherId`, but then the matrix cell "Classroom detail 🔒 member" for WALI_KELAS is wrong (a wali with zero classes cannot be a member of anything). | Rewrite the PRD access table's wali column as "homeroom teacher of this class" (relation-based, no membership), and fix the API_SPEC matrix cells accordingly. |
| 12 | major | API_SPEC `GET /auth/me` response block | `activeClass: { id, name, code?, classRole } | null` with "code only for WALI of it" is incoherent: the field is defined as the MURID's active membership, yet exposing `code` is conditioned on the viewer being the wali — who per the same block has `activeClass: null` and uses `classes[]`. Either a wali can have an `activeClass` (contradicts F-ONBOARD-1) or the clause is dead text. | Decide: remove `code` from `activeClass` (members must not see the join code), or define a separate wali response shape. Note leaking the join code to every member also conflicts with the class-code being the wali's invitation secret. |
| 13 | minor | PRD §6 ClassMember state machine, ACTIVE→KICKED row | Garbled side-effect text: "unregister… devices stay (user may still use other features)" — an incomplete sentence; unclear whether device tokens are unregistered. §9 case 10 says tokens are not class-scoped and fan-out targets active members, which conflicts with any unregister idea. | Rewrite the row: "picket memberships removed; device tokens kept (fan-out excludes non-active members at send time)". |
| 14 | minor | API_SPEC Polls DELETE + DELETE votes, Whiteboards PATCH | Poll deletion (soft, creator/homeroom), vote withdrawal, and whiteboard caption/subject/date editing are not in the PRD at all (access table has no rows for them). They inherit no BR and no acceptance criterion. | Add the missing capability rows to PRD §2 (and one acceptance line each), or drop the endpoints. |
| 15 | minor | API_SPEC Cash dues prose ("Member detail endpoint ...") | `/classrooms/:classId/cash/members/:memberId` is defined only in prose, outside the endpoint table — no Guard/Roles/Throttle/Success columns, and it is missing from the F-CASH-2 coverage row's guarded-endpoint list style. | Move it into the Cash dues table with full columns. |
| 16 | minor | API_SPEC Classrooms (kick), Cash dues (pay) | Invalid-state errors unspecified: kick of an already-KICKED/LEFT member; pay of an already-PAID payment. Both are reachable races the matrix must classify (403 vs 409 vs 400). | Add one line each: e.g. `409 already kicked/left`, `409 already paid`. |
| 17 | minor | API_SPEC "Test targets" | `route-guards.e2e-spec.ts` (required in every project per skill rule 4 / test-recipes.md) is absent from the test-target table; only PRD §8 mentions it. Also BR-11b has no test target. | Add a meta-test row ("route guards meta-test — always") and a BR-11b DTO-validation row. |
| 18 | minor | DATA_MODEL `Role`/`User.role` vs `per-resource-roles.md` "Naming (rule 5)" | With both an app-wide role and a per-resource role column, the recipe prescribes `globalRole`/`GlobalRole`/`GlobalRoleName` on User and `role`/`ClassRole` on the join model — and says the rename happens in a new project (this one). DATA_MODEL keeps `role`/`Role`. | Rename in DATA_MODEL: `User.globalRole GlobalRole`, enum `GlobalRole { WALI_KELAS, MURID }`; `ClassRole` stays. Update PRD §2 wording. |
| 19 | minor | PRD BR-6 vs DATA_MODEL `Classroom.code @unique` | BR-6: "unique among non-deleted classes" — but Classroom is hard-deleted with no `deletedAt`, and `code` is globally unique, so a deleted class's code can never be reused (and "non-deleted" is meaningless). | Reword BR-6 to "unique among all classes" (global unique constraint), or add soft delete + a partial index if code reuse is wanted. |
| 20 | minor | PRD §8 testing + API_SPEC coverage (F-PICKET-2) vs API_SPEC "Test targets" BR-16 | Cron ownership is inconsistent: PRD traceability puts the cron in `pickets`, the test target calls `NotificationsService.sendReminder`. Implementers will not know which module owns it. | Pick one owner (e.g. `pickets` cron calling a shared sender in `common/notifications`) and align both docs. |
| 21 | minor | PRD §1 success criterion 2 vs F-NOTIF-1 | "≥ 90 % of active members receive a push within 30 s" is untestable with the declared v1 infra (in-process events, no queue, no delivery tracking table). | Downgrade to a design goal or add a measurable proxy (e.g. `NotificationLog` created within N s of the trigger). |
| 22 | minor | PRD F-NOTIF-1 ("tokens are removed on logout") vs skill rule 21 note | With access-token-only auth there is no server "logout this device" (rule 21: "the client drops the token"). Device tokens therefore survive logout unless the client calls `DELETE /devices/:deviceId`. | Reword F-NOTIF-1: "tokens are removed when the client explicitly deletes them (`DELETE /devices/:deviceId`); there is no server-side logout endpoint". |
| 23 | minor | PRD F-CASH-2 vs DATA_MODEL CashDuePayment | Members who join **after** a due was created get no `UNPAID` snapshot row, so "outstanding per member" silently excludes them while the success criterion demands the balance match the treasurer's tally 100 %. | Specify: creating a due snapshots current active members only, and the summary treats "no payment row" for an active member as outstanding (computed), or bendahara back-fills rows on join. Pick and document one. |
| 24 | minor | API_SPEC "Access matrix" Whiteboards row (MURID cell) | "🔒 member (update: uploader only)" does not state the MURID **delete** rule (own only, per PRD §2). The endpoint description says "uploader, KETUA, or WALI", which a reader could misapply to allow any member delete. | Make the cell explicit: "delete: own only; update: uploader only". |

## 3. Questions for the user

1. **Is the homeroom teacher ever a `ClassMember`?** The PRD conditions several wali powers on "✅ if member", but join is MURID-only. If never, the access table and `/auth/me` wording must be rewritten to relation-based (`homeroomTeacherId`) rules.
2. **Who may delete a whiteboard note?** PRD access table says BENDAHARA can (any note); PRD F-WB-1 and the API spec say uploader/KETUA/WALI only. Which is authoritative?
3. **Should `DELETE /classrooms` exist in v1?** If yes: Restrict while members exist (PRD §7) or cascade everything including the cash ledger (DATA_MODEL, which violates "transactions are never deleted")? If no, the endpoint should be cut.
4. **Forgot-password throttle: 5/min (skill rule 10) or 3/min (API spec)?**
5. **On `verify-otp`, do both self-registered roles (`WALI_KELAS` and `MURID`) get an access token?** The reference implementation only issues one for the default role, so the spec must either declare a documented deviation or pick a single default role.
