[# Module Auth (xác thực & phân quyền) — CashCash

> Tài liệu này đi theo **luồng hoạt động qua từng tầng**: mỗi user story được lần từ nút bấm trên giao diện, qua từng lớp backend, xuống tới hàm SQL trong database, kèm link tới đúng dòng code.
> Cuối tài liệu là **bộ câu hỏi vấn đáp** (trace code, "vì sao", "nếu… thì sao", tấn công) và **checklist demo** cho buổi chấm điểm.

## Mục lục

1. [Các tầng của hệ thống](#1-các-tầng-của-hệ-thống)
2. [User stories](#2-user-stories)
3. [Trace từng user story qua các tầng](#3-trace-từng-user-story-qua-các-tầng)
4. [Dữ liệu & hằng số cần nhớ](#4-dữ-liệu--hằng-số-cần-nhớ)
5. [Trade-offs (đánh đổi thiết kế)](#5-trade-offs-đánh-đổi-thiết-kế)
6. [Câu hỏi vấn đáp](#6-câu-hỏi-vấn-đáp)
7. [Kiểm thử & checklist demo](#7-kiểm-thử--checklist-demo)
8. [Thuật ngữ](#8-thuật-ngữ)

---

## 1. Các tầng của hệ thống

```
 TRÌNH DUYỆT                                     SERVER (Express)                                   DATABASE (Supabase Postgres)
┌───────────────────────────┐                ┌──────────────────────────────────────────────┐   ┌──────────────────────────────┐
│ ① UI / Page               │                │ ④ App pipeline   app.ts                      │   │ ⑨ RPC (hàm plpgsql)          │
│   auth-page.tsx           │                │   helmet → cors → json → chặn CSRF           │   │   cashcash_register          │
│   password-recovery-page  │                │ ⑤ Router + middleware                        │   │   cashcash_session_create    │
│ ② State / Gate            │  fetch         │   auth.routes.ts (rate limit)                │   │   cashcash_refresh_rotate    │
│   auth.tsx (useAuth,      │  credentials:  │   currentUser → requireRole                  │   │   cashcash_refresh_revoke    │
│   AuthGate, AdminGate)    │  'include'     │ ⑥ Presentation (controller + cookie)         │   │   cashcash_oauth_login       │
│ ③ HTTP client             │ ─────────────► │   auth.controller.ts, auth.cookie.ts         │──►│   cashcash_reset_*           │
│   lib/http.ts             │ cookie         │ ⑦ Application (nghiệp vụ)                    │   │   cashcash_change_password   │
│   (tự refresh khi 401)    │ cc_access      │   auth.service.ts, password-reset.service.ts │   │ ⑩ Bảng + trigger             │
└───────────────────────────┘ cc_refresh     │ ⑧ Infrastructure (kỹ thuật)                  │   │   users, refresh_tokens,     │
                                             │   jwt.ts, password.ts, refresh-token.ts,     │   │   oauth_accounts,            │
     Google (accounts.google.com) ◄────────► │   google.ts, password-reset.mail.ts          │   │   password_resets            │
                                             └──────────────────────────────────────────────┘   └──────────────────────────────┘
          packages/shared: Zod schema (loginSchema, registerSchema…) dùng chung cho cả frontend và backend
```

| # | Tầng | File chính | Trách nhiệm | **Không** làm |
|---|---|---|---|---|
| ① | UI / Page | [auth-page.tsx](../frontend/src/features/auth/auth-page.tsx), [password-recovery-page.tsx](../frontend/src/features/auth/password-recovery-page.tsx) | Form, validate sớm bằng Zod để báo lỗi nhanh, hiển thị lỗi | Không giữ token, không quyết định quyền |
| ② | State / Gate | [auth.tsx](../frontend/src/features/auth/auth.tsx), [router.tsx](../frontend/src/app/router.tsx) | Hỏi `/auth/me` để biết ai đang đăng nhập, chặn route khi chưa đăng nhập, ẩn trang admin | Chỉ là UI: quyền thật do server kiểm |
| ③ | HTTP client | [http.ts](../frontend/src/lib/http.ts) | Gửi cookie, gắn header chống CSRF, tự gọi `/auth/refresh` khi gặp 401 rồi gửi lại request | Không đọc được token (cookie HttpOnly) |
| ④ | App pipeline | [app.ts](../backend/src/app.ts) | Header bảo mật, CORS, giới hạn body, chặn CSRF, gắn router, xử lý lỗi | — |
| ⑤ | Router + middleware | [auth.routes.ts](../backend/src/features/auth/presentation/auth.routes.ts), [current-user.ts](../backend/src/middlewares/current-user.ts), [require-role.ts](../backend/src/middlewares/require-role.ts), [rate-limit.ts](../backend/src/middlewares/rate-limit.ts) | Map URL → controller, giới hạn số lần thử, xác thực JWT, kiểm role | Không chứa nghiệp vụ |
| ⑥ | Presentation | [auth.controller.ts](../backend/src/features/auth/presentation/auth.controller.ts), [auth.cookie.ts](../backend/src/features/auth/presentation/auth.cookie.ts) | Parse input bằng Zod, gọi service, đặt/xoá cookie, chọn status code | Không truy cập DB trực tiếp |
| ⑦ | Application | [auth.service.ts](../backend/src/features/auth/application/auth.service.ts), [password-reset.service.ts](../backend/src/features/auth/application/password-reset.service.ts), [user.service.ts](../backend/src/features/users/application/user.service.ts) | Nghiệp vụ: đăng ký, đăng nhập, xoay vòng token, reset mật khẩu | Không biết gì về cookie/HTTP |
| ⑧ | Infrastructure | [jwt.ts](../backend/src/features/auth/infrastructure/jwt.ts), [password.ts](../backend/src/features/auth/infrastructure/password.ts), [refresh-token.ts](../backend/src/features/auth/infrastructure/refresh-token.ts), [google.ts](../backend/src/features/auth/infrastructure/google.ts) | Ký/kiểm JWT, hash scrypt, sinh token ngẫu nhiên, nói chuyện với Google | Không biết nghiệp vụ |
| ⑨ | RPC | [refresh_tokens migration](../backend/db/migrations/20261017130000_refresh_tokens/migration.sql), [oauth_accounts migration](../backend/db/migrations/20261017140000_oauth_accounts/migration.sql), [user_role migration](../backend/db/migrations/20261017120000_user_role/migration.sql) | Các thao tác nhiều bước chạy **trong một transaction**, có khoá dòng (`FOR UPDATE`) | — |
| ⑩ | Bảng | `users`, `refresh_tokens`, `oauth_accounts`, `password_resets` | Lưu dữ liệu; trigger bảo vệ cột `role` | Không lưu token thô, chỉ lưu SHA-256 |

**Câu chốt khi được hỏi "kiến trúc module của em thế nào?":**
> Backend chia theo feature, trong mỗi feature có 3 lớp: *presentation* (route + controller + cookie), *application* (service nghiệp vụ), *infrastructure* (JWT, hash, Google, mail). Controller chỉ lo HTTP; service không biết cookie; thao tác DB nhiều bước được đẩy xuống hàm RPC trong Postgres để chạy nguyên tử. Schema Zod nằm ở `packages/shared` nên frontend và backend validate giống hệt nhau.

### Thứ tự middleware của một request bất kỳ ([app.ts:17-39](../backend/src/app.ts#L17-L39))

```
Request
 → helmet()                       header bảo mật (CSP, X-Frame-Options…)
 → cors({ origin: CORS_ORIGIN, credentials: true })
 → express.json({ limit: '100kb' })
 → chặn CSRF cho /api/v1 (mọi method trừ GET/HEAD/OPTIONS):
     cần header X-CashCash-Request: 1, và Origin (nếu có) phải nằm trong CORS_ORIGIN, sai thì 403 INVALID_ORIGIN
 → /api/v1/auth/*  → authRouter            (KHÔNG qua currentUser: chưa đăng nhập vẫn gọi được)
 → /api/v1/*       → currentUser → apiRouter (BẮT BUỘC có access token hợp lệ)
                                  └─ /admin → requireRole('ADMIN')
 → notFoundHandler → errorHandler (HttpError → JSON { error: { code, message, details } })
```

---

## 2. User stories

| ID | User story | Tiêu chí chấp nhận (acceptance criteria) |
|---|---|---|
| **US-01** | Là khách, tôi muốn **đăng ký** bằng email + mật khẩu để có tài khoản riêng. | Mật khẩu ≥ 8 ký tự; email trùng thì báo 409; đăng ký xong được đăng nhập luôn; tài khoản mới có sẵn ví và danh mục mặc định; role luôn là `USER`. |
| **US-02** | Là người dùng, tôi muốn **đăng nhập** bằng email + mật khẩu. | Sai email hoặc sai mật khẩu đều trả cùng một thông báo; quá 20 lần trong 15 phút thì 429; token nằm trong cookie HttpOnly. |
| **US-03** | Là người dùng, tôi muốn **giữ phiên đăng nhập** mà không phải đăng nhập lại mỗi 15 phút. | Access token hết hạn thì frontend tự refresh rồi gửi lại request, người dùng không thấy gì; refresh token sống 7 ngày; mỗi lần refresh được cấp token mới (rotation). |
| **US-04** | Là người dùng, tôi muốn **đăng xuất** để người khác dùng máy không vào được tài khoản tôi. | Refresh token bị thu hồi trong DB; cookie bị xoá; cache dữ liệu riêng tư ở frontend bị xoá. |
| **US-05** | Là người dùng, tôi muốn **đăng nhập bằng Google** để khỏi nhớ mật khẩu. | Có state, PKCE, nonce; chỉ chấp nhận email đã được Google xác minh; lần đầu thì tạo tài khoản mới, email đã tồn tại thì liên kết vào tài khoản cũ. |
| **US-06** | Là người dùng quên mật khẩu, tôi muốn **đặt lại mật khẩu bằng OTP qua email**. | OTP 6 số, hết hạn sau 10 phút, tối đa 5 lần thử; không tiết lộ email có tồn tại hay không; đặt lại xong thì mọi phiên cũ bị đăng xuất. |
| **US-07** | Là người dùng đang đăng nhập, tôi muốn **đổi mật khẩu** (hoặc đặt mật khẩu lần đầu nếu tạo tài khoản bằng Google). | Phải nhập đúng mật khẩu hiện tại (trừ tài khoản Google chưa có mật khẩu); các thiết bị khác bị đăng xuất, thiết bị hiện tại vẫn đăng nhập. |
| **US-08** | Là người dùng, tôi muốn **chỉ thấy dữ liệu của mình** khi gọi bất kỳ API nào. | Mọi route `/api/v1/*` (trừ `/auth`) cần access token hợp lệ; `userId` lấy từ token do server ký, không lấy từ body/query. |
| **US-09** | Là admin, tôi muốn vào **trang quản trị** (thống kê dùng AI), còn user thường thì không. | `/api/v1/admin/*` trả 403 nếu role ≠ ADMIN; frontend ẩn trang admin; role chỉ được đổi qua script `db:admins`. |

---

## 3. Trace từng user story qua các tầng

Ký hiệu: **①…⑩** là số tầng ở mục 1.

### US-02 — Đăng nhập bằng mật khẩu (luồng quan trọng nhất, nên thuộc lòng)

```
① auth-page.tsx  submit()
     loginSchema.safeParse → http.post('/auth/login', {email, password})
③ http.ts  request(): gắn X-CashCash-Request: 1, credentials: 'include'
     /auth/login nằm trong NO_REFRESH → 401 ở đây là sai mật khẩu thật, không refresh
④ app.ts   chặn CSRF: header + Origin hợp lệ
⑤ auth.routes.ts  rateLimit('credentials', 20) → authController.login
⑥ auth.controller.ts login(): parseInput(loginSchema) → authService.login
⑦ auth.service.ts login():
     SELECT user theo email
     ⑧ verifyPassword(password, hash)  ← vẫn chạy scrypt dù không có user (chống dò email)
     sai → 401 INVALID_CREDENTIALS
     ⑧ newRefreshToken(): 32 byte ngẫu nhiên, DB chỉ lưu SHA-256
     ⑨ RPC cashcash_session_create: khoá dòng user, kiểm passwordHash chưa đổi, dọn token hết hạn, tạo family mới
     ⑧ signAccessToken({sub, role}): JWT HS256 sống 15 phút
⑥ controller: thu hồi refresh token cũ của trình duyệt này (nếu có) → setAuthCookies → 200 + user (không có passwordHash)
① frontend: xoá cache cũ, setQueryData(['auth','me'], user), navigate('/')
```

| Bước | Tầng | Code |
|---|---|---|
| Validate form, gọi API | ① | [auth-page.tsx:37-56](../frontend/src/features/auth/auth-page.tsx#L37-L56) |
| Gắn header CSRF, gửi cookie | ③ | [http.ts:63-76](../frontend/src/lib/http.ts#L63-L76) |
| Không refresh với route đăng nhập | ③ | [http.ts:30](../frontend/src/lib/http.ts#L30) |
| Chặn CSRF | ④ | [app.ts:26-34](../backend/src/app.ts#L26-L34) |
| Rate limit 20 lần / 15 phút / IP | ⑤ | [auth.routes.ts:6](../backend/src/features/auth/presentation/auth.routes.ts#L6), [rate-limit.ts:8-17](../backend/src/middlewares/rate-limit.ts#L8-L17) |
| Controller | ⑥ | [auth.controller.ts:45-50](../backend/src/features/auth/presentation/auth.controller.ts#L45-L50) |
| Zod schema dùng chung (email tự lowercase) | shared | [auth.schema.ts:3-6](../packages/shared/src/schemas/auth.schema.ts#L3-L6) |
| Service | ⑦ | [auth.service.ts:44-59](../backend/src/features/auth/application/auth.service.ts#L44-L59) |
| scrypt + so sánh thời gian hằng | ⑧ | [password.ts:14-19](../backend/src/features/auth/infrastructure/password.ts#L14-L19) |
| Sinh refresh token | ⑧ | [refresh-token.ts:8-11](../backend/src/features/auth/infrastructure/refresh-token.ts#L8-L11) |
| Ký JWT | ⑧ | [jwt.ts:13-22](../backend/src/features/auth/infrastructure/jwt.ts#L13-L22) |
| RPC tạo phiên | ⑨ | [refresh_tokens/migration.sql:33-48](../backend/db/migrations/20261017130000_refresh_tokens/migration.sql#L33-L48) |
| Đặt cookie | ⑥ | [auth.cookie.ts:23-26](../backend/src/features/auth/presentation/auth.cookie.ts#L23-L26) |
| Không trả passwordHash | ⑦ | [auth.service.ts:16-18](../backend/src/features/auth/application/auth.service.ts#L16-L18) |

**Chi tiết dễ bị hỏi:**
- [password.ts:16](../backend/src/features/auth/infrastructure/password.ts#L16) luôn chạy `derive()` **trước** khi kiểm định dạng hash. Email không tồn tại thì vẫn tốn thời gian scrypt như email có thật, nên kẻ tấn công không đo được độ trễ để biết email nào đã đăng ký.
- `cashcash_session_create` truyền `p_expected_hash` vào và kiểm lại trong transaction có `FOR UPDATE`. Nếu mật khẩu vừa bị đổi giữa lúc verify và lúc tạo phiên (race condition), RPC trả `false`, controller trả 401.
- [auth.controller.ts:47](../backend/src/features/auth/presentation/auth.controller.ts#L47) gọi `authService.logout(refreshToken(req))` trước khi đặt cookie mới, để family token cũ của trình duyệt này không còn sống trong DB.

### US-01 — Đăng ký

| Bước | Tầng | Code |
|---|---|---|
| Kiểm mật khẩu xác nhận + Zod `registerSchema` | ① | [auth-page.tsx:41-45](../frontend/src/features/auth/auth-page.tsx#L41-L45) |
| Schema: displayName 1–80 ký tự, password ≥ 8 | shared | [auth.schema.ts:7-10](../packages/shared/src/schemas/auth.schema.ts#L7-L10) |
| Controller | ⑥ | [auth.controller.ts:39-44](../backend/src/features/auth/presentation/auth.controller.ts#L39-L44) (trả **201**) |
| Hash mật khẩu, sinh UUID + refresh token, gọi RPC | ⑦ | [auth.service.ts:28-43](../backend/src/features/auth/application/auth.service.ts#L28-L43) |
| Email trùng → Postgres lỗi `23505` (unique) → 409 | ⑦ | [auth.service.ts:38](../backend/src/features/auth/application/auth.service.ts#L38) |
| RPC: insert user (role cứng `'USER'`) + ví/danh mục mặc định + refresh token, **một transaction** | ⑨ | [refresh_tokens/migration.sql:17-31](../backend/db/migrations/20261017130000_refresh_tokens/migration.sql#L17-L31) |
| Trigger ép role = USER khi insert | ⑩ | [user_role/migration.sql:6-25](../backend/db/migrations/20261017120000_user_role/migration.sql#L6-L25) |

**Vì sao dùng RPC?** Tạo user, tạo ví/danh mục mặc định và tạo refresh token là 3 thao tác. Nếu gọi riêng lẻ mà bước 2 lỗi thì sẽ có user "mồ côi" không có ví. Trong một hàm plpgsql, cả ba thành công hoặc cùng rollback.

### US-08 — Request đã đăng nhập (ví dụ `GET /api/v1/transactions`)

```
③ http.ts      fetch kèm cookie cc_access (trình duyệt tự gửi)
④ app.ts       GET → không cần header CSRF
⑤ currentUser  đọc cookie cc_access → verifyAccessToken
                 hợp lệ: req.userId = sub, req.role = role → next()
                 không hợp lệ/hết hạn: 401 UNAUTHENTICATED
⑥⑦             controller/service của transactions dùng req.userId để lọc dữ liệu
```

| Bước | Code |
|---|---|
| Gắn currentUser cho mọi route trừ /auth | [app.ts:35-36](../backend/src/app.ts#L35-L36) |
| Middleware | [current-user.ts:7-13](../backend/src/middlewares/current-user.ts#L7-L13) |
| Đọc cookie từ header | [auth.cookie.ts:17-21](../backend/src/features/auth/presentation/auth.cookie.ts#L17-L21) |
| Verify: cố định `HS256`, kiểm `iss`, `aud`, `exp`, bắt buộc `sub/exp/iat`, rồi Zod kiểm `sub` là UUID và `role` hợp lệ | [jwt.ts:25-38](../backend/src/features/auth/infrastructure/jwt.ts#L25-L38) |
| Kiểu `req.userId`, `req.role` | [types/express.d.ts](../backend/src/types/express.d.ts) |

**Điểm quan trọng:** `currentUser` **không truy vấn DB**. Chữ ký JWT đủ để tin `sub` và `role`. Đây là lý do dùng JWT (nhanh, stateless), và cũng là lý do access token không thu hồi được ngay (xem trade-offs).

### US-03 — Access token hết hạn, tự refresh (rotation)

```
③ http.ts  request() nhận 401 (không phải route trong NO_REFRESH, chưa retry)
     → refreshSession(): nếu đang có lần refresh khác thì dùng chung Promise (single-flight)
     → POST /auth/refresh (trình duyệt gửi cc_refresh vì path cookie = /api/v1/auth)
⑤ rateLimit('refresh', 120)
⑥ controller.refresh → authService.refresh(token)
⑦ kiểm định dạng 64 hex → sinh token mới → RPC rotate với SHA-256 của token cũ
⑨ cashcash_refresh_rotate (khoá dòng FOR UPDATE):
     không tìm thấy           → invalid
     đã thu hồi, có replacedBy, < 10 giây trước → stale (tab khác vừa refresh)
     đã thu hồi (ngoài 10s)   → reused → THU HỒI CẢ FAMILY (nghi bị trộm)
     hết hạn                  → expired
     hợp lệ → đọc role MỚI NHẤT từ users, insert token mới cùng familyId, đánh dấu token cũ revokedAt + replacedBy → ok
⑥ ok    → set cookie mới, 204
   stale → 401 REFRESH_STALE, KHÔNG xoá cookie (cookie mới của tab kia đã có)
   khác  → xoá cookie, 401 UNAUTHENTICATED
③ refreshed (hoặc REFRESH_STALE) → gửi lại request gốc một lần
   failed → bắn event 'auth-expired' → ② AuthGate xoá cache, về /login
```

| Bước | Tầng | Code |
|---|---|---|
| Bắt 401 và retry đúng 1 lần | ③ | [http.ts:82-86](../frontend/src/lib/http.ts#L82-L86) |
| Single-flight refresh, coi `REFRESH_STALE` là thành công | ③ | [http.ts:33-53](../frontend/src/lib/http.ts#L33-L53) |
| Phát `auth-expired` | ③ | [http.ts:90](../frontend/src/lib/http.ts#L90) |
| Nghe `auth-expired`, xoá cache | ② | [auth.tsx:24-44](../frontend/src/features/auth/auth.tsx#L24-L44) |
| Rate limit 120 | ⑤ | [auth.routes.ts:8](../backend/src/features/auth/presentation/auth.routes.ts#L8) |
| Controller xử lý 3 kết quả | ⑥ | [auth.controller.ts:51-62](../backend/src/features/auth/presentation/auth.controller.ts#L51-L62) |
| Service | ⑦ | [auth.service.ts:77-88](../backend/src/features/auth/application/auth.service.ts#L77-L88) |
| RPC rotate | ⑨ | [refresh_tokens/migration.sql:53-81](../backend/db/migrations/20261017130000_refresh_tokens/migration.sql#L53-L81) |
| Cookie refresh chỉ gửi tới `/api/v1/auth` | ⑥ | [auth.cookie.ts:12](../backend/src/features/auth/presentation/auth.cookie.ts#L12) |

### US-04 — Đăng xuất

| Bước | Tầng | Code |
|---|---|---|
| Nút đăng xuất, `useLogout` → `POST /auth/logout` | ①② | [auth.tsx:53-79](../frontend/src/features/auth/auth.tsx#L53-L79) |
| Xoá cache riêng tư, đóng sheet, set user = null | ② | [auth.tsx:24-29](../frontend/src/features/auth/auth.tsx#L24-L29) |
| Controller: thu hồi + xoá cookie, 204 | ⑥ | [auth.controller.ts:63-67](../backend/src/features/auth/presentation/auth.controller.ts#L63-L67) |
| Service | ⑦ | [auth.service.ts:95-99](../backend/src/features/auth/application/auth.service.ts#L95-L99) |
| RPC thu hồi **cả family** của token | ⑨ | [refresh_tokens/migration.sql:84-94](../backend/db/migrations/20261017130000_refresh_tokens/migration.sql#L84-L94) |

Lưu ý: access token đã cấp vẫn hợp lệ tới khi hết hạn (≤ 15 phút) nếu ai đó đã chép được nó; nhưng cookie đã bị xoá khỏi trình duyệt và không refresh được nữa.

### Kiểm tra "tôi là ai" khi mở app (`GET /auth/me`)

| Bước | Tầng | Code |
|---|---|---|
| Router bọc mọi trang trong `AuthGate` | ② | [router.tsx:19-34](../frontend/src/app/router.tsx#L19-L34) |
| `useAuth` gọi `/auth/me`, 401 → `null` | ② | [auth.tsx:13-18](../frontend/src/features/auth/auth.tsx#L13-L18) |
| Đang chờ → "Đang kiểm tra…"; lỗi mạng → nút Thử lại; `null` → `/login` | ② | [auth.tsx:40-43](../frontend/src/features/auth/auth.tsx#L40-L43) |
| Controller: verify JWT rồi **đọc user từ DB** (lấy tên, avatar mới nhất) | ⑥ | [auth.controller.ts:99-104](../backend/src/features/auth/presentation/auth.controller.ts#L99-L104) |
| Service | ⑦ | [auth.service.ts:89-94](../backend/src/features/auth/application/auth.service.ts#L89-L94) |

`/auth/me` nằm trong `/auth` nên không đi qua `currentUser`; nó tự verify. 401 ở đây cũng kích hoạt refresh ở `http.ts` vì `/auth/me` không nằm trong `NO_REFRESH`.

### US-05 — Đăng nhập bằng Google (OAuth 2.0 Authorization Code + PKCE + OpenID Connect)

```
① Nút "Đăng nhập bằng Google" là thẻ <a href="/api/v1/auth/google">  (điều hướng cả trang, không phải fetch)
⑥ googleStart: sinh state, verifier, nonce (mỗi cái 32 byte ngẫu nhiên)
     → cookie cc_google_flow = "state.verifier.nonce" (HttpOnly, 10 phút, path /api/v1/auth/google)
     → redirect 302 tới accounts.google.com với state, nonce, code_challenge = SHA256(verifier)
   [Người dùng chọn tài khoản trên Google]
   Google redirect về /api/v1/auth/google/callback?code=…&state=…
⑤ rateLimit('google', 20)
⑥ googleCallback:
     1. đọc rồi XOÁ NGAY cookie flow (dùng một lần)
     2. so sánh state (timingSafeEqual)          sai → google_state
     3. Google trả error=access_denied?           → google_denied
     4. ⑧ exchangeGoogleCode(code, verifier)       server ↔ Google, kèm client_secret + code_verifier → id_token
     5. ⑧ verifyGoogleIdToken: chữ ký RS256 theo JWKS của Google, iss, aud = CLIENT_ID, exp, nonce, email_verified
     6. ⑦ authService.googleLogin → ⑨ cashcash_oauth_login
           đã liên kết (provider + sub) → linked
           email trùng user có sẵn      → attached (liên kết vào user đó)
           chưa có                       → created (user không mật khẩu + ví/danh mục mặc định)
     7. set cookie → redirect về APP_URL/
   Lỗi bất kỳ → redirect /login?error=<mã> → ① auth-page hiển thị thông báo tiếng Việt
```

| Bước | Tầng | Code |
|---|---|---|
| Link nút Google, bảng thông báo lỗi | ① | [auth-page.tsx:75](../frontend/src/features/auth/auth-page.tsx#L75), [auth-page.tsx:11-18](../frontend/src/features/auth/auth-page.tsx#L11-L18) |
| googleStart | ⑥ | [auth.controller.ts:68-74](../backend/src/features/auth/presentation/auth.controller.ts#L68-L74) |
| Tạo URL ủy quyền, PKCE S256 | ⑧ | [google.ts:27-36](../backend/src/features/auth/infrastructure/google.ts#L27-L36) |
| Cookie flow | ⑥ | [auth.cookie.ts:32-41](../backend/src/features/auth/presentation/auth.cookie.ts#L32-L41) |
| googleCallback | ⑥ | [auth.controller.ts:75-98](../backend/src/features/auth/presentation/auth.controller.ts#L75-L98) |
| Đổi code lấy id_token (timeout 10s) | ⑧ | [google.ts:41-54](../backend/src/features/auth/infrastructure/google.ts#L41-L54) |
| Kiểm id_token | ⑧ | [google.ts:63-79](../backend/src/features/auth/infrastructure/google.ts#L63-L79) |
| Service | ⑦ | [auth.service.ts:64-75](../backend/src/features/auth/application/auth.service.ts#L64-L75) |
| RPC + bảng `oauth_accounts` (unique `provider + providerUserId`) | ⑨⑩ | [oauth_accounts/migration.sql](../backend/db/migrations/20261017140000_oauth_accounts/migration.sql) |
| Bật/tắt theo biến môi trường | config | [google.ts:23](../backend/src/features/auth/infrastructure/google.ts#L23), [env.ts:57-64](../backend/src/config/env.ts#L57-L64) |

**Ba chốt an toàn:**

| Chốt | Chống gì |
|---|---|
| `state` | CSRF ở callback: kẻ xấu dụ nạn nhân mở link callback chứa `code` của **kẻ xấu**, khiến nạn nhân bị đăng nhập vào tài khoản kẻ xấu (login CSRF). State phải khớp cookie của chính trình duyệt đó. |
| PKCE (`code_verifier` / `code_challenge`) | Ai chặn được `code` trên URL cũng không đổi được lấy token vì không có `verifier` (chỉ nằm trong cookie HttpOnly). |
| `nonce` | Một `id_token` lấy từ lượt đăng nhập khác bị phát lại vào lượt này. |

**Vì sao chỉ chấp nhận `email_verified = true`?** Bước "attached" liên kết theo email. Nếu chấp nhận email chưa xác minh, kẻ xấu tạo tài khoản Google với email của nạn nhân là chiếm được tài khoản CashCash của nạn nhân.

**Vì sao định danh bằng `sub` chứ không bằng email?** `sub` là ID vĩnh viễn của tài khoản Google; email có thể đổi.

### US-06 — Quên mật khẩu (OTP qua email), 3 bước

```
Bước 1  ① nhập email → POST /auth/forgot-password
        ⑥ trả 202 NGAY với cùng một câu, rồi xử lý nền (queuePasswordReset, tối đa 10 job, quá thì 503)
        ⑦ request(): không có user hoặc user không có mật khẩu → im lặng bỏ qua
                     OTP = 6 số ngẫu nhiên (randomInt) → hash bằng scrypt
                     ⑨ cashcash_reset_issue → ⑧ gửi mail; gửi lỗi thì xoá bản ghi
Bước 2  ① nhập OTP → POST /auth/verify-reset-otp
        ⑦ verifyOtp(): lấy bản ghi mới nhất, hết hạn (10 phút) hoặc attempts ≥ 5 → lỗi
                       sai OTP → ⑨ cashcash_reset_fail (tăng attempts)
                       đúng   → ⑨ cashcash_reset_verify: đổi sang token mới 64 hex (otpHash = null)
        ⑥ trả { token } kèm Cache-Control: no-store
Bước 3  ① nhập mật khẩu mới → POST /auth/reset-password { token, password }
        ⑦ reset(): bản ghi phải đã qua bước OTP (otpHash null) và chưa hết hạn
        ⑨ cashcash_reset_consume: đổi passwordHash, xoá mọi reset của user, THU HỒI MỌI refresh token
        ⑥ xoá cookie, 204 → người dùng đăng nhập lại bằng mật khẩu mới
```

| Bước | Tầng | Code |
|---|---|---|
| Trang 3 bước | ① | [password-recovery-page.tsx](../frontend/src/features/auth/password-recovery-page.tsx) |
| Controller 3 endpoint | ⑥ | [auth.controller.ts:25-38](../backend/src/features/auth/presentation/auth.controller.ts#L25-L38) |
| Hàng đợi nền, trả lời giống nhau | ⑦ | [password-reset.service.ts:85-97](../backend/src/features/auth/application/password-reset.service.ts#L85-L97) |
| Sinh và gửi OTP | ⑦ | [password-reset.service.ts:18-42](../backend/src/features/auth/application/password-reset.service.ts#L18-L42) |
| Kiểm OTP | ⑦ | [password-reset.service.ts:43-69](../backend/src/features/auth/application/password-reset.service.ts#L43-L69) |
| Đặt mật khẩu mới | ⑦ | [password-reset.service.ts:70-83](../backend/src/features/auth/application/password-reset.service.ts#L70-L83) |
| RPC | ⑨ | [password_reset_rpc/migration.sql](../backend/db/migrations/20261014120000_password_reset_rpc/migration.sql), bản mới của `reset_consume`: [refresh_tokens/migration.sql:116-136](../backend/db/migrations/20261017130000_refresh_tokens/migration.sql#L116-L136) |
| Schema: OTP 6 số, token 64 hex | shared | [auth.schema.ts:13-22](../packages/shared/src/schemas/auth.schema.ts#L13-L22) |

**Vì sao xử lý nền và trả 202 ngay?** Nếu chờ gửi mail mới trả lời, email có tài khoản sẽ chậm hơn email không có tài khoản (vì phải gọi SMTP). Đo thời gian là biết email nào đã đăng ký. Trả lời ngay rồi xử lý sau thì mọi email đều nhận phản hồi như nhau.

**Vì sao OTP hash bằng scrypt?** OTP chỉ có 1.000.000 khả năng; nếu DB lộ mà OTP lưu thô hay SHA-256 thì dò ra ngay. Kết hợp giới hạn 5 lần thử + 10 phút + rate limit 20/15 phút/IP.

### US-07 — Đổi mật khẩu khi đang đăng nhập

| Bước | Tầng | Code |
|---|---|---|
| Gọi `POST /users/me/password` | ① | [users.service.ts:6](../frontend/src/services/users.service.ts#L6) |
| Route nằm sau `currentUser`; rate limit **theo userId** (10 lần) | ⑤ | [user.routes.ts:10](../backend/src/features/users/presentation/user.routes.ts#L10) |
| Controller: đặt cặp token mới cho thiết bị hiện tại | ⑥ | [user.controller.ts:12-17](../backend/src/features/users/presentation/user.controller.ts#L12-L17) |
| Service: tài khoản Google chưa có mật khẩu thì không cần mật khẩu cũ | ⑦ | [user.service.ts:50-70](../backend/src/features/users/application/user.service.ts#L50-L70) |
| RPC: kiểm hash chưa đổi, cập nhật, thu hồi mọi refresh token, tạo family mới | ⑨ | [refresh_tokens/migration.sql:98-114](../backend/db/migrations/20261017130000_refresh_tokens/migration.sql#L98-L114) |

**Vì sao rate limit theo userId chứ không theo IP?** Kẻ trộm được access token có thể đổi IP liên tục để dò mật khẩu hiện tại; đếm theo user thì đổi IP vô ích.

### US-09 — Phân quyền ADMIN

```
DB:   users.role ∈ {USER, ADMIN} (CHECK constraint)
      trigger cashcash_guard_role: INSERT luôn ép USER; UPDATE đổi role → lỗi 42501
      chỉ cashcash_set_role (bật cờ cashcash.role_change trong transaction) được đổi role
      script: npm run db:admins → promote-admins.ts → nâng các email trong ADMIN_EMAILS
JWT:  role được nhúng vào access token lúc ký (login / refresh đọc role từ DB)
⑤     currentUser gán req.role → requireRole('ADMIN') so sánh → sai thì 403 FORBIDDEN
②     AdminGate: không phải admin thì chuyển về "/" (chỉ là UI)
```

| Bước | Tầng | Code |
|---|---|---|
| Cột role + trigger + `cashcash_set_role` | ⑩⑨ | [user_role/migration.sql](../backend/db/migrations/20261017120000_user_role/migration.sql) |
| Script nâng admin | — | [promote-admins.ts](../backend/db/promote-admins.ts) |
| Middleware kiểm role | ⑤ | [require-role.ts:6-9](../backend/src/middlewares/require-role.ts#L6-L9) |
| Gắn cho cả router admin | ⑤ | [admin.routes.ts:8](../backend/src/features/admin/presentation/admin.routes.ts#L8) |
| Gate ở frontend | ② | [auth.tsx:21](../frontend/src/features/auth/auth.tsx#L21), [auth.tsx:47-51](../frontend/src/features/auth/auth.tsx#L47-L51) |

**Đổi role có hiệu lực khi nào?** Khi access token được làm mới (tối đa 15 phút), vì `cashcash_refresh_rotate` đọc role mới nhất từ bảng `users`.

---

## 4. Dữ liệu & hằng số cần nhớ

### Cookie ([auth.cookie.ts](../backend/src/features/auth/presentation/auth.cookie.ts))

| Cookie | Nội dung | Path | Thời hạn | Thuộc tính |
|---|---|---|---|---|
| `cc_access` | JWT access token | `/` | 15 phút (`ACCESS_TOKEN_TTL` = 900s) | HttpOnly, SameSite=Lax, Secure khi production |
| `cc_refresh` | 64 ký tự hex ngẫu nhiên | `/api/v1/auth` | 7 ngày (`REFRESH_MS`) | như trên |
| `cc_google_flow` | `state.verifier.nonce` | `/api/v1/auth/google` | 10 phút | như trên, xoá ngay khi callback |

### Access token (JWT)

```json
header:  { "alg": "HS256", "typ": "JWT" }
payload: { "role": "USER", "sub": "<userId UUID>", "iss": "cashcash-api", "aud": "cashcash-api", "iat": ..., "exp": iat + 900 }
```
Ký bằng `JWT_SECRET` (≥ 32 ký tự, kiểm ở [env.ts:19](../backend/src/config/env.ts#L19)). Payload **không mã hoá**, ai cũng đọc được bằng base64, nên chỉ chứa `sub` và `role`.

### Bảng `refresh_tokens`

| Cột | Ý nghĩa |
|---|---|
| `tokenHash` (PK) | SHA-256 của token, **không lưu token thô** |
| `userId` | chủ sở hữu |
| `familyId` | mọi token xoay vòng từ **một lần đăng nhập** có chung family |
| `expiresAt` | hết hạn sau 7 ngày |
| `revokedAt` | thời điểm bị thu hồi (null = còn dùng được) |
| `replacedBy` | hash của token thay thế nó (khi rotate) |

### Rate limit ([rate-limit.ts](../backend/src/middlewares/rate-limit.ts), cửa sổ 15 phút, lưu trong RAM)

| Bucket | Áp cho | Giới hạn | Khoá |
|---|---|---|---|
| `credentials` | login, register, forgot/verify/reset password | 20 | IP |
| `refresh` | `/auth/refresh` | 120 | IP |
| `google` | `/auth/google/callback` | 20 | IP |
| `password` | `/users/me/password` | 10 | userId |

### Mã lỗi

| HTTP | `code` | Khi nào |
|---|---|---|
| 400 | `BAD_REQUEST` | Zod không qua ([validation.ts](../backend/src/lib/validation.ts)), OTP sai |
| 401 | `INVALID_CREDENTIALS` | sai email/mật khẩu |
| 401 | `UNAUTHENTICATED` | access token thiếu/sai/hết hạn, refresh thất bại |
| 401 | `REFRESH_STALE` | tab khác vừa refresh (frontend coi như thành công) |
| 403 | `INVALID_ORIGIN` | thiếu header `X-CashCash-Request` hoặc Origin lạ |
| 403 | `FORBIDDEN` | không đủ role |
| 409 | `CONFLICT` | email đã dùng; mật khẩu vừa bị đổi ở nơi khác |
| 429 | `RATE_LIMITED` | vượt rate limit |
| 503 | `MAIL_BUSY` | hàng đợi gửi mail đầy (10 job) |

---

## 5. Trade-offs (đánh đổi thiết kế)

Mẫu trả lời khi được hỏi: **"Em chọn A vì …; cái giá là …; em giảm cái giá đó bằng …; nếu cần mở rộng thì …"**

| Quyết định | Được gì | Mất gì | Giảm thiệt hại bằng |
|---|---|---|---|
| **JWT access token** thay vì session tra DB mỗi request | `currentUser` không truy vấn DB, nhanh, dễ mở rộng nhiều server | Không thu hồi được ngay (logout, đổi role, khoá user có độ trễ) | TTL ngắn 15 phút; refresh token lưu DB thu hồi được |
| **Hai token** (access ngắn + refresh dài) thay vì một token dài | Lộ access token chỉ nguy hiểm ≤ 15 phút; người dùng vẫn giữ phiên 7 ngày | Phức tạp hơn: cần endpoint refresh, logic retry ở frontend | `http.ts` gói gọn logic, các trang không cần biết |
| **Cookie HttpOnly** thay vì localStorage | Mã JS (kể cả XSS) không đọc được token | Cookie tự gửi kèm nên phải chống CSRF | SameSite=Lax + header `X-CashCash-Request` + kiểm Origin |
| **Rotation + phát hiện dùng lại** | Refresh token bị trộm và dùng lại thì cả family bị thu hồi | Nhiều tab refresh cùng lúc dễ bị đăng xuất oan | Cửa sổ `stale` 10 giây + single-flight ở frontend |
| **HS256** (khoá đối xứng) thay vì RS256 | Đơn giản, một secret, nhanh | Ai kiểm được token thì cũng ký được token | Chỉ một backend nên chấp nhận được; nhiều service thì chuyển RS256 + JWKS |
| **scrypt** thay vì bcrypt/argon2 | Có sẵn trong `node:crypto`, không thêm thư viện native; tốn bộ nhớ nên GPU khó brute-force | Mỗi lần hash ~vài chục ms CPU | Rate limit 20 lần/15 phút |
| **SHA-256** cho refresh token (không phải scrypt) | Nhanh, tra cứu theo hash được | — | Token 256 bit ngẫu nhiên nên không thể brute-force, không cần hash chậm |
| **RPC Postgres** thay vì gọi nhiều query từ Node | Nguyên tử (transaction), có khoá dòng chống race | Logic nằm trong SQL, khó đọc/test hơn TypeScript | Migration có comment; test gọi qua service |
| **Rate limit trong RAM** thay vì Redis | Không cần hạ tầng thêm | Restart là mất bộ đếm; nhiều instance không chia sẻ | Đủ cho đồ án một server; mở rộng thì dùng Redis |
| **Đăng ký báo "Email đã được sử dụng"** | UX rõ ràng | Lộ được email nào đã đăng ký (login và forgot password thì không lộ) | Rate limit; muốn chặt hơn thì xác minh email trước khi tạo tài khoản |
| **Tự liên kết Google vào tài khoản trùng email** | Người đã đăng ký bằng mật khẩu bấm Google vẫn vào đúng tài khoản | Phụ thuộc Google đã xác minh email | Bắt buộc `email_verified === true` |
| **Kiểm role từ JWT** thay vì tra DB | Nhanh | Hạ quyền admin có độ trễ ≤ 15 phút | Route cực nhạy cảm có thể tra DB thêm |

---

## 6. Câu hỏi vấn đáp

### 6.1 Câu hỏi "trace code" (gần như chắc chắn bị hỏi)

<details><summary><b>Q1. Chỉ cho tôi từ lúc bấm "Đăng nhập" tới khi có cookie.</b></summary>

`auth-page.tsx` `submit()` → `http.post('/auth/login')` → `app.ts` chặn CSRF → `auth.routes.ts` rate limit → `authController.login` → `parseInput(loginSchema)` → `authService.login`: tìm user, `verifyPassword` (scrypt), `newRefreshToken`, RPC `cashcash_session_create`, `signAccessToken` → controller `setAuthCookies` → trả user. Xem bảng ở [US-02](#us-02--đăng-nhập-bằng-mật-khẩu-luồng-quan-trọng-nhất-nên-thuộc-lòng).
</details>

<details><summary><b>Q2. Server biết request này của user nào bằng cách nào?</b></summary>

Middleware `currentUser` ([current-user.ts](../backend/src/middlewares/current-user.ts)) đọc cookie `cc_access`, `verifyAccessToken` kiểm chữ ký, rồi gán `req.userId = claims.sub`. Các service dùng `req.userId` để lọc dữ liệu. Client không thể tự gửi userId.
</details>

<details><summary><b>Q3. Access token hết hạn thì chuyện gì xảy ra, code ở đâu?</b></summary>

Server trả 401 → `http.ts` dòng 82 gọi `refreshSession()` → `POST /auth/refresh` → `authService.refresh` → RPC `cashcash_refresh_rotate` → cookie mới → `http.ts` gửi lại request gốc. Người dùng không thấy gì.
</details>

<details><summary><b>Q4. Route nào cần đăng nhập, route nào không? Cấu hình ở đâu?</b></summary>

[app.ts:35-36](../backend/src/app.ts#L35-L36): `/api/v1/auth` gắn trước và không có `currentUser`; mọi thứ còn lại dưới `/api/v1` đi qua `currentUser`. Thêm route mới vào `apiRouter` là tự động được bảo vệ.
</details>

<details><summary><b>Q5. Làm sao chặn user thường vào trang admin?</b></summary>

Hai lớp: frontend `AdminGate` chuyển về trang chủ (chỉ là UI); backend `adminRouter.use(requireRole('ADMIN'))` trả 403. Lớp backend mới là bảo mật thật, gọi API trực tiếp bằng curl vẫn bị 403.
</details>

<details><summary><b>Q6. Mật khẩu được lưu thế nào? Chỉ cho tôi.</b></summary>

[password.ts](../backend/src/features/auth/infrastructure/password.ts): salt 16 byte ngẫu nhiên, scrypt (N=32768, r=8, p=1), lưu dạng `scrypt$<salt>$<hash 64 byte hex>` trong `users.passwordHash`. Kiểm bằng `timingSafeEqual`.
</details>

### 6.2 Câu hỏi "vì sao"

<details><summary><b>Q7. Vì sao không lưu JWT trong localStorage cho đơn giản?</b></summary>

localStorage đọc được bằng JavaScript, nên chỉ cần một lỗ XSS là token bị gửi đi. Cookie HttpOnly thì JS không đọc được. Cái giá là phải chống CSRF.
</details>

<details><summary><b>Q8. Vì sao cần hai token, một token sống 7 ngày không được à?</b></summary>

Access token đi kèm mọi request và không thu hồi được, nên phải sống ngắn để lộ ra thì thiệt hại nhỏ. Refresh token chỉ gửi tới `/api/v1/auth`, lưu hash trong DB nên thu hồi được, vì vậy sống dài được.
</details>

<details><summary><b>Q9. JWT có mã hoá dữ liệu không?</b></summary>

Không. JWT chỉ **ký**: payload là base64url, ai cũng đọc được, nhưng không ai sửa được mà không làm hỏng chữ ký. Vì vậy chỉ để `sub` và `role`, không để email hay thông tin nhạy cảm.
</details>

<details><summary><b>Q10. Vì sao <code>verifyAccessToken</code> cố định <code>algorithms: ['HS256']</code>?</b></summary>

Chống tấn công đổi thuật toán: kẻ xấu sửa header thành `alg: none` (không chữ ký) hoặc đổi sang thuật toán khác. Thư viện chỉ chấp nhận đúng HS256.
</details>

<details><summary><b>Q11. Vì sao refresh token chỉ hash SHA-256 mà mật khẩu phải dùng scrypt?</b></summary>

Mật khẩu do người đặt, ít ngẫu nhiên nên dò từ điển được, cần hash chậm. Refresh token là 256 bit ngẫu nhiên: thử hết 2^256 khả năng là bất khả thi dù hash nhanh.
</details>

<details><summary><b>Q12. Vì sao DB không lưu refresh token thô?</b></summary>

Nếu DB bị lộ (backup, SQL injection), kẻ xấu có hash nhưng không dùng được, vì server nhận token thô rồi tự băm ra để so.
</details>

<details><summary><b>Q13. Vì sao sai email và sai mật khẩu báo cùng một lỗi?</b></summary>

Chống dò tài khoản (user enumeration). Thời gian phản hồi cũng như nhau vì `verifyPassword` luôn chạy scrypt ([password.ts:16](../backend/src/features/auth/infrastructure/password.ts#L16)).
</details>

<details><summary><b>Q14. Header <code>X-CashCash-Request: 1</code> để làm gì?</b></summary>

Chống CSRF. Form HTML trên trang độc hại không đặt được header tuỳ chỉnh. `fetch` từ origin khác có header tuỳ chỉnh thì trình duyệt phải gửi preflight CORS trước, mà CORS chỉ cho phép `CORS_ORIGIN`, nên request thật không được gửi. Thêm vào đó server còn kiểm header `Origin`, và cookie có `SameSite=Lax`.
</details>

<details><summary><b>Q15. Vì sao cookie refresh có <code>path=/api/v1/auth</code>?</b></summary>

Để refresh token chỉ được gửi tới các route auth, không đi kèm hàng trăm request API khác, giảm chỗ có thể bị lộ (log, proxy…).
</details>

<details><summary><b>Q16. Vì sao dùng hàm RPC trong Postgres thay vì viết query ở Node?</b></summary>

Các thao tác như rotate token (đọc token, kiểm trạng thái, insert token mới, thu hồi token cũ) phải nguyên tử và có khoá dòng `FOR UPDATE`. Nếu tách thành nhiều query từ Node, hai request đồng thời có thể cùng dùng một token. Supabase JS client không có transaction nhiều câu lệnh, nên đặt vào hàm plpgsql.
</details>

<details><summary><b>Q17. Vì sao Zod schema để ở <code>packages/shared</code>?</b></summary>

Frontend dùng để báo lỗi ngay trên form, backend dùng để kiểm thật (`parseInput`). Một nguồn duy nhất nên hai bên không lệch nhau. Validate ở frontend chỉ là UX; backend luôn validate lại.
</details>

### 6.3 Câu hỏi "nếu … thì sao"

<details><summary><b>Q18. Nếu kẻ xấu trộm được refresh token và dùng nó?</b></summary>

Một trong hai bên (kẻ xấu hoặc nạn nhân) sẽ rotate trước. Khi bên còn lại dùng token cũ (đã bị thu hồi, quá 10 giây), RPC trả `reused` và **thu hồi cả family**, cả hai bị đăng xuất. Nạn nhân đăng nhập lại, kẻ xấu mất quyền.
</details>

<details><summary><b>Q19. Nếu mở 3 tab, access token cùng hết hạn, 3 tab cùng refresh?</b></summary>

Trong một tab, `refreshSession` dùng chung một Promise nên chỉ gọi một lần. Giữa các tab: tab đầu rotate thành công; các tab sau gửi token vừa bị thay (< 10 giây) nên nhận `stale`. Server **không** xoá cookie, frontend coi như đã refresh và gửi lại request, lúc này cookie mới của tab đầu đã có trong trình duyệt.
</details>

<details><summary><b>Q20. Admin bị hạ xuống USER, bao lâu thì mất quyền?</b></summary>

Tối đa 15 phút (TTL access token). Lần refresh tiếp theo, RPC đọc role mới từ DB và ký token mới với role USER.
</details>

<details><summary><b>Q21. Người dùng gửi <code>{"role":"ADMIN"}</code> trong body đăng ký thì sao?</b></summary>

Không có tác dụng ở ba lớp: Zod `registerSchema` loại bỏ field lạ; service không truyền role vào RPC; RPC hard-code `'USER'`, và trigger `cashcash_guard_role` ép role = USER khi insert.
</details>

<details><summary><b>Q22. Sửa payload JWT đổi role thành ADMIN thì sao?</b></summary>

Chữ ký không khớp vì không có `JWT_SECRET` → `jwtVerify` ném lỗi → `verifyAccessToken` trả null → 401.
</details>

<details><summary><b>Q23. <code>JWT_SECRET</code> bị lộ thì sao? Xử lý thế nào?</b></summary>

Kẻ xấu ký được token cho bất kỳ user nào, kể cả ADMIN. Xử lý: đổi `JWT_SECRET` ngay (mọi access token cũ vô hiệu; người dùng tự refresh vì refresh token không phụ thuộc secret), kiểm tra log, và nếu secret từng bị commit lên Git thì phải coi là lộ vĩnh viễn, đổi secret chứ không chỉ xoá file.
</details>

<details><summary><b>Q24. Người dùng đổi mật khẩu thì các thiết bị khác thế nào?</b></summary>

RPC `cashcash_change_password` thu hồi mọi refresh token của user, tạo family mới chỉ cho thiết bị hiện tại. Thiết bị khác vẫn dùng được access token còn lại (≤ 15 phút), sau đó refresh thất bại và bị đăng xuất.
</details>

<details><summary><b>Q25. Đăng nhập Google bằng email trùng với tài khoản đã đăng ký mật khẩu?</b></summary>

RPC `cashcash_oauth_login` tìm thấy user theo email → outcome `attached`, liên kết Google `sub` vào user đó. Từ đó đăng nhập được bằng cả hai cách. An toàn vì đã bắt buộc Google xác minh email.
</details>

<details><summary><b>Q26. Tài khoản tạo bằng Google muốn đăng nhập bằng mật khẩu?</b></summary>

`passwordHash` là null, `hasPassword: false`. Vào trang Cá nhân đặt mật khẩu lần đầu: `user.service.changePassword` bỏ qua bước kiểm mật khẩu cũ khi `passwordHash === null`. Lưu ý luồng quên mật khẩu bỏ qua tài khoản không có mật khẩu.
</details>

<details><summary><b>Q27. Brute-force OTP 6 số?</b></summary>

Tối đa 5 lần sai mỗi mã (`attempts`), mã sống 10 phút, rate limit 20 request/15 phút/IP. Xác suất đoán trúng trong 5 lần là 5/1.000.000.
</details>

<details><summary><b>Q28. Server restart thì người dùng có bị đăng xuất không?</b></summary>

Không. Access token kiểm bằng secret (không lưu trong RAM), refresh token lưu trong DB. Chỉ có bộ đếm rate limit bị reset.
</details>

### 6.4 Câu hỏi lý thuyết hay gặp

<details><summary><b>Q29. Authentication khác Authorization?</b></summary>

Authentication: "bạn là ai" (đăng nhập, `currentUser`). Authorization: "bạn được làm gì" (`requireRole`, lọc dữ liệu theo `userId`).
</details>

<details><summary><b>Q30. OAuth 2.0 khác OpenID Connect?</b></summary>

OAuth 2.0 để **ủy quyền** (cấp access token gọi API của bên khác). OpenID Connect là lớp **xác thực** trên OAuth 2.0: thêm scope `openid` và `id_token` (một JWT chứa danh tính). CashCash chỉ dùng `id_token` để biết người dùng là ai, không dùng access token của Google.
</details>

<details><summary><b>Q31. Vì sao kiểm được chữ ký id_token của Google mà không có secret của Google?</b></summary>

Google ký bằng RS256 (bất đối xứng) với private key; CashCash kiểm bằng public key Google công bố ở JWKS (`googleapis.com/oauth2/v3/certs`).
</details>

<details><summary><b>Q32. Hạn chế lớn nhất của module này là gì, em sẽ cải thiện thế nào?</b></summary>

Trả lời thật: (1) access token không thu hồi ngay, có thể thêm denylist `jti` trong Redis; (2) rate limit trong RAM, không dùng được khi chạy nhiều server; (3) chưa có xác minh email khi đăng ký và chưa có 2FA; (4) chưa có trang quản lý thiết bị đăng nhập, dù bảng `refresh_tokens` đã có `familyId` để làm việc đó.
</details>

---

## 7. Kiểm thử & checklist demo

### Test tự động

```bash
npx vitest run backend/tests/features/auth backend/tests/middlewares backend/tests/features/users backend/tests/features/admin frontend/tests/features/auth frontend/tests/features/admin
```
Kết quả lần chạy gần nhất: **13 file, 70 test, tất cả pass**.

| File test | Kiểm gì |
|---|---|
| [jwt.test.ts](../backend/tests/features/auth/application/jwt.test.ts) | Ký/kiểm JWT; từ chối token hết hạn, sai secret, payload bị sửa, `alg: none`, sai iss/aud |
| [password.test.ts](../backend/tests/features/auth/application/password.test.ts) | Hash và verify scrypt |
| [auth.refresh.test.ts](../backend/tests/features/auth/application/auth.refresh.test.ts) | Rotation, chuỗi rotate liên tiếp, tab song song (`stale`), token sai định dạng, bắt buộc header CSRF, logout thu hồi family |
| [auth.google.test.ts](../backend/tests/features/auth/application/auth.google.test.ts) | Redirect có state/nonce/PKCE; callback sai state, thiếu cookie, thiếu code, người dùng huỷ, email chưa xác minh; đăng nhập thành công |
| [password-reset.service.test.ts](../backend/tests/features/auth/application/password-reset.service.test.ts) | Không gửi cho email lạ hoặc tài khoản không mật khẩu; SMTP lỗi thì xoá token; chặn gửi lặp trong 1 phút |
| [current-user.test.ts](../backend/tests/middlewares/current-user.test.ts) | Middleware 401 / gán userId |
| [user.password.test.ts](../backend/tests/features/users/application/user.password.test.ts) | Đổi/đặt mật khẩu |
| [admin.routes.test.ts](../backend/tests/features/admin/application/admin.routes.test.ts) | 403 với USER |
| [auth.test.tsx](../frontend/tests/features/auth/auth.test.tsx), [admin-gate.test.tsx](../frontend/tests/features/admin/admin-gate.test.tsx), [password-recovery-page.test.tsx](../frontend/tests/features/auth/password-recovery-page.test.tsx) | Chuyển hướng khi chưa đăng nhập, đăng nhập/đăng ký, xoá cache khi đăng xuất, lỗi Google, chặn trang admin, trang quên mật khẩu |

Script kiểm với DB thật: [check-auth.ts](../backend/scripts/check-auth.ts), [check-password-reset.ts](../backend/scripts/check-password-reset.ts).

### Kịch bản demo trực tiếp (DevTools)

1. **Đăng nhập** → DevTools › Application › Cookies: chỉ ra `cc_access`, `cc_refresh` có cờ HttpOnly. Gõ `document.cookie` trong Console: không thấy hai cookie này.
2. **Giải mã JWT**: copy `cc_access` dán vào jwt.io, chỉ ra payload chỉ có `sub`, `role`, `iss`, `aud`, `iat`, `exp`. Sửa `role` thành ADMIN: chữ ký không hợp lệ.
3. **Refresh**: xoá riêng cookie `cc_access` rồi bấm sang trang khác. Tab Network: `401` → `POST /auth/refresh 204` → request gốc chạy lại `200`.
4. **CSRF**: chạy trong Console `fetch('/api/v1/auth/logout', {method:'POST'})` (không có header) → **403 INVALID_ORIGIN**.
5. **Phân quyền**: đăng nhập user thường, gõ `/admin` → bị chuyển về trang chủ; gọi `fetch('/api/v1/admin/ping').then(r => r.status)` → **403**.
6. **Đăng xuất**: cookie biến mất; trong Supabase, bảng `refresh_tokens` có `revokedAt` cho cả family.
7. **Quên mật khẩu**: `npm run mail:up` mở Mailpit, gửi OTP, nhập sai vài lần, rồi nhập đúng.

### Trước buổi chấm

- [ ] `backend/.env` có trong `.gitignore` và **chưa từng bị commit** (`git log --all -- backend/.env` phải rỗng).
- [ ] `JWT_SECRET`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_SECRET_KEY` không xuất hiện trong lịch sử Git.
- [ ] Tự trace lại được US-02, US-03, US-05 mà không cần nhìn tài liệu.
- [ ] Nói được ít nhất 3 trade-off ở mục 5 theo mẫu "chọn A vì…, cái giá là…, giảm bằng…".

---

## 8. Thuật ngữ

| Thuật ngữ | Nghĩa ngắn gọn |
|---|---|
| JWT | Chuỗi `header.payload.signature`; payload đọc được, chữ ký chống sửa |
| Access token | JWT sống ngắn (15 phút), chứng minh danh tính mỗi request |
| Refresh token | Chuỗi ngẫu nhiên sống dài (7 ngày), chỉ dùng để xin access token mới |
| Rotation | Mỗi lần refresh, token cũ bị huỷ và cấp token mới |
| Token family | Chuỗi các refresh token sinh ra từ một lần đăng nhập |
| Reuse detection | Token đã huỷ bị dùng lại → coi là bị trộm → huỷ cả family |
| HttpOnly | Cookie mà JavaScript không đọc được |
| SameSite=Lax | Cookie không được gửi kèm request POST từ trang khác |
| CSRF | Trang độc hại lợi dụng cookie của nạn nhân để gửi request thay nạn nhân |
| XSS | Chèn mã JS độc vào trang để chạy trong trình duyệt nạn nhân |
| CORS | Cơ chế trình duyệt quyết định origin nào được đọc phản hồi / gửi request đặc biệt |
| OAuth 2.0 | Giao thức ủy quyền |
| OpenID Connect | Lớp xác thực trên OAuth 2.0, thêm `id_token` |
| PKCE | `code_verifier` bí mật + `code_challenge` = SHA-256 của nó, chống trộm authorization code |
| state / nonce | Giá trị ngẫu nhiên chống CSRF ở callback / chống phát lại id_token |
| JWKS | Tập public key mà Google công bố để kiểm chữ ký |
| scrypt | Hàm băm mật khẩu chậm và tốn bộ nhớ |
| Salt | Chuỗi ngẫu nhiên trộn vào mật khẩu trước khi băm, để hai mật khẩu giống nhau ra hash khác nhau |
| timingSafeEqual | So sánh mất thời gian như nhau dù sai ở ký tự nào, chống đo thời gian |
| RPC | Hàm Postgres gọi từ backend, chạy trong một transaction |
| `FOR UPDATE` | Khoá dòng, request khác phải chờ, chống race condition |
| Rate limit | Giới hạn số request trong một khoảng thời gian |
](https://www.tiktok.com/@nguyendocthancadoi/video/7697836901662821650?is_from_webapp=1&sender_device=pc&web_id=7693981593920865793)
