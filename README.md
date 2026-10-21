# Module Auth (xác thực & phân quyền) — CashCash

> Tài liệu này đi theo **luồng hoạt động qua từng tầng**: mỗi user story được lần từ nút bấm trên giao diện, qua từng lớp backend, xuống tới hàm SQL trong database, kèm link tới đúng dòng code.
> Cuối tài liệu là **hướng dẫn cách trình bày và trả lời** (công thức trả lời, bài giới thiệu 2 phút, cách trace trên VS Code, văn mẫu), **bộ câu hỏi vấn đáp** (trace code, "vì sao", "nếu… thì sao", tấn công) và **checklist demo** cho buổi chấm điểm.

## Mục lục

1. [Các tầng của hệ thống](#1-các-tầng-của-hệ-thống)
2. [User stories](#2-user-stories)
3. [Trace từng user story qua các tầng](#3-trace-từng-user-story-qua-các-tầng)
4. [Dữ liệu & hằng số cần nhớ](#4-dữ-liệu--hằng-số-cần-nhớ)
5. [Trade-offs (đánh đổi thiết kế)](#5-trade-offs-đánh-đổi-thiết-kế)
6. [Cách trình bày & trả lời](#6-cách-trình-bày--trả-lời)
7. [Câu hỏi vấn đáp](#7-câu-hỏi-vấn-đáp)
8. [Kiểm thử & checklist demo](#8-kiểm-thử--checklist-demo)
9. [Thuật ngữ](#9-thuật-ngữ)

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

Phần này là **lời nói mẫu** khi giảng viên bảo *"em trace cho tôi luồng X"*. Cách đọc:

- Dòng **📂 Mở …** là việc bạn làm trên VS Code (mở file nào, tới hàm nào). Bấm vào link là nhảy tới đúng dòng.
- Đoạn trích dẫn ngay dưới là **câu bạn nói** trong lúc file đang mở.

Quy tắc chung: bắt đầu từ chỗ người dùng bấm, đi xuống backend, xuống database, rồi nói ngược lên kết quả trả về. Ở mỗi file chỉ nói một hai câu "chỗ này làm gì", không đọc từng dòng code. Không cần học thuộc từng chữ, chỉ cần nói đúng ý theo thứ tự.

### US-02 — Đăng nhập bằng mật khẩu (luồng quan trọng nhất, nên luyện kỹ)

**📂 Mở [auth-page.tsx:37](../frontend/src/features/auth/auth-page.tsx#L37-L56), hàm `submit`**

> Dạ, em bắt đầu từ trang đăng nhập. Khi người dùng bấm nút Đăng nhập thì hàm `submit` này chạy. Đầu tiên em kiểm tra email và mật khẩu ngay trên trình duyệt bằng Zod; sai định dạng thì báo lỗi luôn trên form, không cần gửi lên server. Đúng định dạng thì em gọi API `POST /auth/login`.

**📂 Mở [http.ts:63](../frontend/src/lib/http.ts#L63-L76), hàm `request`**

> Mọi lời gọi API của frontend đều đi qua file này. Ở đây em làm hai việc: gắn thêm header `X-CashCash-Request` để chống CSRF, và bật `credentials: 'include'` để trình duyệt gửi cookie kèm theo. Riêng route đăng nhập nằm trong danh sách `NO_REFRESH` ở [dòng 30](../frontend/src/lib/http.ts#L30), tức là nếu bị lỗi 401 thì đó là sai mật khẩu thật, em không tự đi làm mới token.

**📂 Mở [app.ts:26](../backend/src/app.ts#L26-L34) (backend)**

> Request sang tới backend thì đi qua `app.ts` trước. Ở đây có bước chặn CSRF: request nào thay đổi dữ liệu mà thiếu header vừa nói, hoặc đến từ một trang web lạ, thì bị trả 403 ngay. Qua được thì mới vào router của phần auth.

**📂 Mở [auth.routes.ts:6](../backend/src/features/auth/presentation/auth.routes.ts#L6)**

> Route đăng nhập có gắn rate limit: mỗi địa chỉ IP chỉ được thử 20 lần trong 15 phút, quá thì trả 429. Cái này để chống người ta thử mật khẩu liên tục. Qua rate limit thì vào controller.

**📂 Mở [auth.controller.ts:45](../backend/src/features/auth/presentation/auth.controller.ts#L45-L50), hàm `login`**

> Controller chỉ lo phần HTTP. Nó kiểm lại dữ liệu bằng đúng cái schema Zod mà frontend đã dùng, vì kiểm ở frontend thì ai cũng bỏ qua được bằng Postman. Kiểm xong thì gọi sang service để xử lý nghiệp vụ.

**📂 Mở [auth.service.ts:44](../backend/src/features/auth/application/auth.service.ts#L44-L59), hàm `login`**

> Service tìm user theo email rồi so mật khẩu. Sai email hay sai mật khẩu em đều trả cùng một lỗi là "sai thông tin đăng nhập", để người ngoài không đoán được email nào đã có tài khoản. Nếu đúng thì em làm ba việc: sinh một refresh token ngẫu nhiên, lưu nó xuống database, và ký một access token dạng JWT sống 15 phút.

**📂 Mở [password.ts:14](../backend/src/features/auth/infrastructure/password.ts#L14-L19), hàm `verifyPassword`**

> Mật khẩu được so bằng thuật toán scrypt. Có một chi tiết: hàm này luôn chạy scrypt, kể cả khi không tìm thấy user. Như vậy email có thật hay không có thật thì thời gian trả lời đều như nhau, kẻ tấn công không đo thời gian để dò email được.

**📂 Mở [refresh_tokens/migration.sql:33](../backend/db/migrations/20261017130000_refresh_tokens/migration.sql#L33-L48), hàm `cashcash_session_create`**

> Đây là hàm trong database để tạo phiên đăng nhập. Em không lưu refresh token thật mà chỉ lưu mã băm SHA-256 của nó, lỡ database bị lộ thì cũng không dùng được. Hàm này còn kiểm lại một lần nữa là mật khẩu chưa bị đổi trong lúc đang đăng nhập, rồi tạo một "family" mới, tức là một chuỗi token riêng cho lần đăng nhập này.

**📂 Quay lại controller, mở [auth.cookie.ts:23](../backend/src/features/auth/presentation/auth.cookie.ts#L23-L26)**

> Giờ em đi ngược lên. Service trả về thông tin user và hai token. Controller đặt hai token vào hai cookie có cờ HttpOnly, nghĩa là JavaScript không đọc được, rồi trả thông tin user về. Thông tin trả về không có mật khẩu, hàm `toAuthUser` đã bỏ trường đó đi.

**📂 Quay lại [auth-page.tsx](../frontend/src/features/auth/auth-page.tsx#L37-L56)**

> Frontend nhận được user thì xoá cache cũ, lưu user mới vào cache rồi chuyển về trang chủ. Đó là toàn bộ luồng đăng nhập ạ.

**Nếu bị hỏi thêm:**

> *"Nếu mật khẩu bị đổi đúng lúc đang đăng nhập thì sao?"* — Dạ, hàm `cashcash_session_create` nhận vào mã băm mật khẩu mà service vừa kiểm, rồi khoá dòng user và so lại. Nếu đã khác thì hàm trả `false` và em trả 401, không tạo phiên.

> *"Trình duyệt đang có refresh token cũ thì sao?"* — Dạ, ở [auth.controller.ts:47](../backend/src/features/auth/presentation/auth.controller.ts#L47) trước khi đặt cookie mới em huỷ token cũ của trình duyệt đó, để không còn token thừa sống trong database.

### US-01 — Đăng ký

**📂 Mở [auth-page.tsx:41](../frontend/src/features/auth/auth-page.tsx#L41-L45)**

> Dạ, đăng ký dùng chung trang với đăng nhập. Trước khi gửi, em kiểm hai ô mật khẩu có khớp nhau không, rồi kiểm bằng schema đăng ký: tên từ 1 đến 80 ký tự, mật khẩu ít nhất 8 ký tự. Schema này nằm ở [packages/shared](../packages/shared/src/schemas/auth.schema.ts#L7-L10) nên backend cũng dùng đúng quy tắc đó. Xong thì gọi `POST /auth/register`.

> Phần đi qua `http.ts`, chặn CSRF và rate limit thì giống hệt đăng nhập nên em không nói lại.

**📂 Mở [auth.controller.ts:39](../backend/src/features/auth/presentation/auth.controller.ts#L39-L44), hàm `register`**

> Controller kiểm lại bằng Zod rồi gọi service. Thành công thì trả mã 201, nghĩa là đã tạo mới một tài nguyên.

**📂 Mở [auth.service.ts:28](../backend/src/features/auth/application/auth.service.ts#L28-L43), hàm `register`**

> Service băm mật khẩu bằng scrypt, sinh id cho user và một refresh token, rồi gọi đúng một hàm trong database. Nếu email đã có người dùng, database báo lỗi trùng với mã 23505, em đổi lỗi đó thành 409 kèm câu "email đã được sử dụng".

**📂 Mở [refresh_tokens/migration.sql:17](../backend/db/migrations/20261017130000_refresh_tokens/migration.sql#L17-L31), hàm `cashcash_register`**

> Hàm này làm ba việc trong cùng một transaction: tạo user với role ghi cứng là USER, tạo sẵn ví và danh mục mặc định, và lưu refresh token. Em gom vào một hàm vì nếu tách ra ba lần gọi mà bước giữa bị lỗi thì sẽ có một user không có ví. Trong một transaction thì hoặc thành công cả ba, hoặc huỷ cả ba.

**📂 Mở [user_role/migration.sql:6](../backend/db/migrations/20261017120000_user_role/migration.sql#L6-L25)**

> Em còn thêm một lớp bảo vệ nữa: trigger trên bảng users luôn ép role về USER khi tạo mới. Nên dù code phía trên có lỗi thì cũng không ai tự đăng ký thành admin được.

> Sau đó đi ngược lên giống đăng nhập: controller đặt hai cookie, frontend vào thẳng trang chủ, người dùng không phải đăng nhập lại.

### US-08 — Gọi API khi đã đăng nhập (ví dụ xem danh sách giao dịch)

> Dạ, giả sử người dùng mở trang giao dịch, frontend gọi `GET /api/v1/transactions`.

**📂 Mở [http.ts](../frontend/src/lib/http.ts#L63-L76)**

> Trình duyệt tự gửi cookie chứa access token kèm theo request. Frontend không phải làm gì, mà thực ra cũng không đọc được cookie này.

**📂 Mở [app.ts:35](../backend/src/app.ts#L35-L36)**

> Đây là request GET nên không cần header chống CSRF. Điểm quan trọng nằm ở hai dòng này: mọi route dưới `/api/v1`, trừ nhóm `/auth`, đều phải đi qua middleware `currentUser` trước. Nhờ vậy sau này thêm route mới thì tự động được bảo vệ, không sợ quên.

**📂 Mở [current-user.ts:7](../backend/src/middlewares/current-user.ts#L7-L13)**

> Middleware này lấy access token từ cookie rồi kiểm. Token hợp lệ thì nó ghi id của user và role vào request, gọi là `req.userId` và `req.role`, rồi cho đi tiếp. Thiếu token, token sai hoặc hết hạn thì trả 401.

**📂 Mở [jwt.ts:25](../backend/src/features/auth/infrastructure/jwt.ts#L25-L38), hàm `verifyAccessToken`**

> Kiểm token gồm: chữ ký có đúng là do server em ký bằng `JWT_SECRET` không, chỉ chấp nhận thuật toán HS256, đúng nơi phát hành, chưa hết hạn, và id user phải đúng dạng UUID.

> Phía sau, controller và service của phần giao dịch chỉ lấy dữ liệu theo `req.userId`. Id này lấy từ token do server ký, em không bao giờ lấy userId từ body hay từ URL, nên người dùng không thể xem dữ liệu của người khác.

> Một ý nên nói thêm: middleware này không truy vấn database, chỉ kiểm chữ ký, nên rất nhanh. Cái giá là token đã cấp ra thì không thu hồi ngay được, vì vậy em chỉ cho nó sống 15 phút.

### US-03 — Access token hết hạn, tự làm mới (refresh)

> Dạ, tình huống là người dùng đang dùng app, sau 15 phút thì access token hết hạn.

**📂 Mở [http.ts:82](../frontend/src/lib/http.ts#L82-L86)**

> Request tiếp theo bị server trả 401. Hàm `request` bắt được lỗi này. Nếu đây không phải route đăng nhập, đăng ký và request chưa được thử lại lần nào, thì nó gọi hàm `refreshSession`.

**📂 Mở [http.ts:33](../frontend/src/lib/http.ts#L33-L53), hàm `refreshSession`**

> Hàm này gọi `POST /auth/refresh`. Nếu cùng lúc có nhiều request cùng bị 401, em chỉ gọi refresh đúng một lần, các request khác chờ chung kết quả đó. Trình duyệt tự gửi cookie refresh token, cookie này chỉ được gửi tới đường dẫn `/api/v1/auth` thôi.

**📂 Mở [auth.controller.ts:51](../backend/src/features/auth/presentation/auth.controller.ts#L51-L62), hàm `refresh`**

> Route refresh có rate limit 120 lần trong 15 phút. Controller lấy refresh token từ cookie rồi gọi service.

**📂 Mở [auth.service.ts:77](../backend/src/features/auth/application/auth.service.ts#L77-L88), hàm `refresh`**

> Service kiểm token có đúng dạng 64 ký tự hex không, sinh sẵn một token mới, rồi gửi mã băm của token cũ xuống database.

**📂 Mở [refresh_tokens/migration.sql:53](../backend/db/migrations/20261017130000_refresh_tokens/migration.sql#L53-L81), hàm `cashcash_refresh_rotate`**

> Đây là chỗ quan trọng nhất của luồng. Hàm khoá dòng token lại để hai request không xử lý cùng lúc, rồi xét từng trường hợp.
> Không tìm thấy token thì từ chối. Token hết hạn thì từ chối.
> Nếu token đã bị thay thế cách đây chưa tới 10 giây, em hiểu là một tab khác vừa refresh xong, nên trả về trạng thái "stale", không coi là lỗi.
> Nếu token đã bị thay thế lâu hơn 10 giây mà vẫn có người dùng lại, nghĩa là có hai người cùng cầm một token, em coi là bị trộm và huỷ toàn bộ chuỗi token của lần đăng nhập đó.
> Còn nếu hợp lệ thì em đọc role mới nhất của user từ bảng users, tạo token mới trong cùng chuỗi, và đánh dấu token cũ là đã bị thay.

**📂 Quay lại [auth.controller.ts:51](../backend/src/features/auth/presentation/auth.controller.ts#L51-L62)**

> Đi ngược lên. Nếu hợp lệ, controller đặt cookie mới và trả 204. Nếu là "stale", controller trả 401 với mã `REFRESH_STALE` nhưng không xoá cookie, vì tab kia đã đặt cookie mới vào trình duyệt rồi. Các trường hợp còn lại thì xoá cookie và trả 401.

**📂 Quay lại [http.ts](../frontend/src/lib/http.ts#L33-L53), rồi mở [auth.tsx:24](../frontend/src/features/auth/auth.tsx#L24-L44)**

> Frontend nhận 204 hoặc "stale" thì gửi lại request ban đầu đúng một lần, người dùng không thấy gì cả. Nếu refresh thất bại thì `http.ts` phát sự kiện `auth-expired`. `AuthGate` ở file `auth.tsx` nghe sự kiện đó, xoá dữ liệu trong cache và đưa người dùng về trang đăng nhập.

### US-04 — Đăng xuất

**📂 Mở [auth.tsx:53](../frontend/src/features/auth/auth.tsx#L53-L79), hàm `useLogout`**

> Dạ, người dùng bấm Đăng xuất thì hook `useLogout` gọi `POST /auth/logout`.

**📂 Mở [auth.controller.ts:63](../backend/src/features/auth/presentation/auth.controller.ts#L63-L67), rồi [auth.service.ts:95](../backend/src/features/auth/application/auth.service.ts#L95-L99), rồi [refresh_tokens/migration.sql:84](../backend/db/migrations/20261017130000_refresh_tokens/migration.sql#L84-L94)**

> Backend lấy refresh token từ cookie, gọi hàm trong database để huỷ cả chuỗi token của lần đăng nhập này, rồi xoá hai cookie và trả 204.

**📂 Quay lại [auth.tsx:24](../frontend/src/features/auth/auth.tsx#L24-L29)**

> Ở frontend, em xoá toàn bộ dữ liệu riêng tư trong cache, đóng các bảng đang mở và đặt user về rỗng, nên `AuthGate` chuyển về trang đăng nhập. Em xoá cache để người dùng sau trên cùng máy không thấy dữ liệu của người trước.

> Giới hạn em biết: access token đã cấp vẫn còn hiệu lực tối đa 15 phút nếu ai đó đã chép được nó ra ngoài. Nhưng trên trình duyệt thì cookie đã bị xoá, refresh token đã bị huỷ, nên không làm mới được nữa.

### Mở app thì làm sao biết ai đang đăng nhập (`GET /auth/me`)

**📂 Mở [router.tsx:19](../frontend/src/app/router.tsx#L19-L34)**

> Dạ, mọi trang trong app đều được bọc trong `AuthGate`.

**📂 Mở [auth.tsx:13](../frontend/src/features/auth/auth.tsx#L13-L18) và [auth.tsx:40](../frontend/src/features/auth/auth.tsx#L40-L43)**

> Khi mở app, hook `useAuth` gọi `/auth/me` để hỏi server "tôi là ai". Trong lúc chờ thì hiện chữ "Đang kiểm tra", lỗi mạng thì có nút Thử lại, còn server trả lời là chưa đăng nhập thì chuyển về trang `/login`.

**📂 Mở [auth.controller.ts:99](../backend/src/features/auth/presentation/auth.controller.ts#L99-L104)**

> Route này nằm trong nhóm `/auth` nên không đi qua `currentUser`; controller tự kiểm JWT, rồi đọc user từ database để lấy tên và ảnh đại diện mới nhất. Nếu access token vừa hết hạn thì lỗi 401 ở đây cũng kích hoạt cơ chế tự làm mới như bình thường.

### US-05 — Đăng nhập bằng Google

**📂 Mở [auth-page.tsx:75](../frontend/src/features/auth/auth-page.tsx#L75)**

> Dạ, nút "Đăng nhập bằng Google" không gọi API bằng fetch mà là một đường link bình thường tới `/api/v1/auth/google`, trình duyệt chuyển cả trang sang đó.

**📂 Mở [auth.controller.ts:68](../backend/src/features/auth/presentation/auth.controller.ts#L68-L74), hàm `googleStart`, và [google.ts:27](../backend/src/features/auth/infrastructure/google.ts#L27-L36)**

> Server sinh ba chuỗi ngẫu nhiên là state, code verifier và nonce, rồi cất cả ba vào một cookie tạm, có cờ HttpOnly, sống 10 phút. Sau đó server chuyển người dùng sang trang đăng nhập của Google, gửi kèm state, nonce và mã băm của verifier, gọi là code challenge.

> Người dùng chọn tài khoản trên trang của Google. Xong thì Google chuyển người dùng về địa chỉ callback của em, kèm theo một mã `code` và cái state lúc nãy.

**📂 Mở [auth.controller.ts:75](../backend/src/features/auth/presentation/auth.controller.ts#L75-L98), hàm `googleCallback`**

> Ở callback, em đọc cookie tạm rồi xoá nó ngay để nó chỉ dùng được một lần. Em so state Google gửi về với state trong cookie; không khớp thì dừng, đây là để chống CSRF. Nếu người dùng bấm huỷ trên Google thì cũng dừng.

**📂 Mở [google.ts:41](../backend/src/features/auth/infrastructure/google.ts#L41-L54), hàm `exchangeGoogleCode`**

> Rồi server tự gọi sang Google, gửi code cùng verifier và client secret để đổi lấy `id_token`. Bước này là server nói chuyện trực tiếp với Google. Nếu ai đó chặn được code trên thanh địa chỉ thì cũng không đổi được, vì họ không có verifier.

**📂 Mở [google.ts:63](../backend/src/features/auth/infrastructure/google.ts#L63-L79), hàm `verifyGoogleIdToken`**

> `id_token` là một JWT do Google ký. Em kiểm chữ ký bằng public key mà Google công bố, kiểm token này đúng là cấp cho ứng dụng của em, chưa hết hạn, nonce khớp với cookie, và email đã được Google xác minh.

**📂 Mở [auth.service.ts:64](../backend/src/features/auth/application/auth.service.ts#L64-L75), rồi [oauth_accounts/migration.sql](../backend/db/migrations/20261017140000_oauth_accounts/migration.sql)**

> Service gọi hàm `cashcash_oauth_login` trong database. Hàm này xét ba trường hợp. Tài khoản Google này đã liên kết từ trước thì đăng nhập luôn. Chưa liên kết nhưng email trùng với một user đã có thì liên kết vào user đó. Còn chưa có gì thì tạo user mới không có mật khẩu, kèm ví và danh mục mặc định.

**📂 Quay lại [googleCallback](../backend/src/features/auth/presentation/auth.controller.ts#L75-L98) và [auth-page.tsx:11](../frontend/src/features/auth/auth-page.tsx#L11-L18)**

> Thành công thì controller đặt hai cookie giống đăng nhập thường rồi chuyển về trang chủ. Lỗi ở bước nào thì chuyển về `/login` kèm mã lỗi, trang đăng nhập đọc mã đó và hiện thông báo tiếng Việt tương ứng.

**Nếu bị hỏi thêm:**

> *"Ba giá trị state, verifier, nonce khác nhau thế nào?"* — Dạ, state để chống kẻ xấu dụ người dùng mở link callback chứa code của kẻ xấu, làm người dùng bị đăng nhập vào tài khoản của kẻ xấu. Verifier để ai chặn được code cũng không đổi được lấy token. Còn nonce để không ai lấy một `id_token` cũ ở lượt đăng nhập khác đem vào dùng lại.

> *"Sao bắt buộc email đã xác minh?"* — Dạ, vì em liên kết tài khoản theo email. Nếu chấp nhận email chưa xác minh, kẻ xấu tạo tài khoản Google ghi email của nạn nhân là chiếm được tài khoản CashCash của nạn nhân.

> *"Sao nhận diện bằng `sub` mà không bằng email?"* — Dạ, `sub` là id cố định của tài khoản Google, còn email thì người dùng có thể đổi.

### US-06 — Quên mật khẩu, đặt lại bằng mã OTP qua email

> Dạ, luồng này có ba bước, đều nằm trên trang [password-recovery-page.tsx](../frontend/src/features/auth/password-recovery-page.tsx).

**Bước 1 — 📂 Mở [password-reset.service.ts:85](../backend/src/features/auth/application/password-reset.service.ts#L85-L97), rồi [password-reset.service.ts:18](../backend/src/features/auth/application/password-reset.service.ts#L18-L42)**

> Người dùng nhập email, frontend gọi `POST /auth/forgot-password`. Server trả lời 202 ngay lập tức với cùng một câu, dù email có tồn tại hay không, rồi mới xử lý gửi mail ở phía sau. Lý do là nếu chờ gửi mail xong mới trả lời thì email có tài khoản sẽ phản hồi chậm hơn, đo thời gian là biết email nào đã đăng ký. Hàng chờ phía sau chỉ nhận tối đa 10 việc, đầy thì trả 503.
> Ở phía sau, nếu không có user, hoặc tài khoản không có mật khẩu vì tạo bằng Google, thì em bỏ qua. Còn có thì em sinh một mã OTP 6 số ngẫu nhiên, băm bằng scrypt rồi lưu, sau đó gửi mail. Gửi mail lỗi thì em xoá bản ghi đi.

**Bước 2 — 📂 Mở [password-reset.service.ts:43](../backend/src/features/auth/application/password-reset.service.ts#L43-L69)**

> Người dùng nhập mã OTP. Service lấy bản ghi mới nhất; nếu quá 10 phút hoặc đã nhập sai 5 lần thì từ chối. Nhập sai thì tăng số lần sai lên một. Nhập đúng thì database đổi mã OTP thành một token dài 64 ký tự và trả token đó về cho frontend, kèm header cấm lưu cache.

**Bước 3 — 📂 Mở [password-reset.service.ts:70](../backend/src/features/auth/application/password-reset.service.ts#L70-L83), rồi [refresh_tokens/migration.sql:116](../backend/db/migrations/20261017130000_refresh_tokens/migration.sql#L116-L136)**

> Người dùng nhập mật khẩu mới, frontend gửi lên cùng với token ở bước 2. Service kiểm token này đã qua bước OTP và chưa hết hạn. Hàm `cashcash_reset_consume` trong database đổi mật khẩu, xoá mọi yêu cầu đặt lại của user, và huỷ tất cả refresh token, tức là đăng xuất mọi thiết bị. Server xoá cookie, người dùng đăng nhập lại bằng mật khẩu mới.

> Nếu bị hỏi vì sao OTP cũng phải băm bằng scrypt: Dạ, OTP chỉ có một triệu khả năng, nếu lưu thô hay băm nhanh thì lộ database là dò ra ngay. Băm chậm cộng với giới hạn 5 lần sai, 10 phút và rate limit thì gần như không đoán được.

### US-07 — Đổi mật khẩu khi đang đăng nhập

**📂 Mở [users.service.ts:6](../frontend/src/services/users.service.ts#L6) (frontend)**

> Dạ, ở trang Cá nhân, người dùng nhập mật khẩu hiện tại và mật khẩu mới, frontend gọi `POST /users/me/password`.

**📂 Mở [user.routes.ts:10](../backend/src/features/users/presentation/user.routes.ts#L10)**

> Route này nằm sau `currentUser` nên bắt buộc đã đăng nhập. Rate limit ở đây tính theo user chứ không theo IP, mỗi user 10 lần. Vì kẻ đã trộm được access token có thể đổi IP liên tục để dò mật khẩu hiện tại; tính theo user thì đổi IP cũng vô ích.

**📂 Mở [user.service.ts:50](../backend/src/features/users/application/user.service.ts#L50-L70)**

> Service kiểm mật khẩu hiện tại có đúng không. Riêng tài khoản tạo bằng Google mà chưa có mật khẩu thì không cần, đây là trường hợp đặt mật khẩu lần đầu.

**📂 Mở [refresh_tokens/migration.sql:98](../backend/db/migrations/20261017130000_refresh_tokens/migration.sql#L98-L114), hàm `cashcash_change_password`**

> Database kiểm mật khẩu chưa bị đổi ở nơi khác trong lúc này, rồi cập nhật mật khẩu mới, huỷ tất cả refresh token và tạo một chuỗi token mới.

**📂 Mở [user.controller.ts:12](../backend/src/features/users/presentation/user.controller.ts#L12-L17)**

> Controller đặt cặp cookie mới cho thiết bị đang dùng, nên thiết bị này vẫn đăng nhập bình thường. Các thiết bị khác thì refresh token đã bị huỷ, nên khi access token của họ hết hạn là phải đăng nhập lại.

### US-09 — Phân quyền ADMIN

> Dạ, luồng này em nói từ database lên, vì quyền được quyết định ở dưới cùng.

**📂 Mở [user_role/migration.sql](../backend/db/migrations/20261017120000_user_role/migration.sql)**

> Bảng users có cột role, chỉ nhận hai giá trị USER hoặc ADMIN. Có trigger bảo vệ cột này: tạo user mới thì luôn bị ép về USER, còn ai sửa role bằng câu UPDATE bình thường thì database báo lỗi. Chỉ có hàm `cashcash_set_role` được phép đổi role.

**📂 Mở [promote-admins.ts](../backend/db/promote-admins.ts)**

> Cách duy nhất để nâng một người lên admin là chạy lệnh `npm run db:admins`. Script này đọc danh sách email trong biến môi trường `ADMIN_EMAILS` rồi gọi hàm đó. Không có API nào để tự nâng quyền.

> Khi đăng nhập hoặc refresh, em đọc role từ database và đưa vào access token.

**📂 Mở [admin.routes.ts:8](../backend/src/features/admin/presentation/admin.routes.ts#L8), rồi [require-role.ts:6](../backend/src/middlewares/require-role.ts#L6-L9)**

> Toàn bộ router admin được gắn `requireRole('ADMIN')`. Middleware này so role trong token, không phải admin thì trả 403.

**📂 Mở [auth.tsx:47](../frontend/src/features/auth/auth.tsx#L47-L51), `AdminGate`**

> Ở frontend có `AdminGate` để user thường không thấy trang admin. Nhưng đó chỉ là giao diện; ai gọi API trực tiếp bằng Postman thì vẫn bị backend chặn 403.

> Nếu bị hỏi hạ quyền bao lâu có hiệu lực: Dạ, tối đa 15 phút, tới lần refresh tiếp theo, vì lúc refresh database đọc role mới nhất rồi mới ký token mới.


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
| **Rate limit trong RAM** thay vì Redis | Không cần hạ tầng thêm | Restart là mất bộ đếm; nhiều instance không chia sẻ; phải tự giới hạn bộ nhớ | Tối đa 10.000 khoá, đầy thì bỏ khoá cũ nhất (không chặn mọi người, xem 6.6); mở rộng thì dùng Redis |
| **Đăng ký báo "Email đã được sử dụng"** | UX rõ ràng | Lộ được email nào đã đăng ký (login và forgot password thì không lộ) | Rate limit; muốn chặt hơn thì xác minh email trước khi tạo tài khoản |
| **Tự liên kết Google vào tài khoản trùng email** | Người đã đăng ký bằng mật khẩu bấm Google vẫn vào đúng tài khoản | Phụ thuộc Google đã xác minh email | Bắt buộc `email_verified === true` |
| **Kiểm role từ JWT** thay vì tra DB | Nhanh | Hạ quyền admin có độ trễ ≤ 15 phút | Route cực nhạy cảm có thể tra DB thêm |

---

## 6. Cách trình bày & trả lời

Phần này hướng dẫn **nói** chứ không chỉ biết. Giảng viên chấm "Individual Understanding" qua việc bạn có giải thích trôi chảy và chỉ được đúng chỗ trong code hay không. Đọc thuộc lòng nghe ra ngay, nên hãy nắm *khung* trả lời rồi nói bằng lời của mình.

### 6.1 Công thức trả lời 4 bước: **Kết luận → Cơ chế → Code → Giới hạn**

| Bước | Nói gì | Thời lượng |
|---|---|---|
| **1. Kết luận** | Trả lời thẳng câu hỏi trong **một câu**. Đừng mở đầu bằng "dạ thì là…" dài dòng. | 5 giây |
| **2. Cơ chế** | Giải thích *nó hoạt động thế nào*, theo thứ tự các bước. | 20–30 giây |
| **3. Code** | Mở đúng file, chỉ đúng dòng: "cụ thể là ở đây ạ". | 15–30 giây |
| **4. Giới hạn** *(nếu có)* | Nói cái giá phải trả hoặc điểm chưa làm. Đây là chỗ ăn điểm "hiểu sâu". | 10 giây |

**Ví dụ.** Câu hỏi: *"Sao em không lưu token trong localStorage?"*

> **(Kết luận)** Dạ, vì localStorage thì JavaScript đọc được, còn em để token trong cookie HttpOnly mà JavaScript không đọc được.
> **(Cơ chế)** Nếu trang bị lỗi XSS, kẻ tấn công chèn được mã JS thì với localStorage là lấy được token gửi đi ngay. Với cookie HttpOnly thì trình duyệt tự gửi kèm request nhưng mã JS không đọc ra được.
> **(Code)** Thầy/cô xem ở `auth.cookie.ts` dòng 9, `baseOptions` có `httpOnly: true`. Em mở DevTools gõ `document.cookie` thì sẽ không thấy `cc_access`.
> **(Giới hạn)** Cái giá là cookie tự gửi kèm nên phải chống CSRF. Em xử lý bằng SameSite=Lax, header `X-CashCash-Request` và kiểm Origin ở `app.ts` dòng 26.

Câu trả lời này dài khoảng 1 phút, có đủ lý do, bằng chứng trong code và hiểu biết về đánh đổi.

### 6.2 Bài giới thiệu module (nói trong khoảng 2 phút)

Thường giảng viên sẽ mở đầu bằng *"Em làm phần nào, giới thiệu đi"*. Chuẩn bị sẵn bài này, nói theo **4 ý**: *làm gì, kiến trúc, luồng chính, điểm bảo mật*.

> **(1. Làm gì)** Dạ, em phụ trách module xác thực và phân quyền. Module cho phép người dùng đăng ký, đăng nhập bằng email mật khẩu hoặc bằng Google, tự giữ phiên đăng nhập, quên mật khẩu qua OTP email, và phân quyền USER với ADMIN.
>
> **(2. Kiến trúc)** Backend em chia ba lớp. Lớp presentation gồm route, controller và cookie, chỉ lo phần HTTP. Lớp application là service chứa nghiệp vụ. Lớp infrastructure lo phần kỹ thuật như ký JWT, băm mật khẩu, gọi Google. Những thao tác cần nhiều bước trong database thì em viết thành hàm RPC trong Postgres để chạy trong một transaction.
>
> **(3. Luồng chính)** Khi đăng nhập thành công, server cấp hai token: access token là JWT sống 15 phút, và refresh token sống 7 ngày, cả hai để trong cookie HttpOnly. Mỗi request, middleware `currentUser` kiểm chữ ký JWT để biết user là ai mà không cần truy vấn database. Khi access token hết hạn, frontend tự gọi `/auth/refresh` để lấy cặp token mới rồi gửi lại request, người dùng không thấy gì.
>
> **(4. Bảo mật)** Một số điểm em chú ý: mật khẩu băm bằng scrypt; refresh token được xoay vòng, nếu một token cũ bị dùng lại thì em thu hồi cả chuỗi vì nghi bị trộm; chống CSRF bằng header tuỳ chỉnh và kiểm Origin; đăng nhập Google có đủ state, PKCE và nonce. Em có thể demo hoặc trace một luồng cụ thể ạ.

**Mẹo:** câu cuối "em có thể demo hoặc trace một luồng" là chủ động mời giảng viên vào phần bạn đã chuẩn bị kỹ nhất.

### 6.3 Cách trace code trực tiếp trên VS Code

Khi được yêu cầu *"trace cho tôi user story X"*, làm đúng thứ tự sau, **vừa mở file vừa nói**:

1. **Bắt đầu từ chỗ người dùng bấm** (frontend), không bắt đầu từ database.
   > "Dạ, người dùng bấm nút Đăng nhập ở trang này, `auth-page.tsx`, hàm `submit`."
2. **Theo lời gọi API sang backend.** Dùng `Ctrl+Shift+F` tìm đường dẫn API (vd. `'/login'`) để nhảy sang file route.
   > "Hàm này gọi `POST /auth/login`. Bên backend, route này khai báo ở `auth.routes.ts`, đi qua rate limit rồi vào `authController.login`."
3. **Đi xuống từng tầng bằng `F12` (Go to Definition) hoặc `Ctrl+Click`** vào tên hàm.
   > "Controller parse dữ liệu bằng Zod rồi gọi `authService.login`. Em nhấn vào đây…"
4. **Ở mỗi tầng nói đúng một câu "tầng này làm gì"**, không đọc từng dòng code.
5. **Kết thúc bằng kết quả trả về** (đi ngược lên):
   > "…RPC trả `true`, service ký JWT, controller đặt hai cookie và trả thông tin user. Frontend nhận user thì lưu vào cache và chuyển về trang chủ."

Phím tắt nên luyện trước: `Ctrl+P` (mở file theo tên), `Ctrl+Shift+F` (tìm trong cả project), `F12` / `Ctrl+Click` (nhảy tới định nghĩa), `Alt+←` (quay lại chỗ trước), `Ctrl+G` (nhảy tới dòng).

**Nên mở sẵn các tab theo thứ tự** trước khi vào phòng: `auth-page.tsx` → `http.ts` → `app.ts` → `auth.routes.ts` → `auth.controller.ts` → `auth.service.ts` → `jwt.ts` → `refresh_tokens/migration.sql`.

### 6.4 Văn mẫu cho các câu khó nhất

Đây là bản nói dài hơn cho bốn câu khó nhất (mục 7 có bản ngắn hơn của các câu này). Đọc vài lần rồi tự nói lại bằng lời của mình.

**"Refresh token xoay vòng là sao? Phát hiện bị trộm thế nào?"**
> Dạ, mỗi lần refresh thì token cũ bị huỷ và em cấp token mới. Tất cả token sinh ra từ một lần đăng nhập em gom vào cùng một `familyId`. Giả sử kẻ xấu trộm được token và dùng trước, thì token đó bị thay. Sau đó người dùng thật dùng lại token cũ, database thấy token này đã bị huỷ, tức là có hai người cùng cầm một token, nên em huỷ luôn cả family, cả hai bị đăng xuất. Người dùng thật chỉ cần đăng nhập lại, còn kẻ xấu mất quyền. Logic này nằm trong hàm `cashcash_refresh_rotate` ở file migration, dòng 53. Có một trường hợp đặc biệt là người dùng mở nhiều tab cùng refresh một lúc, em cho phép trong 10 giây thì trả trạng thái `stale` thay vì coi là bị trộm, để không đăng xuất oan.

**"Đăng nhập Google hoạt động thế nào?"**
> Dạ, em dùng OAuth 2.0 loại Authorization Code kết hợp OpenID Connect. Khi bấm nút, server tạo ba giá trị ngẫu nhiên là state, code verifier và nonce, lưu vào một cookie tạm, rồi chuyển người dùng sang Google. Đăng nhập xong, Google trả về một `code` kèm `state`. Server kiểm state khớp với cookie để chống CSRF, rồi dùng code cùng verifier để đổi lấy `id_token` từ Google. Em kiểm chữ ký `id_token` bằng public key của Google, kiểm nonce và kiểm email đã được Google xác minh. Sau đó nếu tài khoản Google này đã liên kết thì đăng nhập, nếu trùng email với tài khoản có sẵn thì liên kết vào, còn không thì tạo tài khoản mới.

**"Vì sao JWT mà không dùng session?"**
> Dạ, với JWT thì mỗi request server chỉ cần kiểm chữ ký là biết user là ai, không cần truy vấn database, nên nhanh và dễ mở rộng nhiều server. Nhược điểm là JWT không thu hồi ngay được, vì server không lưu nó. Em khắc phục bằng cách cho access token sống ngắn, 15 phút, còn phần cần thu hồi được thì để ở refresh token lưu trong database. Thực ra cách em làm là kết hợp cả hai: JWT cho mỗi request, còn refresh token giống session.

**"CSRF là gì, em chống thế nào?"**
> Dạ, CSRF là khi người dùng đang đăng nhập CashCash mà mở một trang độc hại, trang đó tự gửi request sang CashCash, và trình duyệt tự gắn cookie theo, nên server tưởng là người dùng gửi. Em chống bằng ba lớp. Một, cookie để `SameSite=Lax` nên request POST từ trang khác không mang cookie. Hai, mọi request thay đổi dữ liệu phải có header `X-CashCash-Request`, mà trang khác muốn gắn header tuỳ chỉnh thì trình duyệt phải hỏi CORS trước, và server chỉ cho phép origin của mình. Ba, server kiểm header `Origin`. Code nằm ở `app.ts` dòng 26 tới 34.

### 6.5 Khi bị hỏi điều mình không chắc

Không bịa. Giảng viên phát hiện bịa rất nhanh, và một câu bịa làm mất uy tín cả những câu đã trả lời đúng. Dùng các câu sau:

| Tình huống | Nói |
|---|---|
| Biết một phần | "Dạ, phần em chắc là …; còn phần … em chưa tìm hiểu kỹ, em đoán là … nhưng em cần kiểm lại." |
| Không biết | "Dạ phần này em chưa nắm, nhưng em sẽ tìm ở [file/tài liệu] ạ." Rồi thử mở file liên quan, tìm bằng `Ctrl+Shift+F`. |
| Bị chỉ ra lỗi/thiếu sót | "Dạ đúng, đây là giới hạn hiện tại. Nếu sửa thì em sẽ …" (lấy từ bảng trade-offs ở mục 5). **Đừng cãi.** |
| Câu hỏi mơ hồ | "Dạ thầy/cô hỏi về [cách hiểu A] hay [cách hiểu B] ạ?" Hỏi lại là bình thường, không bị trừ điểm. |
| Quên tên file | "Dạ, phần đó nằm ở lớp service, em tìm nhanh ạ" → `Ctrl+P` gõ `auth.service`. |

### 6.6 Câu hỏi về việc dùng AI

Vì có tiêu chí `AI_USAGE.md` và understanding gate, rất có thể bị hỏi: *"Phần này AI viết hay em viết?"* hoặc *"AI có viết sai chỗ nào không, em sửa thế nào?"*

Nguyên tắc: **nói thật là có dùng AI, rồi chứng minh mình hiểu bằng một lỗi cụ thể mình đã phát hiện, sửa và kiểm chứng.** Mọi chi tiết dưới đây đều có thật trong repo (code, test, `AI_USAGE.md` case #3), nên bị hỏi vặn tới đâu cũng mở ra cho xem được.

#### Câu chuyện chính: lỗi rate limit khoá đăng nhập của mọi người

**Bối cảnh (nhớ được để kể):**

| | |
|---|---|
| File | [rate-limit.ts](../backend/src/middlewares/rate-limit.ts) |
| Code cũ | `if (entry.count >= max \|\| attempts.size >= 10000) throw 429` |
| Ý định ban đầu | Giới hạn bảng đếm tối đa 10.000 khoá để không tràn RAM |
| Lỗi | Khi bảng đầy, **mọi** request đều bị 429, kể cả người chưa từng sai mật khẩu |
| Cách tấn công | Gửi request từ ~10.000 IP khác nhau (IPv6 hoặc botnet) → cả hệ thống không ai đăng nhập được trong 15 phút (DoS) |
| Cách sửa | Bảng đầy thì **xoá khoá cũ nhất** thay vì chặn tất cả. `Map` trong JS giữ thứ tự chèn nên khoá đầu tiên là khoá cũ nhất |
| Kiểm chứng | [rate-limit.test.ts](../backend/tests/middlewares/rate-limit.test.ts) giả lập 10.050 IP: code cũ thì test **fail**, code mới **pass**; 169 test backend pass |
| Đánh đổi | Kẻ có > 10.000 IP đẩy được bộ đếm cũ ra, nhưng người có nhiều IP như vậy vốn đã vượt được giới hạn theo IP. Muốn chặt hơn thì dùng Redis |

**Cách nói (khoảng 1 phút 30):**

> **(Thừa nhận)** Dạ, em có dùng Claude Code hỗ trợ viết module này, em ghi lại trong `AI_USAGE.md`. Em không dùng nguyên code AI viết mà đọc lại và test từng phần, và có ba chỗ AI viết sai em đã sửa. Em kể một chỗ ạ.
>
> **(Lỗi)** Ở middleware rate limit [mở `rate-limit.ts`], bộ đếm số lần thử nằm trong một `Map` trong RAM. Để không tràn bộ nhớ, code ban đầu có điều kiện: hễ `Map` đủ 10.000 khoá thì trả 429. Nhưng điều kiện đó không phân biệt ai gửi. Nghĩa là kẻ tấn công chỉ cần gửi request từ khoảng 10.000 IP khác nhau, với IPv6 thì rất dễ, là bảng đầy, và từ đó **tất cả** người dùng đều bị chặn đăng nhập 15 phút. Tính năng chống tấn công lại thành chỗ để tấn công từ chối dịch vụ.
>
> **(Phát hiện)** Em phát hiện khi rà lại code chuẩn bị vấn đáp. Em viết test giả lập 10.050 IP khác nhau rồi cho một người dùng bình thường đăng nhập [mở `rate-limit.test.ts`]: với code cũ người đó bị 429, test fail.
>
> **(Sửa)** Em bỏ điều kiện chặn chung. Khi bảng đầy mà khoá mới chưa có thì em xoá khoá cũ nhất. `Map` trong JavaScript giữ thứ tự chèn nên khoá đầu tiên chính là khoá cũ nhất, xoá rất nhanh. Bộ nhớ vẫn bị giới hạn 10.000 khoá, mà người dùng bình thường không bị chặn oan. Test mới pass và toàn bộ test backend vẫn pass.
>
> **(Đánh đổi)** Cái giá là ai có hơn 10.000 IP thì đẩy được bộ đếm cũ ra ngoài. Nhưng người có nhiều IP như vậy vốn đã lách được giới hạn theo IP rồi. Nếu triển khai thật nhiều server thì em sẽ chuyển bộ đếm sang Redis.

**Câu hỏi vặn có thể gặp:**

| Hỏi | Trả lời |
|---|---|
| "Sao không tăng lên 1 triệu khoá cho chắc?" | Vẫn là một ngưỡng, kẻ tấn công chỉ cần nhiều IP hơn; và 1 triệu khoá tốn RAM đáng kể. Vấn đề nằm ở *chặn tất cả*, không phải ở con số. |
| "Sao biết khoá đầu tiên trong Map là cũ nhất?" | `Map` duyệt theo thứ tự chèn. Khoá được chèn lần đầu khi bắt đầu cửa sổ 15 phút, cập nhật bằng `set` không đổi vị trí, nên khoá đầu là khoá có cửa sổ bắt đầu sớm nhất. |
| "Test làm sao chứng minh được?" | Test gọi middleware với 10.050 IP khác nhau rồi gọi thêm một IP mới, kiểm tra `next()` được gọi. Em đã chạy test này với code cũ để chắc nó fail, rồi mới sửa. |
| "Có lỗi nào khác AI viết sai không?" | Có, hai case trong `AI_USAGE.md`: nhiều request cùng refresh làm người dùng bị đăng xuất (sửa bằng single-flight + `REFRESH_STALE`), và nhập sai mật khẩu cũng kích hoạt refresh (sửa bằng danh sách `NO_REFRESH`). |

> ⚠️ Case #1 và #2 trong `AI_USAGE.md` còn ghi `[XÁC NHẬN]`/`[TODO]`. Chỉ kể những case bạn thật sự gặp; điền phần "Phát hiện bằng cách" đúng với những gì đã xảy ra.

### 6.7 Những lỗi nên tránh

| Đừng | Nên |
|---|---|
| Đọc từng dòng code thành tiếng | Mỗi tầng tóm tắt bằng một câu "tầng này làm gì" |
| Bắt đầu trace từ database | Bắt đầu từ chỗ người dùng bấm, đi xuống rồi đi ngược lên |
| Nói "cái này để bảo mật" chung chung | Nói rõ **chống tấn công gì**: "để chống XSS đọc token" |
| Dùng thuật ngữ mà không giải thích được | Chỉ dùng từ mình định nghĩa được (xem mục 9) |
| Trả lời dài trước khi vào ý chính | Câu đầu tiên phải là câu trả lời |
| Im lặng khi đang tìm file | Vừa tìm vừa nói: "em mở file service ạ…" |
| Nói "em không biết" rồi dừng | Nói phần mình biết, và cách mình sẽ tìm ra phần còn lại |

### 6.8 Luyện tập trước buổi chấm

1. **Tự nói thành tiếng** bài giới thiệu 2 phút (6.2), bấm giờ, nói 3 lần.
2. **Trace không nhìn tài liệu** US-02 (đăng nhập), US-03 (refresh), US-05 (Google). Mỗi luồng không quá 3 phút.
3. **Nhờ một bạn trong nhóm** chọn ngẫu nhiên 5 câu ở mục 7 để hỏi bạn; trả lời theo công thức 4 bước ở 6.1.
4. **Đổi vai:** bạn giải thích module của mình cho một bạn ở module khác. Nếu bạn đó hiểu, giảng viên sẽ hiểu.
5. Chuẩn bị sẵn **DevTools và các tab VS Code** như ở 6.3 và mục 8 để không mất thời gian lúc chấm.

---

## 7. Câu hỏi vấn đáp

Mỗi câu có hai phần:

- **🗣 Trả lời:** là câu nói liền mạch, xưng "em", đọc lên được ngay. Câu đầu tiên luôn là câu trả lời thẳng, sau đó mới giải thích.
- **📂 Mở cho giảng viên xem:** là file bạn mở ra trong lúc nói, hoặc sau khi nói xong.

Đừng học thuộc từng chữ. Đọc to vài lần cho quen ý, rồi tự nói lại bằng lời của mình.

### 7.1 Câu hỏi "trace code" (gần như chắc chắn bị hỏi)

#### Q1. Chỉ cho tôi từ lúc bấm "Đăng nhập" tới khi có cookie.

🗣 **Trả lời:**

> Dạ, em đi từ giao diện xuống database rồi quay lên ạ. Khi người dùng bấm Đăng nhập ở trang `auth-page.tsx`, em kiểm email và mật khẩu bằng Zod trước để báo lỗi ngay trên form, rồi gọi API đăng nhập. Request đi qua file `http.ts`, ở đó em gắn header chống CSRF và cho trình duyệt gửi kèm cookie.
>
> Sang backend, `app.ts` kiểm header và nguồn gửi để chống CSRF, rồi route đăng nhập kiểm rate limit, mỗi IP 20 lần trong 15 phút. Controller kiểm lại dữ liệu rồi gọi service. Service tìm user theo email, so mật khẩu bằng scrypt. Đúng thì em sinh refresh token, lưu mã băm của nó vào database, rồi ký access token.
>
> Quay lên controller, em đặt hai token vào hai cookie HttpOnly và trả thông tin user. Frontend lưu user vào cache rồi chuyển về trang chủ. Phần chi tiết từng file em đã chuẩn bị, thầy cô muốn em mở chỗ nào em mở chỗ đó ạ.

📂 **Mở cho giảng viên xem:** đi theo đúng thứ tự ở [mục 3, US-02](#us-02--đăng-nhập-bằng-mật-khẩu-luồng-quan-trọng-nhất-nên-luyện-kỹ).

#### Q2. Server biết request này của user nào bằng cách nào?

🗣 **Trả lời:**

> Dạ, server biết nhờ access token nằm trong cookie. Mọi route dưới `/api/v1`, trừ nhóm `/auth`, đều phải đi qua middleware `currentUser`. Middleware này đọc token trong cookie, kiểm chữ ký bằng khoá bí mật của server, đúng thì lấy id user trong token ra gán vào `req.userId`. Các service phía sau chỉ lấy dữ liệu theo id đó.
>
> Người dùng không thể tự khai mình là ai, vì em không bao giờ lấy userId từ body hay từ URL. Muốn giả làm người khác thì phải sửa token, mà sửa token thì chữ ký sai, server từ chối ngay.

📂 **Mở cho giảng viên xem:** [app.ts:36](../backend/src/app.ts#L36), [current-user.ts:7-13](../backend/src/middlewares/current-user.ts#L7-L13), [jwt.ts:25](../backend/src/features/auth/infrastructure/jwt.ts#L25-L38)

#### Q3. Access token hết hạn thì chuyện gì xảy ra, code ở đâu?

🗣 **Trả lời:**

> Dạ, người dùng không thấy gì cả, frontend tự làm mới token. Cụ thể là khi token hết hạn, server trả lỗi 401. File `http.ts` bắt được lỗi đó và tự gọi API refresh; trình duyệt tự gửi kèm refresh token trong cookie.
>
> Ở backend, hàm trong database huỷ refresh token cũ, cấp token mới, rồi server đặt lại cookie. Frontend nhận được thì gửi lại request lúc nãy đúng một lần, nên người dùng vẫn thấy dữ liệu bình thường. Còn nếu refresh cũng thất bại, ví dụ đã quá 7 ngày, thì frontend xoá dữ liệu và đưa người dùng về trang đăng nhập.

📂 **Mở cho giảng viên xem:** [http.ts:82-86](../frontend/src/lib/http.ts#L82-L86), [http.ts:33-53](../frontend/src/lib/http.ts#L33-L53), [auth.controller.ts:51](../backend/src/features/auth/presentation/auth.controller.ts#L51-L62), [refresh_tokens/migration.sql:53](../backend/db/migrations/20261017130000_refresh_tokens/migration.sql#L53-L81)

#### Q4. Route nào cần đăng nhập, route nào không? Cấu hình ở đâu?

🗣 **Trả lời:**

> Dạ, em cấu hình ở hai dòng này trong `app.ts`. Nhóm `/api/v1/auth` được gắn trước và không có middleware kiểm đăng nhập, vì đăng nhập, đăng ký hay quên mật khẩu thì người dùng chưa có token. Còn tất cả route khác dưới `/api/v1` đều phải qua `currentUser`.
>
> Cách làm này có lợi là sau này ai thêm route mới vào thì route đó tự động được bảo vệ, không sợ quên gắn kiểm tra.

📂 **Mở cho giảng viên xem:** [app.ts:35-36](../backend/src/app.ts#L35-L36)

#### Q5. Làm sao chặn user thường vào trang admin?

🗣 **Trả lời:**

> Dạ, em chặn ở hai chỗ, nhưng chỉ chỗ ở backend mới là bảo mật thật. Ở frontend có `AdminGate`, user thường vào trang admin thì bị chuyển về trang chủ, cái này chỉ để giao diện gọn gàng. Ở backend, toàn bộ router admin được gắn middleware `requireRole('ADMIN')`, nó so role trong token, không phải admin thì trả lỗi 403.
>
> Nên kể cả ai đó bỏ qua giao diện, gọi API thẳng bằng Postman thì vẫn bị chặn. Em có thể demo luôn: đăng nhập bằng user thường rồi gọi API admin sẽ thấy 403.

📂 **Mở cho giảng viên xem:** [auth.tsx:47-51](../frontend/src/features/auth/auth.tsx#L47-L51), [admin.routes.ts:8](../backend/src/features/admin/presentation/admin.routes.ts#L8), [require-role.ts:6-9](../backend/src/middlewares/require-role.ts#L6-L9)

#### Q6. Mật khẩu được lưu thế nào? Chỉ cho tôi.

🗣 **Trả lời:**

> Dạ, em không lưu mật khẩu, em chỉ lưu kết quả băm bằng scrypt. Khi đăng ký, hàm `hashPassword` sinh một chuỗi ngẫu nhiên gọi là salt, trộn với mật khẩu rồi băm, và lưu cả salt lẫn kết quả vào cột `passwordHash`. Salt giúp hai người đặt cùng một mật khẩu vẫn ra hai kết quả khác nhau, nên kẻ tấn công không dùng bảng tra có sẵn được.
>
> Khi đăng nhập, em băm lại mật khẩu người dùng nhập với đúng salt đó rồi so với kết quả đã lưu. Phép so dùng `timingSafeEqual`, tức là so mất thời gian như nhau dù sai ở chỗ nào, để không lộ thông tin qua thời gian. Mật khẩu cũng không bao giờ được trả ra ngoài, API chỉ trả một cờ cho biết tài khoản có mật khẩu hay không.

📂 **Mở cho giảng viên xem:** [password.ts:10-19](../backend/src/features/auth/infrastructure/password.ts#L10-L19), [auth.service.ts:16-18](../backend/src/features/auth/application/auth.service.ts#L16-L18)

### 7.2 Câu hỏi "vì sao"

#### Q7. Vì sao không lưu JWT trong localStorage cho đơn giản?

🗣 **Trả lời:**

> Dạ, vì localStorage thì JavaScript đọc được, còn cookie HttpOnly thì không. Nếu trang web bị lỗi XSS, tức là kẻ tấn công chèn được mã JavaScript vào trang, thì với localStorage họ chỉ cần một dòng code là lấy được token gửi đi. Với cookie HttpOnly, trình duyệt vẫn tự gửi cookie theo mỗi request, nhưng mã JavaScript không đọc ra được.
>
> Cái giá là cookie tự gửi kèm thì phải chống CSRF. Em chống bằng ba lớp: cookie đặt SameSite là Lax, bắt buộc có header riêng của CashCash, và kiểm nguồn gửi request. Em demo được: mở Console gõ `document.cookie` sẽ không thấy cookie token.

📂 **Mở cho giảng viên xem:** [auth.cookie.ts:9](../backend/src/features/auth/presentation/auth.cookie.ts#L9), [app.ts:26-34](../backend/src/app.ts#L26-L34)

#### Q8. Vì sao cần hai token, một token sống 7 ngày không được à?

🗣 **Trả lời:**

> Dạ, không được, vì JWT đã cấp thì không thu hồi được. Nếu một JWT sống 7 ngày bị lộ thì kẻ xấu dùng được trọn 7 ngày, kể cả khi người dùng đã đăng xuất.
>
> Nên em tách làm hai. Access token sống 15 phút, đi kèm mọi request; lỡ lộ thì thiệt hại tối đa 15 phút. Refresh token sống 7 ngày, nhưng em lưu nó trong database nên huỷ được bất cứ lúc nào, và nó chỉ được gửi tới các route đăng nhập nên ít khi bị lộ. Nhờ vậy người dùng giữ được phiên 7 ngày mà vẫn an toàn.

📂 **Mở cho giảng viên xem:** [env.ts:22](../backend/src/config/env.ts#L22) (thời hạn access token), [refresh-token.ts:3](../backend/src/features/auth/infrastructure/refresh-token.ts#L3) (thời hạn refresh token)

#### Q9. JWT có mã hoá dữ liệu không?

🗣 **Trả lời:**

> Dạ không, JWT chỉ ký chứ không mã hoá. Phần nội dung của token chỉ được chuyển sang dạng base64, ai có token cũng giải ra đọc được. Chữ ký chỉ đảm bảo là không ai sửa được nội dung mà không bị phát hiện.
>
> Vì vậy em chỉ để hai thông tin trong token là id user và role, không để email hay thông tin nhạy cảm nào khác. Em demo được bằng cách dán token vào trang jwt.io là đọc được ngay.

📂 **Mở cho giảng viên xem:** [jwt.ts:13-22](../backend/src/features/auth/infrastructure/jwt.ts#L13-L22)

#### Q10. Vì sao `verifyAccessToken` cố định chỉ nhận thuật toán HS256?

🗣 **Trả lời:**

> Dạ, để chống kiểu tấn công đổi thuật toán. Phần header của JWT ghi thuật toán ký, mà header này do phía người dùng gửi lên nên họ sửa được. Kiểu nổi tiếng nhất là sửa thành `none`, nghĩa là không cần chữ ký; thư viện nào tin vào header sẽ chấp nhận luôn token giả.
>
> Em cố định chỉ nhận HS256, nên thuật toán nào khác đều bị từ chối. Em có viết riêng một test cho trường hợp `none` này.

📂 **Mở cho giảng viên xem:** [jwt.ts:28-31](../backend/src/features/auth/infrastructure/jwt.ts#L28-L31), [jwt.test.ts](../backend/tests/features/auth/application/jwt.test.ts)

#### Q11. Vì sao refresh token chỉ băm SHA-256 mà mật khẩu phải dùng scrypt?

🗣 **Trả lời:**

> Dạ, vì hai thứ này khó đoán khác nhau. Mật khẩu là do người đặt nên thường dễ đoán; kẻ có được mã băm có thể thử cả tỷ mật khẩu phổ biến. Vì vậy mật khẩu cần một hàm băm chậm như scrypt, để mỗi lần thử đều tốn thời gian và bộ nhớ.
>
> Còn refresh token là chuỗi ngẫu nhiên 256 bit do máy sinh ra, số khả năng lớn tới mức thử hết là không thể, dù hàm băm có nhanh. Mà băm nhanh còn có lợi, vì mỗi lần refresh em phải tìm token trong database theo mã băm của nó.

📂 **Mở cho giảng viên xem:** [password.ts:4](../backend/src/features/auth/infrastructure/password.ts#L4), [refresh-token.ts:4-11](../backend/src/features/auth/infrastructure/refresh-token.ts#L4-L11)

#### Q12. Vì sao database không lưu refresh token thật?

🗣 **Trả lời:**

> Dạ, để nếu database bị lộ thì token cũng không dùng được. Database chỉ chứa mã băm của token. Khi người dùng gửi token lên, server tự băm rồi mới so. Kẻ xấu có mã băm thì cũng không gửi lên thay token được. Đây cũng là nguyên tắc giống như không lưu mật khẩu thật.

📂 **Mở cho giảng viên xem:** [refresh-token.ts:7-11](../backend/src/features/auth/infrastructure/refresh-token.ts#L7-L11), [auth.service.ts:81](../backend/src/features/auth/application/auth.service.ts#L81)

#### Q13. Vì sao sai email và sai mật khẩu báo cùng một lỗi?

🗣 **Trả lời:**

> Dạ, để chống dò tài khoản. Nếu em báo "email không tồn tại" thì kẻ xấu biết được email nào đã đăng ký để tấn công tiếp.
>
> Em không chỉ báo cùng một câu mà còn làm cho thời gian trả lời như nhau. Hàm kiểm mật khẩu luôn chạy scrypt, kể cả khi không tìm thấy user, nên người ngoài không đo được độ trễ để đoán.
>
> Có một chỗ em chấp nhận lộ là trang đăng ký báo "email đã được sử dụng", vì nếu không báo thì người dùng không hiểu vì sao đăng ký không được. Đó là đánh đổi em đã ghi lại.

📂 **Mở cho giảng viên xem:** [auth.service.ts:49-50](../backend/src/features/auth/application/auth.service.ts#L49-L50), [password.ts:16](../backend/src/features/auth/infrastructure/password.ts#L16)

#### Q14. Header `X-CashCash-Request: 1` để làm gì?

🗣 **Trả lời:**

> Dạ, để chống CSRF. Một trang web độc hại muốn gửi request sang CashCash thì có hai cách. Cách thứ nhất là dùng form HTML, nhưng form thì không tự thêm header riêng được. Cách thứ hai là dùng fetch, nhưng fetch sang trang khác mà có header riêng thì trình duyệt bắt buộc phải hỏi server trước xem có cho phép không, và server của em chỉ cho phép chính trang CashCash. Nên request của trang độc hại không bao giờ được gửi đi.
>
> Ngoài header này, server còn kiểm nguồn gửi request, và cookie đặt SameSite là Lax. Em có test: gọi API refresh mà thiếu header thì bị 403.

📂 **Mở cho giảng viên xem:** [app.ts:26-34](../backend/src/app.ts#L26-L34), [http.ts:64](../frontend/src/lib/http.ts#L64)

#### Q15. Vì sao cookie refresh chỉ có hiệu lực ở đường dẫn `/api/v1/auth`?

🗣 **Trả lời:**

> Dạ, để refresh token chỉ được gửi tới các route đăng nhập. Nếu để cho mọi đường dẫn thì token sống 7 ngày này sẽ đi kèm hàng trăm request khác, mỗi lần là thêm một cơ hội bị lộ qua log hay proxy. Giới hạn lại thì nó chỉ xuất hiện khi refresh hoặc đăng xuất.

📂 **Mở cho giảng viên xem:** [auth.cookie.ts:12](../backend/src/features/auth/presentation/auth.cookie.ts#L12)

#### Q16. Vì sao viết hàm trong Postgres thay vì viết query ở Node?

🗣 **Trả lời:**

> Dạ, vì em cần các bước chạy cùng nhau như một khối, và cần khoá dữ liệu khi đang xử lý. Ví dụ làm mới token gồm bốn bước: đọc token, kiểm trạng thái, tạo token mới, huỷ token cũ. Nếu tách thành nhiều câu query từ Node, hai request gửi cùng lúc có thể cùng đọc thấy token còn hợp lệ và cùng được cấp token mới.
>
> Trong hàm Postgres, em khoá dòng token lại bằng `FOR UPDATE`, request thứ hai phải chờ request đầu xong. Cả hàm chạy trong một transaction, lỗi giữa chừng thì huỷ hết. Thư viện Supabase phía Node không hỗ trợ transaction nhiều câu lệnh nên viết hàm trong database là cách hợp lý. Cái giá là logic nằm trong SQL nên khó đọc hơn TypeScript.

📂 **Mở cho giảng viên xem:** [refresh_tokens/migration.sql:53-81](../backend/db/migrations/20261017130000_refresh_tokens/migration.sql#L53-L81), dòng 60 có `FOR UPDATE`

#### Q17. Vì sao Zod schema để ở `packages/shared`?

🗣 **Trả lời:**

> Dạ, để frontend và backend dùng chung một quy tắc kiểm dữ liệu. Frontend dùng để báo lỗi ngay trên form, ví dụ mật khẩu dưới 8 ký tự. Backend dùng lại đúng schema đó để kiểm thật. Chỉ có một chỗ định nghĩa nên hai bên không bao giờ lệch nhau.
>
> Nhưng kiểm ở frontend chỉ để người dùng thấy lỗi nhanh, ai cũng bỏ qua được bằng Postman, nên backend luôn kiểm lại.

📂 **Mở cho giảng viên xem:** [auth.schema.ts](../packages/shared/src/schemas/auth.schema.ts), [auth-page.tsx:41](../frontend/src/features/auth/auth-page.tsx#L41), [validation.ts:5](../backend/src/lib/validation.ts#L5)

### 7.3 Câu hỏi "nếu … thì sao"

#### Q18. Nếu kẻ xấu trộm được refresh token và dùng nó?

🗣 **Trả lời:**

> Dạ, thì cả chuỗi token của lần đăng nhập đó sẽ bị huỷ. Mỗi lần refresh, token cũ bị đánh dấu là đã thay. Giả sử kẻ xấu dùng trước, họ nhận được token mới. Sau đó người dùng thật dùng token cũ, database thấy token này đã bị thay mà vẫn có người gửi lên, nghĩa là có hai người cùng cầm một token. Lúc đó em huỷ toàn bộ chuỗi token. Cả hai đều bị đăng xuất; người dùng thật chỉ cần đăng nhập lại, còn kẻ xấu mất quyền.
>
> Ngược lại nếu người dùng thật dùng trước thì kẻ xấu là người gửi token cũ, kết quả cũng y như vậy.

📂 **Mở cho giảng viên xem:** [refresh_tokens/migration.sql:62-69](../backend/db/migrations/20261017130000_refresh_tokens/migration.sql#L62-L69)

#### Q19. Nếu mở 3 tab, access token cùng hết hạn, 3 tab cùng refresh?

🗣 **Trả lời:**

> Dạ, em xử lý ở hai mức. Trong cùng một tab, nhiều request cùng bị 401 thì em chỉ gọi refresh một lần, các request khác chờ chung kết quả.
>
> Giữa các tab thì tab đầu tiên refresh thành công. Tab sau gửi lên token vừa bị thay; nếu việc thay đó mới xảy ra chưa tới 10 giây thì database hiểu là tab khác vừa refresh, không coi là bị trộm. Server trả mã `REFRESH_STALE` và không xoá cookie, vì cookie mới của tab đầu đã có trong trình duyệt. Frontend coi như đã refresh xong và gửi lại request.
>
> Nếu không có cơ chế này thì người dùng mở nhiều tab sẽ bị đăng xuất oan. Đây cũng là một lỗi mà code AI viết ban đầu bị sai và em đã sửa.

📂 **Mở cho giảng viên xem:** [http.ts:33-53](../frontend/src/lib/http.ts#L33-L53), [refresh_tokens/migration.sql:63-65](../backend/db/migrations/20261017130000_refresh_tokens/migration.sql#L63-L65), [auth.controller.ts:58-59](../backend/src/features/auth/presentation/auth.controller.ts#L58-L59)

#### Q20. Admin bị hạ xuống USER, bao lâu thì mất quyền?

🗣 **Trả lời:**

> Dạ, tối đa 15 phút. Role nằm trong access token, mà token đã cấp thì không thu hồi được. Khi token hết hạn và được làm mới, hàm trong database đọc role mới nhất từ bảng users rồi mới ký token mới, lúc đó người đó chỉ còn là USER.
>
> Đây là đánh đổi của việc kiểm role từ token cho nhanh. Nếu cần mất quyền ngay lập tức thì với những route cực kỳ nhạy cảm em có thể tra role trong database ở mỗi request.

📂 **Mở cho giảng viên xem:** [refresh_tokens/migration.sql:73](../backend/db/migrations/20261017130000_refresh_tokens/migration.sql#L73), [auth.service.ts:87](../backend/src/features/auth/application/auth.service.ts#L87)

#### Q21. Người dùng gửi thêm `"role": "ADMIN"` khi đăng ký thì sao?

🗣 **Trả lời:**

> Dạ, không có tác dụng gì, vì bị chặn ở ba lớp. Lớp thứ nhất, schema đăng ký không có trường role nên Zod tự bỏ trường lạ đi. Lớp thứ hai, service không truyền role xuống database, và hàm đăng ký trong database ghi cứng role là USER. Lớp thứ ba, bảng users có trigger: tạo mới thì luôn ép về USER, còn sửa role bằng câu lệnh thường thì báo lỗi.
>
> Nên kể cả sau này có ai lỡ viết code đưa nguyên dữ liệu người dùng gửi vào database thì vẫn an toàn.

📂 **Mở cho giảng viên xem:** [auth.schema.ts:7](../packages/shared/src/schemas/auth.schema.ts#L7), [refresh_tokens/migration.sql:24-25](../backend/db/migrations/20261017130000_refresh_tokens/migration.sql#L24-L25), [user_role/migration.sql:6-25](../backend/db/migrations/20261017120000_user_role/migration.sql#L6-L25)

#### Q22. Sửa nội dung JWT đổi role thành ADMIN thì sao?

🗣 **Trả lời:**

> Dạ, bị trả lỗi 401. Chữ ký được tính từ nội dung token và khoá bí mật của server. Sửa nội dung mà không có khoá bí mật thì không tính lại được chữ ký đúng, nên lúc kiểm, server thấy chữ ký không khớp và từ chối. Em có test riêng cho trường hợp token bị sửa nội dung.

📂 **Mở cho giảng viên xem:** [jwt.ts:25-38](../backend/src/features/auth/infrastructure/jwt.ts#L25-L38), [jwt.test.ts](../backend/tests/features/auth/application/jwt.test.ts)

#### Q23. `JWT_SECRET` bị lộ thì sao? Xử lý thế nào?

🗣 **Trả lời:**

> Dạ, đây là trường hợp nghiêm trọng nhất, vì có khoá bí mật thì ký được token cho bất kỳ ai, kể cả admin. Cách xử lý là đổi khoá bí mật ngay và khởi động lại server. Mọi access token cũ lập tức hết hiệu lực. Nhưng người dùng không bị đăng xuất, vì refresh token nằm trong database, không phụ thuộc khoá này, nên trình duyệt tự refresh lấy token mới. Sau đó em kiểm tra log xem có truy cập lạ không.
>
> Để phòng ngừa thì file `.env` nằm trong `.gitignore`, và em đã kiểm lịch sử Git là file này chưa từng bị commit. Nếu khoá đã từng lên Git thì xoá file đi là không đủ, bắt buộc phải đổi khoá.

📂 **Mở cho giảng viên xem:** [env.ts:19](../backend/src/config/env.ts#L19), [.gitignore](../.gitignore)

#### Q24. Người dùng đổi mật khẩu thì các thiết bị khác thế nào?

🗣 **Trả lời:**

> Dạ, các thiết bị khác bị đăng xuất, còn thiết bị đang đổi thì không. Khi đổi mật khẩu, database huỷ tất cả refresh token của user rồi tạo một chuỗi mới, và server đặt cookie mới cho thiết bị đang dùng. Thiết bị khác vẫn dùng được access token còn lại, tối đa 15 phút, sau đó refresh thất bại và phải đăng nhập lại.
>
> Em làm vậy vì người ta đổi mật khẩu thường là do nghi bị lộ, nên phải đá các phiên khác ra.

📂 **Mở cho giảng viên xem:** [user.controller.ts:12-17](../backend/src/features/users/presentation/user.controller.ts#L12-L17), [user.service.ts:50-70](../backend/src/features/users/application/user.service.ts#L50-L70), [refresh_tokens/migration.sql:98-114](../backend/db/migrations/20261017130000_refresh_tokens/migration.sql#L98-L114)

#### Q25. Đăng nhập Google bằng email trùng với tài khoản đã đăng ký bằng mật khẩu?

🗣 **Trả lời:**

> Dạ, thì tài khoản Google được liên kết vào tài khoản cũ. Database không thấy tài khoản Google này đã liên kết với ai, nhưng thấy có user cùng email, nên thêm một dòng liên kết trỏ tới user đó. Từ đó người dùng đăng nhập được bằng cả hai cách, dữ liệu vẫn là một.
>
> Làm vậy an toàn được là nhờ em bắt buộc email phải được Google xác minh. Nếu không, kẻ xấu tạo một tài khoản Google ghi email của nạn nhân là chiếm được tài khoản.

📂 **Mở cho giảng viên xem:** [oauth_accounts/migration.sql:36-48](../backend/db/migrations/20261017140000_oauth_accounts/migration.sql#L36-L48), [google.ts:75](../backend/src/features/auth/infrastructure/google.ts#L75)

#### Q26. Tài khoản tạo bằng Google muốn đăng nhập bằng mật khẩu?

🗣 **Trả lời:**

> Dạ, người dùng vào trang Cá nhân để đặt mật khẩu lần đầu. Tài khoản tạo bằng Google thì chưa có mật khẩu, nên khi đặt mật khẩu, service không đòi nhập mật khẩu cũ.
>
> Có một điểm em cố ý làm: luồng quên mật khẩu bỏ qua tài khoản chưa có mật khẩu, để không ai dùng đường quên mật khẩu chiếm tài khoản Google của người khác.

📂 **Mở cho giảng viên xem:** [user.service.ts:54-60](../backend/src/features/users/application/user.service.ts#L54-L60), [password-reset.service.ts:24](../backend/src/features/auth/application/password-reset.service.ts#L24)

#### Q27. Đoán thử mã OTP 6 số được không?

🗣 **Trả lời:**

> Dạ, gần như không thể. OTP có một triệu khả năng. Mỗi mã chỉ được nhập sai 5 lần, chỉ sống 10 phút, và route còn bị giới hạn 20 request trong 15 phút cho mỗi IP. Xác suất đoán trúng trong 5 lần chỉ là 5 phần triệu. Ngoài ra OTP trong database được băm bằng scrypt, nên lộ database cũng không dò ngược ra mã được.

📂 **Mở cho giảng viên xem:** [password-reset.service.ts:53-60](../backend/src/features/auth/application/password-reset.service.ts#L53-L60), [auth.routes.ts:6](../backend/src/features/auth/presentation/auth.routes.ts#L6)

#### Q28. Server khởi động lại thì người dùng có bị đăng xuất không?

🗣 **Trả lời:**

> Dạ không. Access token được kiểm bằng khoá bí mật nằm trong biến môi trường, không lưu trong bộ nhớ server. Refresh token thì nằm trong database. Thứ duy nhất bị mất là bộ đếm rate limit vì nó nằm trong RAM; đó là hạn chế em đã ghi trong phần đánh đổi.

📂 **Mở cho giảng viên xem:** [jwt.ts:8](../backend/src/features/auth/infrastructure/jwt.ts#L8), [rate-limit.ts:4](../backend/src/middlewares/rate-limit.ts#L4)

### 7.4 Câu hỏi lý thuyết hay gặp

#### Q29. Authentication khác Authorization thế nào?

🗣 **Trả lời:**

> Dạ, authentication là xác định "bạn là ai", còn authorization là xác định "bạn được làm gì". Trong code của em, authentication là phần đăng nhập và middleware `currentUser` xác định id người dùng. Authorization là middleware `requireRole` kiểm quyền admin, và việc service chỉ trả dữ liệu thuộc về chính người đó.

📂 **Mở cho giảng viên xem:** [current-user.ts](../backend/src/middlewares/current-user.ts), [require-role.ts](../backend/src/middlewares/require-role.ts)

#### Q30. OAuth 2.0 khác OpenID Connect thế nào?

🗣 **Trả lời:**

> Dạ, OAuth 2.0 dùng để ủy quyền, tức là cho ứng dụng một token để gọi API của bên khác thay người dùng, ví dụ đọc file trên Google Drive. OpenID Connect là một lớp xây trên OAuth 2.0 để xác thực: nó trả thêm một `id_token` cho biết người dùng là ai.
>
> CashCash chỉ cần biết người dùng là ai, nên em chỉ dùng `id_token`, không giữ token gọi API của Google.

📂 **Mở cho giảng viên xem:** [google.ts:32](../backend/src/features/auth/infrastructure/google.ts#L32) (xin quyền `openid email profile`), [google.ts:40-54](../backend/src/features/auth/infrastructure/google.ts#L40-L54)

#### Q31. Không có khoá bí mật của Google, sao em kiểm được chữ ký `id_token`?

🗣 **Trả lời:**

> Dạ, vì Google ký bằng RS256, là kiểu ký dùng một cặp khoá. Google giữ khoá riêng để ký, còn khoá công khai thì Google đăng ở một địa chỉ công khai. Em tải khoá công khai đó về để kiểm chữ ký, thư viện `jose` tự tải và lưu lại.
>
> Còn token của CashCash thì khác, em dùng HS256, chỉ có một khoá bí mật vừa để ký vừa để kiểm.

📂 **Mở cho giảng viên xem:** [google.ts:10](../backend/src/features/auth/infrastructure/google.ts#L10), [google.ts:66-69](../backend/src/features/auth/infrastructure/google.ts#L66-L69)

#### Q32. Hạn chế lớn nhất của module này là gì, em sẽ cải thiện thế nào?

🗣 **Trả lời:**

> Dạ, em thấy có bốn hạn chế. Thứ nhất, access token không thu hồi ngay được, phải chờ tối đa 15 phút; muốn khắc phục thì thêm danh sách token bị chặn lưu trong Redis. Thứ hai, rate limit nằm trong RAM, chạy nhiều server thì các server không dùng chung bộ đếm được, cũng nên chuyển sang Redis. Thứ ba, em chưa xác minh email khi đăng ký và chưa có xác thực hai lớp; em có thể dùng lại cơ chế OTP của phần quên mật khẩu. Thứ tư, chưa có trang quản lý thiết bị đang đăng nhập; nhưng bảng refresh token đã có mã chuỗi cho từng lần đăng nhập, nên chỉ cần liệt kê ra và cho đăng xuất từng thiết bị.

📂 **Mở cho giảng viên xem:** [mục 5, bảng trade-offs](#5-trade-offs-đánh-đổi-thiết-kế)

#### Q33. Em có phát hiện và sửa lỗi nào trong module không?

🗣 **Trả lời:**

> Dạ có, em kể lỗi rate limit làm khoá đăng nhập của tất cả mọi người khi bộ đếm bị đầy. Cách kể đầy đủ em để ở [mục 6.6](#66-câu-hỏi-về-việc-dùng-ai).

📂 **Mở cho giảng viên xem:** [rate-limit.ts](../backend/src/middlewares/rate-limit.ts), [rate-limit.test.ts](../backend/tests/middlewares/rate-limit.test.ts), [AI_USAGE.md](../AI_USAGE.md) case #3


---

## 8. Kiểm thử & checklist demo

### Test tự động

```bash
npx vitest run backend/tests/features/auth backend/tests/middlewares backend/tests/features/users backend/tests/features/admin frontend/tests/features/auth frontend/tests/features/admin
```
Kết quả lần chạy gần nhất (2026-10-20): **14 file, 72 test, tất cả pass**. Toàn bộ backend: 19 file, 169 test pass.

| File test | Kiểm gì |
|---|---|
| [jwt.test.ts](../backend/tests/features/auth/application/jwt.test.ts) | Ký/kiểm JWT; từ chối token hết hạn, sai secret, payload bị sửa, `alg: none`, sai iss/aud |
| [password.test.ts](../backend/tests/features/auth/application/password.test.ts) | Hash và verify scrypt |
| [auth.refresh.test.ts](../backend/tests/features/auth/application/auth.refresh.test.ts) | Rotation, chuỗi rotate liên tiếp, tab song song (`stale`), token sai định dạng, bắt buộc header CSRF, logout thu hồi family |
| [auth.google.test.ts](../backend/tests/features/auth/application/auth.google.test.ts) | Redirect có state/nonce/PKCE; callback sai state, thiếu cookie, thiếu code, người dùng huỷ, email chưa xác minh; đăng nhập thành công |
| [password-reset.service.test.ts](../backend/tests/features/auth/application/password-reset.service.test.ts) | Không gửi cho email lạ hoặc tài khoản không mật khẩu; SMTP lỗi thì xoá token; chặn gửi lặp trong 1 phút |
| [current-user.test.ts](../backend/tests/middlewares/current-user.test.ts) | Middleware 401 / gán userId |
| [rate-limit.test.ts](../backend/tests/middlewares/rate-limit.test.ts) | Chặn một IP sau `max` lần mà IP khác vẫn qua; 10.050 IP lạ không khoá được người dùng bình thường (lỗi đã sửa, xem 6.6) |
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

## 9. Thuật ngữ

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
