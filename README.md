# Ôn phản biện CashCash

> Tài liệu ôn tập cho buổi phản biện. Mỗi phần có: kiến thức nền → code thật trong dự án → câu nên nói khi bị hỏi.
> **Phần trọng tâm của mình: Phần 6 (Auth, OTP, bảo mật).** Phần này phải nói được không cần nhìn tài liệu.

---

## Kế hoạch 10 ngày

| Ngày | Việc | Kiểm tra cuối ngày |
|---|---|---|
| 1 | Phần 0, 1: nói được app là gì, sơ đồ kiến trúc | Vẽ lại sơ đồ ra giấy không nhìn |
| 2 | Phần 2: một request đi như thế nào | Kể lại luồng "thêm giao dịch" từ click tới DB và ngược lại |
| 3 | Phần 3, 4: frontend, backend | Mở code, chỉ ra được middleware, route, controller, service |
| 4 | Phần 5: database | Kể các bảng và quan hệ, giải thích migration, RPC |
| 5 | Phần 6.1–6.4: mật khẩu, session, đăng nhập/đăng ký | Giải thích scrypt, salt, vì sao lưu hash của token |
| 6 | Phần 6.5: luồng OTP quên mật khẩu | Vẽ lại 3 bước OTP, nói được từng lớp bảo vệ |
| 7 | Phần 6.6–6.8: CSRF, XSS, CORS, rate limit, điểm yếu | Trả lời được mọi câu trong 9.2 |
| 8 | Phần 7, 8: UX/UI, test | Chạy app, demo luồng chính + luồng quên mật khẩu |
| 9 | Phần 9: tự hỏi tự trả lời toàn bộ câu hỏi | Nhờ bạn hỏi ngẫu nhiên |
| 10 | Tập demo + trình bày thử có bấm giờ, nghỉ sớm | Demo chạy trơn, có phương án dự phòng |

---

## Phần 0. Tóm tắt 1 phút

**Câu mẫu:**

> CashCash là web app quản lý thu chi cá nhân. Người dùng ghi chi tiêu, thu nhập, chuyển tiền giữa các ví, theo dõi sổ nợ (ai nợ mình, mình nợ ai), xem báo cáo. Điểm khác biệt là **nhập nhanh**: gõ một câu như "ăn trưa 45k" là app tự tách số tiền, danh mục, ngày; ngoài ra có trợ lý AI (Gemini) để hỏi đáp về chi tiêu.
>
> Kiến trúc gồm frontend React, backend Express, database Postgres trên Supabase. Em phụ trách phần **xác thực người dùng, quên mật khẩu bằng OTP qua email và bảo mật**.

**Tính năng chính:** đăng ký, đăng nhập, quên mật khẩu (OTP) · tổng quan, số dư ví · thêm, sửa, xoá, hoàn tác giao dịch · sổ nợ, chia tiền · báo cáo · trợ lý AI · hồ sơ, đổi mật khẩu.

**Vì sao chọn stack này** (câu hỏi gần như chắc chắn có):
- **React + Vite**: phổ biến, hệ sinh thái lớn, Vite build và reload nhanh.
- **Express**: nhẹ, dễ hiểu, tự kiểm soát toàn bộ luồng auth, phù hợp quy mô đồ án.
- **Postgres (Supabase)**: dữ liệu tài chính có quan hệ chặt (user → ví → giao dịch → nợ), cần ràng buộc khoá ngoại và transaction, nên dùng CSDL quan hệ thay vì NoSQL. Supabase cho Postgres có sẵn, không phải tự dựng server DB.
- **TypeScript ở cả hai đầu + package `shared`**: frontend và backend dùng **chung một bộ schema validate**, tránh lệch dữ liệu.

---

## Phần 1. Kiến trúc tổng thể

```
┌──────────── Trình duyệt ────────────┐         ┌────────── Server ──────────┐        ┌──── Supabase ────┐
│ React (UI)                          │  HTTP   │ Express API (:4000)        │ HTTPS  │ Data API / RPC   │
│  ├ React Router  (chuyển trang)     │ ──────► │  ├ helmet, cors, json      │ ─────► │        │         │
│  ├ TanStack Query (gọi API + cache) │  JSON   │  ├ kiểm tra Origin/header  │        │   PostgreSQL     │
│  ├ Zustand       (state giao diện)  │ ◄────── │  ├ auth routes             │ ◄───── │  (bảng, hàm SQL) │
│  └ http.ts       (fetch + cookie)   │ cookie  │  ├ currentUser (session)   │        └──────────────────┘
└─────────────────────────────────────┘         │  └ module: transactions,…  │
                                                │ Nodemailer ──► SMTP (Gmail/Mailpit)
                                                └────────────────────────────┘
```

**Monorepo** (nhiều project trong một repo, quản lý bằng npm workspaces, xem [package.json](../package.json)):
- [frontend/](../frontend/): React web, package `@cashcash/web`
- [backend/](../backend/): Express API, package `@cashcash/api`
- [packages/shared/](../packages/shared/): schema Zod, kiểu dữ liệu, bộ phân tích câu nhập nhanh, dùng chung cho cả hai bên

**Mô hình client–server, REST API:**
- Client (trình duyệt) chỉ lo hiển thị; mọi dữ liệu và quy tắc nghiệp vụ nằm ở server.
- REST: mỗi tài nguyên là một URL, hành động là HTTP method:
  - `GET /api/v1/transactions` lấy danh sách
  - `POST /api/v1/transactions` tạo mới
  - `PATCH /api/v1/transactions/:id` sửa một phần
  - `DELETE /api/v1/transactions/:id` xoá
- `/api/v1`: có số phiên bản để sau này đổi API không làm hỏng client cũ.

**Vì sao frontend không gọi thẳng Supabase?** Vì secret key của Supabase có toàn quyền DB, không được phép nằm ở trình duyệt. Mọi truy cập DB đi qua backend, backend kiểm tra session và quyền sở hữu rồi mới đọc/ghi. (Xem thêm 6.7.)

---

## Phần 2. Một request đi như thế nào (luồng "thêm giao dịch")

Đây là câu "hỏi xoáy" phổ biến nhất: *"Em bấm nút Lưu thì chuyện gì xảy ra?"*

### Bước 1: Frontend, người dùng bấm Lưu
- Form Quick-add gọi hook `useCreateTransaction()` ở [use-transaction-mutations.ts](../frontend/src/queries/use-transaction-mutations.ts#L133-L150).
- **Optimistic update** (cập nhật lạc quan): trong `onMutate`, app **chụp lại cache hiện tại** (snapshot) rồi chèn ngay giao dịch mới vào danh sách với cờ `pending: true`, nên người dùng thấy kết quả tức thì, không phải chờ server.
- `id` giao dịch do **client tự sinh** (ULID), gửi kèm header `Idempotency-Key`, xem [transactions.service.ts](../frontend/src/services/transactions.service.ts). Mạng chập chờn, gửi lại 2 lần cũng không tạo trùng.

### Bước 2: Đóng gói HTTP request, [http.ts](../frontend/src/lib/http.ts)
```
POST /api/v1/transactions
Accept: application/json
Content-Type: application/json
X-CashCash-Request: 1          ← header riêng để chống CSRF (6.6)
Idempotency-Key: 01J...
Cookie: cashcash_session=<token>   ← trình duyệt tự gắn nhờ credentials: 'include'

{"id":"01J...","type":"EXPENSE","amount":45000,"accountId":"...","categoryId":"...","occurredAt":"..."}
```
- Khi dev, Vite **proxy** `/api` sang `localhost:4000` ([vite.config.ts](../frontend/vite.config.ts)), nên trình duyệt thấy cùng origin, không vướng CORS.

### Bước 3: Backend nhận request, chuỗi middleware trong [app.ts](../backend/src/app.ts)
Middleware là hàm chạy **lần lượt** trước khi tới xử lý chính, mỗi hàm có thể cho đi tiếp (`next()`) hoặc chặn lại (ném lỗi).
1. `helmet()`: gắn các header bảo mật vào response.
2. `cors(...)`: chỉ cho origin trong `CORS_ORIGIN` gọi API kèm cookie.
3. `express.json({ limit: '100kb' })`: đọc body JSON, chặn body quá lớn.
4. `requestLogger`: ghi log `POST /api/v1/transactions 201 35ms`.
5. Kiểm tra **Origin + header `X-CashCash-Request`** cho mọi method ghi (POST/PATCH/DELETE).
6. `currentUser` ([current-user.ts](../backend/src/middlewares/current-user.ts)): đọc cookie, tìm session trong DB → gắn `req.userId`. Không có hoặc hết hạn → **401**.
7. Router: `/transactions` → [transaction.routes.ts](../backend/src/modules/transactions/transaction.routes.ts) → `transactionController.create`.

### Bước 4: Controller → Service → DB
- **Controller** ([transaction.controller.ts](../backend/src/modules/transactions/transaction.controller.ts)): lấy dữ liệu từ request, **validate bằng Zod** (`parseInput`), gọi service, trả response. Không chứa nghiệp vụ.
- **Service** ([transaction.service.ts](../backend/src/modules/transactions/transaction.service.ts)): nghiệp vụ, ví dụ kiểm tra ví và danh mục **có thuộc user này không** (`assertReferences`), chuyển tiền thì phải có ví đích…
- Gọi Supabase: `client.from('transactions').insert(...)`. Supabase chuyển thành câu SQL có tham số rồi chạy trên Postgres.

### Bước 5: Trả response
- Thành công → `201 Created` + JSON giao dịch (gửi trùng id → `200` + bản cũ).
- Lỗi → service ném `HttpError` → [error-handler.ts](../backend/src/middlewares/error-handler.ts) đổi thành JSON thống nhất:
  ```json
  { "error": { "code": "BAD_REQUEST", "message": "Dữ liệu không hợp lệ", "details": {...} } }
  ```
  Lỗi không lường trước → `500` + thông báo chung, **không lộ chi tiết nội bộ** ra client.

### Bước 6: Frontend nhận kết quả
- Thành công: `onSuccess` thay bản tạm bằng bản thật từ server; `onSettled` **invalidate** (đánh dấu cũ) số dư ví và tổng quan để tải lại.
- Thất bại: `onError` **rollback** về snapshot, hiện toast báo lỗi.
- Nếu `401` ở API không phải auth: `http.ts` phát sự kiện `auth-expired` → `AuthGate` xoá cache riêng tư → chuyển về trang đăng nhập.

### Bảng HTTP status cần thuộc
| Code | Nghĩa | Ví dụ trong app |
|---|---|---|
| 200 | OK | Lấy dữ liệu, đăng nhập |
| 201 | Created | Đăng ký, tạo giao dịch |
| 202 | Accepted (đã nhận, xử lý sau) | Quên mật khẩu |
| 204 | No Content | Đăng xuất, đặt lại mật khẩu |
| 400 | Dữ liệu sai | Zod validate lỗi, OTP sai |
| 401 | Chưa đăng nhập / sai thông tin | Sai mật khẩu, session hết hạn |
| 403 | Bị cấm | Sai Origin, thiếu header chống CSRF |
| 404 | Không tìm thấy | Giao dịch không tồn tại |
| 409 | Xung đột | Email đã được dùng |
| 429 | Gửi quá nhiều | Rate limit auth |
| 500 | Lỗi server | Lỗi không lường trước |
| 503 | Dịch vụ tạm không sẵn sàng | Hàng đợi mail đầy, chưa cấu hình AI |

---

## Phần 3. Frontend

| Khái niệm | Trong CashCash |
|---|---|
| **Component** | Hàm trả về giao diện (JSX), ví dụ `AuthPage`, `PasswordRecoveryPage` |
| **State** (`useState`) | Dữ liệu thay đổi làm UI vẽ lại, ví dụ `step`, `error`, `busy` ở trang quên mật khẩu |
| **Routing** | [router.tsx](../frontend/src/app/router.tsx): `/login`, `/register`, `/forgot-password` công khai; các trang còn lại bọc trong `AuthGate` |
| **Server state** | TanStack Query: gọi API, cache, retry, loading/error. Thư mục [queries/](../frontend/src/queries/) |
| **Client state** | Zustand: trạng thái thuần giao diện như sheet nhập nhanh đang mở hay đóng, xem [quick-add.store.ts](../frontend/src/stores/quick-add.store.ts) |
| **Service layer** | [services/](../frontend/src/services/): mỗi file gói các lời gọi API của một tài nguyên |
| **Style** | Tailwind CSS, font Be Vietnam Pro, icon lucide, toast sonner |

**Phân tầng frontend:** `Component → hook (queries/) → service → http.ts → fetch`. Mỗi tầng một việc, đổi cách gọi API chỉ sửa một chỗ.

**Vì sao dùng TanStack Query thay vì `useEffect` + `fetch`?** Có sẵn cache, tự loại bỏ request trùng, retry, trạng thái loading/error, invalidate sau khi ghi, optimistic update. Cấu hình ở [query-client.ts](../frontend/src/lib/query-client.ts):
- `staleTime: 5 phút`: dữ liệu chi tiêu không tự đổi, đỡ gọi lại.
- `refetchOnWindowFocus: false`: quay lại tab không tải lại mọi thứ.
- Không retry lỗi 4xx (lỗi dữ liệu, thử lại vô ích), chỉ retry tối đa 2 lần với lỗi mạng/5xx.

**Bảo vệ route, [auth.tsx](../frontend/src/features/auth/auth.tsx):** `AuthGate` gọi `GET /auth/me`. Đang kiểm tra → hiện "Đang kiểm tra phiên…"; `null` → chuyển `/login`; có user → render trang con.
> ⚠️ Nói rõ khi bị hỏi: **chặn ở frontend chỉ để trải nghiệm**, bảo mật thật nằm ở backend (`currentUser`). Người dùng sửa JS để vào trang thì cũng không lấy được dữ liệu, vì API trả 401.

---

## Phần 4. Backend

**Cấu trúc module** (ví dụ `transactions/`):
| File | Vai trò |
|---|---|
| `*.routes.ts` | Khai báo URL + method → controller |
| `*.controller.ts` | Đọc request, validate, gọi service, trả response |
| `*.service.ts` | Nghiệp vụ + truy cập DB |
| `*.mapper.ts` | Đổi bản ghi DB → DTO trả cho client |
| `*.test.ts` | Unit test |

**Validate bằng Zod**, [validation.ts](../backend/src/lib/validation.ts): `parseInput(schema, req.body)` sai thì ném 400 kèm lỗi từng trường. Schema nằm trong `packages/shared`, **frontend dùng lại đúng schema đó** để báo lỗi ngay trên form.
> Nguyên tắc: **không bao giờ tin dữ liệu từ client**. Frontend validate cho UX, backend validate cho bảo mật.

**Biến môi trường**, [env.ts](../backend/src/config/env.ts): đọc `.env`, validate bằng Zod lúc khởi động; sai cấu hình thì **dừng server ngay** thay vì chạy lỗi ngầm. Production bắt buộc `APP_URL` HTTPS và email gửi thật.

**Tiền tệ**, [money.ts](../backend/src/lib/money.ts): lưu tiền dạng **số nguyên `BIGINT`** (đồng), không dùng số thực để tránh sai số làm tròn (0.1 + 0.2 ≠ 0.3). Chuyển sang `number` trong JSON thì kiểm tra không vượt `MAX_SAFE_INTEGER`.

**Phân trang bằng cursor** ([transaction.cursor.ts](../backend/src/modules/transactions/transaction.cursor.ts)): thay vì `OFFSET` (trang càng sâu càng chậm, dễ trùng hoặc sót khi có bản ghi mới chen vào), dùng mốc `(occurredAt, id)` của bản ghi cuối để lấy trang tiếp.

**Xoá mềm (soft delete):** giao dịch có cột `deletedAt`, xoá thì chỉ đánh dấu nên **hoàn tác** (`/restore`) được.

---

## Phần 5. Database

**Các bảng chính** (migration đầu: [20260914181024_cashcash](../backend/db/migrations/20260914181024_cashcash/)):
```
users ──1:N── accounts (ví: CASH, BANK, EWALLET, CREDIT_CARD)
  │    ──1:N── categories (danh mục EXPENSE/INCOME, có parentId)
  │    ──1:N── transactions (EXPENSE/INCOME/TRANSFER, amount BIGINT, deletedAt)
  │    ──1:N── contacts ──1:N── debts ──1:N── debt_payments
  │    ──1:N── sessions        (tokenHash, expiresAt)        ← phần của mình
  └────1:N── password_resets (tokenHash, otpHash, attempts) ← phần của mình
```
- **Khoá ngoại + `ON DELETE CASCADE`**: xoá user thì xoá theo ví, giao dịch, session…
- **`ON DELETE RESTRICT`** ở `transactions.accountId`: không cho xoá ví đang có giao dịch.
- **Index** `(userId, occurredAt DESC)`: truy vấn "giao dịch mới nhất của user" nhanh.
- **Unique** `users.email`: một email một tài khoản (DB đảm bảo, không chỉ code).

**Migration** ([db/migrations/](../backend/db/migrations/)): mỗi thay đổi cấu trúc DB là một file SQL có đánh số thời gian, chạy theo thứ tự bằng `npm run db:deploy`. Script lưu checksum, chạy mỗi file trong một transaction, khoá để hai người không chạy cùng lúc. Lợi ích: **ai cũng dựng lại được đúng DB**, có lịch sử thay đổi như git.

**RPC (hàm SQL `plpgsql`):** các thao tác nhiều bước cần **nguyên tử** (cùng thành công hoặc cùng thất bại) được viết thành hàm trong Postgres, backend gọi `client.rpc('ten_ham', ...)`. Ví dụ `cashcash_register`: tạo user + danh mục mặc định + ví mặc định + session trong **một transaction**; lỗi giữa chừng thì không để lại user "nửa vời".

**RLS (Row Level Security)** bật trên mọi bảng ([enable_rls](../backend/db/migrations/20261013150000_enable_rls/)) và **không có policy nào** cho `anon`/`authenticated`, nghĩa là **không ai truy cập trực tiếp được bằng key công khai**; chỉ backend (dùng secret key, role `service_role`) đọc ghi được. Các hàm RPC cũng `REVOKE` khỏi public, chỉ `GRANT` cho `service_role`.

**Vì sao bỏ Prisma?** Dự án chuyển từ Prisma sang SQL migration + Supabase Data API/RPC để: bớt một lớp công cụ sinh code, viết được hàm SQL nguyên tử (khoá dòng `FOR UPDATE`, transaction) cho các luồng nhạy cảm như auth và nợ, quản lý quyền ở mức DB. (Thư mục `apps/` còn code Prisma cũ, không phải code đang chạy.)

---

## Phần 6. Auth, OTP và bảo mật ⭐ (PHẦN CỦA MÌNH)

### 6.1 Khái niệm nền
- **Authentication (xác thực):** "anh là ai?", tức đăng nhập.
- **Authorization (phân quyền):** "anh được làm gì?". Trong app: mỗi user chỉ đụng được dữ liệu có `userId` của mình (service luôn lọc theo `req.userId`).
- **Hash ≠ mã hoá:** mã hoá giải ngược được bằng khoá; hash là **một chiều**, không giải ngược được. Mật khẩu phải **hash**, không mã hoá.
- **Salt:** chuỗi ngẫu nhiên riêng cho mỗi mật khẩu, trộn vào trước khi hash, nên hai người cùng mật khẩu "123456" vẫn ra hai hash khác nhau, và **rainbow table** (bảng hash tính sẵn) trở nên vô dụng.

Toàn bộ code: [backend/src/modules/auth/](../backend/src/modules/auth/)

### 6.2 Lưu mật khẩu: scrypt, [password.ts](../backend/src/modules/auth/password.ts)
```ts
const salt = randomBytes(16).toString('hex')                  // salt ngẫu nhiên 16 byte
scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, ... })     // hash cố ý "chậm + tốn RAM"
// Lưu vào DB dạng:  scrypt$<salt>$<hash>
```
- **Vì sao scrypt, không dùng MD5/SHA-256?** MD5/SHA rất nhanh, GPU thử được hàng tỷ mật khẩu mỗi giây. scrypt được thiết kế **chậm và tốn bộ nhớ** (N=32768 dùng khoảng 32MB RAM mỗi lần), nên brute-force đắt hơn rất nhiều. Có sẵn trong Node (`node:crypto`), không cần thư viện ngoài. (bcrypt/Argon2 cũng là lựa chọn đúng; Argon2id là khuyến nghị mới nhất của OWASP.)
- **So sánh bằng `timingSafeEqual`:** so sánh thường dừng ngay ở byte sai đầu tiên, nên kẻ tấn công đo thời gian phản hồi có thể đoán dần. Hàm này luôn so đủ mọi byte, thời gian như nhau.
- **Chống dò email qua thời gian:** khi email **không tồn tại**, `verifyPassword` vẫn chạy scrypt với salt giả (`'0000…'`), nên đăng nhập email sai và mật khẩu sai mất **cùng thời gian**, kẻ tấn công không phân biệt được.
- Test: [password.test.ts](../backend/src/modules/auth/password.test.ts) kiểm tra hash không chứa mật khẩu gốc, cùng mật khẩu ra hash khác nhau, sai mật khẩu bị từ chối.

### 6.3 Session bằng cookie
**Sinh session**, [auth.service.ts](../backend/src/modules/auth/auth.service.ts):
```ts
const token = randomBytes(32).toString('hex')    // 256 bit ngẫu nhiên, không đoán được
DB lưu:  sessions(tokenHash = sha256(token), userId, expiresAt = now + 7 ngày)
Trình duyệt giữ: cookie cashcash_session = token (bản gốc)
```
- **Vì sao DB chỉ lưu hash của token?** Nếu DB bị lộ, kẻ tấn công chỉ có hash, **không dùng được để đăng nhập**. Giống nguyên tắc lưu mật khẩu. Ở đây dùng SHA-256 (nhanh) là đủ, vì token đã là 256 bit ngẫu nhiên, không thể brute-force như mật khẩu người đặt.
- **Mỗi request:** `currentUser` lấy token từ cookie → kiểm tra định dạng 64 ký tự hex → `sha256` → tìm session còn hạn → lấy user.

**Thuộc tính cookie**, [auth.cookie.ts](../backend/src/modules/auth/auth.cookie.ts):
| Thuộc tính | Tác dụng |
|---|---|
| `httpOnly: true` | JavaScript **không đọc được** cookie, nên XSS không lấy trộm được session |
| `secure` (production) | Chỉ gửi qua HTTPS, không bị nghe lén |
| `sameSite: 'lax'` | Trang web khác gửi request ngầm (POST) sang thì **không kèm cookie**, giảm CSRF |
| `path: '/'`, `maxAge: 7 ngày` | Phạm vi và thời hạn |

**Cookie session hay JWT?** (rất hay bị hỏi)
| | Session trong DB (CashCash) | JWT |
|---|---|---|
| Thu hồi (logout, đổi mật khẩu) | Xoá dòng trong DB là **mất hiệu lực ngay** | Khó, token còn hạn vẫn dùng được nếu không có blacklist |
| Mỗi request | Phải truy vấn DB | Không cần DB (chỉ kiểm tra chữ ký) |
| Lưu ở client | Cookie httpOnly | Hay bị để localStorage, dễ bị XSS lấy |
| Hợp với | App một backend, cần thu hồi chắc chắn | Nhiều service, không muốn tra DB |

> **Câu nên nói:** "Em chọn session lưu DB vì app tài chính cần **thu hồi ngay**: đổi mật khẩu hay đặt lại mật khẩu là các phiên cũ bị xoá tức thì. Đổi lại mỗi request tốn một truy vấn, ở quy mô này chấp nhận được, sau này có thể cache."

### 6.4 Đăng ký, đăng nhập, đăng xuất, đổi mật khẩu
Controller: [auth.controller.ts](../backend/src/modules/auth/auth.controller.ts), routes: [auth.routes.ts](../backend/src/modules/auth/auth.routes.ts)

| API | Việc chính |
|---|---|
| `POST /auth/register` | Zod validate (email hợp lệ, đổi về chữ thường, mật khẩu 8–128 ký tự) → hash → RPC `cashcash_register` (tạo user, danh mục và ví mặc định, session **trong 1 transaction**) → set cookie → `201` |
| `POST /auth/login` | Tìm user theo email → `verifyPassword` → RPC `cashcash_session_create` → set cookie. Sai email **hoặc** sai mật khẩu đều trả **cùng một câu** "Email hoặc mật khẩu không đúng" |
| `POST /auth/logout` | Xoá session trong DB + xoá cookie → `204` |
| `GET /auth/me` | Trả user hiện tại hoặc `401`; frontend dùng để biết đã đăng nhập chưa |
| `POST /users/me/password` | Đổi mật khẩu khi đã đăng nhập: kiểm tra mật khẩu cũ → RPC `cashcash_change_password` → **giữ phiên hiện tại, xoá mọi phiên khác** |

Các chi tiết "ăn điểm":
- **Xoay session khi đăng nhập/đăng ký:** trước khi cấp cookie mới, xoá session cũ đang có trong trình duyệt (`authService.logout(sessionToken(req))`), chống **session fixation**.
- **`cashcash_session_create` khoá dòng user (`FOR UPDATE`) và so lại `passwordHash`:** nếu giữa lúc kiểm tra mật khẩu và lúc tạo session mà mật khẩu vừa bị đổi (race condition), session **không được tạo**. Xem [auth_rpc](../backend/db/migrations/20261013220000_auth_rpc/).
- Email trùng → Postgres báo lỗi unique `23505` → trả `409`.
- Đăng nhập/đăng ký xong, frontend **xoá cache dữ liệu cũ** để không lộ dữ liệu của tài khoản trước ([auth-page.tsx](../frontend/src/features/auth/auth-page.tsx)).

### 6.5 Quên mật khẩu bằng OTP (luồng mình làm, học kỹ nhất)
Code: [password-reset.service.ts](../backend/src/modules/auth/password-reset.service.ts), [password-reset.mail.ts](../backend/src/modules/auth/password-reset.mail.ts), SQL: [password_reset_rpc](../backend/db/migrations/20261014120000_password_reset_rpc/), giao diện: [password-recovery-page.tsx](../frontend/src/features/auth/password-recovery-page.tsx)

```
Người dùng                  Frontend                     Backend                               DB / Email
    │ nhập email               │                            │                                      │
    │─────────────────────────►│ POST /forgot-password ────►│ trả 202 NGAY (câu trả lời chung)     │
    │                          │                            │ chạy nền: tìm user                   │
    │                          │                            │  ├ sinh OTP 6 số + token 32 byte     │
    │                          │                            │  ├ RPC reset_issue ─────────────────►│ lưu hash(token), hash(OTP)
    │◄──────────────────── email OTP ───────────────────────│  └ gửi mail (lỗi → xoá bản ghi)      │
    │ nhập OTP                 │                            │                                      │
    │─────────────────────────►│ POST /verify-reset-otp ───►│ so OTP (scrypt)                      │
    │                          │                            │  ├ sai → reset_fail: attempts+1 ────►│
    │                          │◄──── { token mới } ────────│  └ đúng → reset_verify: đổi token, ─►│ xoá otpHash
    │ nhập mật khẩu mới        │                            │                                      │
    │─────────────────────────►│ POST /reset-password ─────►│ RPC reset_consume ──────────────────►│ đổi mật khẩu,
    │                          │◄──── 204, xoá cookie ──────│                                      │ xoá MỌI session
```

**Bước 1, `POST /forgot-password`:**
- Trả **`202` cùng một câu** "Nếu email này có tài khoản, bạn sẽ nhận được mã OTP" **trước khi** tra DB hay gửi mail (`queuePasswordReset` chạy nền bằng `setImmediate`). Vì sao? Nếu trả "email không tồn tại", hoặc email có tồn tại mà phản hồi chậm hơn (do phải gửi SMTP), kẻ tấn công sẽ **dò ra email nào có tài khoản** (user enumeration). Ở đây cả nội dung lẫn thời gian phản hồi đều giống nhau.
- Hàng đợi tối đa 10 việc gửi mail cùng lúc, đầy thì trả `503`, chống bị spam làm sập SMTP.
- OTP sinh bằng `randomInt` của `node:crypto` (**ngẫu nhiên mật mã học**, không dùng `Math.random()` vì đoán được).
- DB **chỉ lưu hash của OTP (scrypt) và hash của token**, không lưu OTP gốc.
- RPC `cashcash_reset_issue` (nguyên tử):
  - Tài khoản không có mật khẩu (tài khoản seed) → không cấp.
  - **Cooldown 1 phút**: vừa yêu cầu trong 1 phút qua → không gửi nữa.
  - Xoá yêu cầu cũ, mỗi user chỉ có **1 OTP còn hiệu lực**.
  - Hạn **10 phút**.
- Gửi mail lỗi → **xoá bản ghi vừa tạo**, để người dùng yêu cầu lại được ngay. Log lỗi **không ghi email, OTP hay token**.

**Bước 2, `POST /verify-reset-otp`:**
- Lấy yêu cầu mới nhất của user, kiểm tra còn hạn và `attempts < 5`.
- OTP sai → `cashcash_reset_fail` tăng `attempts`. **Tối đa 5 lần sai**, sau đó mã bị vô hiệu.
- OTP đúng → `cashcash_reset_verify`: **đổi sang token mới**, xoá `otpHash` (OTP không dùng lại được), gia hạn 10 phút → trả token cho frontend. Đây là **xoay token**: token ở bước 1 (chưa bao giờ rời server) bị thay bằng token chỉ có được khi đã nhập đúng OTP.
- Response có `Cache-Control: no-store` để trình duyệt/proxy không lưu token.

**Bước 3, `POST /reset-password`:**
- Gửi `{ token, password }`. Token phải đúng 64 ký tự hex, bản ghi đã qua bước OTP (`otpHash IS NULL`) và còn hạn.
- RPC `cashcash_reset_consume` **trong 1 transaction**: khoá dòng user → xoá yêu cầu (token **dùng một lần**) → cập nhật `passwordHash` → xoá mọi yêu cầu reset khác → **xoá TẤT CẢ session** của user. Kẻ đang chiếm phiên bị đá ra ngay.
- Response xoá cookie, trình duyệt hiện tại cũng phải đăng nhập lại.

**Tính toán độ an toàn OTP** (nói được con số là ăn điểm):
- 6 chữ số = 1.000.000 khả năng. Mỗi mã chỉ được thử 5 lần → xác suất đoán trúng một mã ≈ **5 / 1.000.000 = 0,0005%**.
- Muốn mã mới phải chờ cooldown 1 phút, và mỗi IP chỉ gọi 20 lần / 15 phút vào nhóm API auth → brute-force là không khả thi trong 10 phút hiệu lực.

**Gửi email** ([password-reset.mail.ts](../backend/src/modules/auth/password-reset.mail.ts)): Nodemailer qua SMTP. Dev dùng **Mailpit** (hộp thư giả chạy bằng Docker, `npm run mail:up`, xem ở `localhost:8025`). Thật thì dùng Gmail + **App Password** (không dùng mật khẩu Google thật). Production bắt buộc TLS. Kiểm tra OTP đúng 6 số trước khi chèn vào HTML. Bật `disableFileAccess/disableUrlAccess` để nội dung mail không thể đọc file trên server hay tải URL ngoài.

**Vì sao OTP thay vì link đặt lại mật khẩu?** (migration [reset_otp](../backend/db/migrations/20260916160000_reset_otp/) đã chuyển từ link sang OTP và vô hiệu mọi link cũ)
- Link chứa token nằm trong URL nên dễ bị lưu lịch sử trình duyệt, log server, header Referer, hoặc bị trình quét link của mail tự mở.
- OTP người dùng gõ tay trên **chính tab đang thao tác**, không mở tab mới, trải nghiệm trên điện thoại tốt hơn (`autoComplete="one-time-code"` để điện thoại gợi ý mã).

**Phía giao diện:** một trang 4 bước `email → otp → password → done`; validate bằng **cùng schema Zod** với backend; nút "Gửi lại OTP" có **đếm ngược 60 giây** khớp cooldown server; `useRef submitting` chặn bấm đúp; yêu cầu nhập lại mật khẩu để xác nhận; xong thì xoá cache dữ liệu riêng tư.

### 6.6 Các tấn công web và cách app chống

| Tấn công | Là gì | CashCash chống thế nào |
|---|---|---|
| **SQL Injection** | Chèn mã SQL vào input, ví dụ `' OR 1=1 --` | Không tự nối chuỗi SQL. Supabase/PostgREST và RPC truyền **tham số tách khỏi câu lệnh**. Hàm SQL đặt `search_path = ''` và ghi đầy đủ `public.` để không bị đánh tráo bảng/hàm. Input đã qua Zod |
| **XSS** | Chèn script vào trang để chạy trên máy nạn nhân | React **tự escape** mọi chuỗi khi render. Cookie `httpOnly` nên script không đọc được session. `helmet` thêm header bảo mật (CSP…) |
| **CSRF** | Trang độc hại khiến trình duyệt nạn nhân tự gửi request kèm cookie | 3 lớp: (1) cookie `SameSite=Lax`; (2) mọi POST/PATCH/DELETE bắt buộc có header **`X-CashCash-Request: 1`**; form HTML của trang khác không gắn được header tuỳ ý, còn `fetch` cross-origin có header lạ thì bị CORS preflight chặn; (3) kiểm tra header **`Origin`** phải nằm trong danh sách cho phép, sai thì `403` ([app.ts](../backend/src/app.ts#L25-L33)) |
| **Brute-force** đăng nhập/OTP | Thử hàng loạt mật khẩu/mã | Rate limit 20 request / 15 phút / IP cho nhóm API auth → `429`. scrypt chậm. OTP 5 lần thử + cooldown 1 phút |
| **User enumeration** | Dò email nào có tài khoản | Đăng nhập: cùng một thông báo + cùng thời gian. Quên mật khẩu: luôn `202` cùng một câu, xử lý nền |
| **Session hijacking** | Trộm cookie | httpOnly, secure, token 256 bit, DB chỉ lưu hash, hết hạn 7 ngày, xoá session khi đổi hoặc đặt lại mật khẩu |
| **Session fixation** | Ép nạn nhân dùng session do kẻ tấn công biết trước | Đăng nhập/đăng ký luôn cấp token mới, xoá token cũ |
| **Lộ secret** | Key DB lọt ra frontend/git | `SUPABASE_SECRET_KEY`, mật khẩu SMTP chỉ ở `backend/.env` (gitignore); frontend không có key nào. RLS chặn truy cập trực tiếp |
| **DoS bằng body lớn** | Gửi JSON khổng lồ | `express.json({ limit: '100kb' })` |
| **Lộ lỗi nội bộ** | Stack trace lộ cấu trúc hệ thống | `errorHandler` trả `500` với câu chung, chi tiết chỉ log ở server |

**CORS** (hay bị hiểu sai, nên nói cho chuẩn): CORS là cơ chế **trình duyệt** dùng để quyết định JS ở origin A có được **đọc response** từ origin B không. Nó **không phải** tường lửa bảo vệ server (Postman, curl không bị CORS). App cấu hình `origin` = danh sách cụ thể + `credentials: true` (không dùng `*`, vì `*` không đi cùng cookie được).

**helmet:** gắn sẵn các header như `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, `X-Frame-Options` (chống clickjacking: nhúng trang vào iframe để lừa bấm).

### 6.7 Phân quyền dữ liệu (authorization)
- Mọi API ngoài `/auth` đều đi qua `currentUser`, nên luôn có `req.userId` **lấy từ session**, không bao giờ lấy userId từ body/query client gửi lên.
- Service luôn lọc/kiểm tra `userId`: ví dụ `findActive` trả 404 nếu giao dịch không phải của user (**không trả 403**, để không tiết lộ giao dịch đó có tồn tại). `assertReferences` kiểm tra ví và danh mục thuộc user. Chống **IDOR** (sửa id trên URL để xem dữ liệu người khác).
- Lớp DB: RLS bật, không có policy cho `anon`/`authenticated` + RPC chỉ cấp cho `service_role`, nên lỡ lộ URL Supabase cùng key công khai thì cũng không đọc được bảng.

### 6.8 Điểm yếu tự nhận (nói trước khi bị bắt lỗi = ghi điểm)
Câu dẫn: *"Trong phạm vi đồ án em chấp nhận một số giới hạn và đã có hướng cải thiện:"*

1. **Rate limit lưu trong RAM** (`Map` ở [auth.routes.ts](../backend/src/modules/auth/auth.routes.ts)): khởi động lại server thì mất bộ đếm; chạy nhiều server thì mỗi máy đếm riêng; đứng sau reverse proxy mà chưa bật `trust proxy` thì mọi người dùng chung IP của proxy. → **Hướng sửa:** dùng Redis, cấu hình `app.set('trust proxy', ...)`, giới hạn thêm theo email chứ không chỉ theo IP.
2. **Hàng đợi gửi mail cũng trong RAM:** server tắt giữa chừng thì việc gửi đó mất (người dùng bấm gửi lại được). → Hàng đợi bền như BullMQ/Redis.
3. **Session hết hạn không bị dọn tự động:** query đã lọc `expiresAt > now` nên vẫn an toàn, chỉ là bảng phình dần. → Cron job (ví dụ `pg_cron`) xoá định kỳ.
4. **Đăng ký báo "Email đã được sử dụng"** nên vẫn dò được email qua form đăng ký. → Đánh đổi vì UX; cách triệt để là xác minh email trước khi tạo tài khoản.
5. **Chưa xác minh email khi đăng ký**, chưa có **2FA**, chưa có **khoá tài khoản** sau nhiều lần đăng nhập sai, chưa có trang "các thiết bị đang đăng nhập".
6. **Mỗi request đều tra DB để xác thực session** (2 truy vấn). → Gộp thành 1 truy vấn join hoặc cache ngắn hạn.

---

## Phần 7. UX/UI

- **Nhập nhanh (Quick-add):** gõ "ăn trưa 45k hôm qua" thì parser ([packages/shared/src/parser/](../packages/shared/src/parser/)) tách số tiền, danh mục (theo từ khoá), ngày, ví. Có phím tắt mở nhanh, có route `/add?type=expense` làm shortcut PWA.
- **Optimistic UI + Hoàn tác:** lưu là thấy ngay; xoá có nút hoàn tác trên toast.
- **Phản hồi rõ ràng:** toast (sonner) cho thành công/lỗi; thông báo lỗi tiếng Việt cụ thể; trạng thái "Đang xử lý…", nút bị khoá khi đang gửi để chống bấm đúp.
- **Responsive:** desktop có sidebar, mobile có bottom nav ([components/layout/](../frontend/src/components/layout/)).
- **Font Be Vietnam Pro:** hiển thị tiếng Việt đẹp, đủ dấu.
- **Accessibility trong phần auth:** `label` bọc input, `role="alert"` cho lỗi (trình đọc màn hình đọc ra), `autoComplete` đúng (`current-password`, `new-password`, `one-time-code`) để trình quản lý mật khẩu và điện thoại tự điền, `inputMode="numeric"` để mobile hiện bàn phím số khi nhập OTP.
- **UX bảo mật cân bằng:** thông báo chung chung ("Nếu email này có tài khoản…") vẫn hướng dẫn rõ: kiểm tra thư rác, mã hiệu lực 10 phút, tối đa 5 lần thử, đếm ngược gửi lại.

---

## Phần 8. Test, chạy và triển khai

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy API (`:4000`) + web (`:5173`) cùng lúc |
| `npm test` | Vitest: unit test ([password.test.ts](../backend/src/modules/auth/password.test.ts), [password-reset.service.test.ts](../backend/src/modules/auth/password-reset.service.test.ts), [auth.test.tsx](../frontend/src/features/auth/auth.test.tsx), [password-recovery-page.test.tsx](../frontend/src/features/auth/password-recovery-page.test.tsx), parser, money…) |
| `npm run typecheck` | Kiểm tra kiểu TypeScript toàn bộ |
| `npm run test:auth -w @cashcash/api` | Test tích hợp đăng ký/đăng nhập/session trên DB thật, tự dọn dữ liệu thử |
| `npm run mail:up` rồi `npm run test:password-reset -w @cashcash/api` | Test luồng OTP thật qua Mailpit |
| `npm run db:deploy` | Chạy migration |
| `npm run build` | Build frontend ra file tĩnh |

Test của phần mình kiểm tra: không gửi mail cho email không tồn tại hoặc tài khoản seed; SMTP lỗi thì xoá token và không log bí mật; OTP đúng định dạng 6 số, token là hash 64 hex khác OTP; cooldown 1 phút không gửi lặp.

**Triển khai (nếu bị hỏi):** frontend build ra file tĩnh, đưa lên Vercel/Netlify/Nginx; backend chạy Node trên VPS/Render/Railway; DB là Supabase. Bắt buộc HTTPS (cookie `secure`), đặt `NODE_ENV=production`, `CORS_ORIGIN` là domain thật, SMTP thật.

---

## Phần 9. Câu hỏi phản biện + gợi ý trả lời

### 9.1 Chung
1. **App giải quyết vấn đề gì? Khác app khác ở đâu?** → Phần 0. Nhấn: nhập nhanh bằng câu tự nhiên, sổ nợ chia tiền, trợ lý AI.
2. **Vì sao React mà không Next.js?** → App là SPA sau đăng nhập, không cần SEO hay render phía server; Vite đơn giản, nhanh; backend tách riêng Express để tự kiểm soát auth.
3. **Vì sao Postgres mà không MongoDB?** → Dữ liệu tài chính có quan hệ chặt, cần khoá ngoại, unique, transaction ACID (ví dụ đăng ký tạo nhiều bảng cùng lúc, đặt lại mật khẩu đổi mật khẩu + xoá session cùng lúc).
4. **REST là gì? Vì sao `/api/v1`?** → Phần 1.
5. **Khi bấm Lưu thì chuyện gì xảy ra?** → Phần 2, kể đủ 6 bước.
6. **Frontend và backend giao tiếp thế nào?** → HTTP + JSON, cookie tự gửi nhờ `credentials: 'include'`.
7. **Package `shared` để làm gì?** → Một nguồn duy nhất cho schema/kiểu dữ liệu; frontend báo lỗi sớm, backend validate thật, không lệch nhau.
8. **Optimistic update là gì? Lỗi thì sao?** → Hiện trước, lỗi thì rollback về snapshot + toast.
9. **Gửi trùng request tạo giao dịch thì sao?** → Idempotency: id do client sinh, server gặp id đã có thì trả lại bản cũ với `200`.
10. **Vì sao lưu tiền bằng số nguyên?** → Phần 4.
11. **Migration là gì?** → Phần 5.
12. **1000 người dùng cùng lúc thì sao?** → Express không giữ state (trừ rate limit, hàng đợi mail, xem 6.8), nên chạy nhiều instance sau load balancer được; Postgres có index theo `userId`; nút thắt là tra session mỗi request và rate limit trong RAM → chuyển Redis.
13. **Mất mạng thì sao?** → `http.ts` báo "Không kết nối được máy chủ", Query retry lỗi mạng tối đa 2 lần, optimistic thì rollback.

### 9.2 Auth và bảo mật (phần của mình, chuẩn bị kỹ)
14. **Mật khẩu lưu thế nào? Admin đọc được không?** → scrypt + salt riêng, chỉ lưu hash; không ai đọc được, kể cả admin. Quên thì chỉ có thể đặt lại.
15. **Hash và mã hoá khác nhau thế nào? Salt để làm gì?** → 6.1.
16. **Vì sao không dùng MD5/SHA-256 cho mật khẩu?** → Quá nhanh, GPU brute-force được; scrypt chậm và tốn RAM có chủ đích.
17. **Vì sao dùng `timingSafeEqual`?** → Chống timing attack.
18. **Session hay JWT? Vì sao?** → Bảng 6.3 + câu nên nói.
19. **Cookie có những thuộc tính gì? Từng cái để làm gì?** → Bảng 6.3.
20. **Lộ database thì kẻ tấn công đăng nhập được không?** → Không: chỉ có hash mật khẩu (scrypt) và hash token session/OTP, không dùng trực tiếp được.
21. **Người khác lấy được cookie thì sao?** → Dùng được tới khi hết hạn hoặc bị thu hồi; giảm rủi ro bằng httpOnly, secure, hạn 7 ngày; người dùng đổi hoặc đặt lại mật khẩu thì mọi phiên khác bị xoá. Hướng cải thiện: trang quản lý thiết bị, gắn session với thiết bị.
22. **Trình bày luồng quên mật khẩu.** → Vẽ sơ đồ 6.5, kể 3 bước.
23. **OTP 6 số có dễ bị đoán không?** → Tính toán ở 6.5: 5 lần thử mỗi mã, hạn 10 phút, cooldown 1 phút, rate limit IP.
24. **Vì sao luôn trả "Nếu email này có tài khoản…"? Vì sao xử lý nền?** → Chống user enumeration bằng cả nội dung lẫn thời gian phản hồi.
25. **Vì sao sau khi nhập OTP lại trả token mới, không dùng luôn OTP ở bước đặt mật khẩu?** → Tách "chứng minh sở hữu email" và "đặt mật khẩu"; OTP bị xoá ngay khi đúng nên không dùng lại được; token mới 256 bit, dùng 1 lần, hạn 10 phút; nhập sai mật khẩu mới (quá ngắn…) không tốn thêm lượt OTP.
26. **Đặt lại mật khẩu xong các phiên cũ thì sao?** → Bị xoá hết, kể cả phiên hiện tại; ai đang chiếm tài khoản bị đá ra.
27. **Đổi mật khẩu (đang đăng nhập) khác đặt lại mật khẩu ở đâu?** → Đổi: phải nhập mật khẩu cũ, giữ phiên hiện tại, xoá phiên khác. Đặt lại: qua OTP email, xoá mọi phiên.
28. **Gửi mail thất bại thì sao?** → Xoá bản ghi OTP để gửi lại được ngay, log không chứa thông tin nhạy cảm, người dùng vẫn thấy thông báo chung.
29. **Vì sao OTP thay vì link?** → 6.5.
30. **Vì sao cần RPC/transaction cho auth?** → Các bước phải cùng thành công: ví dụ `reset_consume` đổi mật khẩu mà quên xoá session thì kẻ tấn công vẫn còn phiên. Khoá `FOR UPDATE` chống race khi hai request chạy song song.
31. **SQL Injection, XSS, CSRF: app chống thế nào?** → Bảng 6.6. **CSRF phải kể đủ 3 lớp.**
32. **CORS là gì? Có phải CORS bảo vệ API không?** → 6.6: CORS do trình duyệt áp dụng, không thay được xác thực ở server.
33. **Sửa id trên URL để xem giao dịch người khác được không?** → Không, 6.7 (IDOR). Trả 404.
34. **Frontend chặn route là đủ chưa?** → Chưa, đó chỉ là UX; backend `currentUser` mới là chốt chặn.
35. **Secret key để ở đâu? Lộ thì sao?** → `backend/.env`, không commit; lộ thì vào Supabase **đổi (rotate) key** ngay. Frontend không giữ key nào.
36. **Rate limit hoạt động thế nào? Hạn chế?** → 20 request / 15 phút / IP cho nhóm API auth; hạn chế ở 6.8.
37. **Nếu làm tiếp, em sẽ cải thiện bảo mật gì?** → Danh sách 6.8: Redis rate limit, xác minh email, 2FA (TOTP), quản lý thiết bị, khoá tạm tài khoản, dọn session, Argon2id.
38. **Đã test phần auth thế nào?** → Unit test + test tích hợp trên DB thật + test OTP qua Mailpit (Phần 8).

### 9.3 Câu "bẫy"
39. **Em tự viết hay dùng thư viện? Vì sao không dùng Supabase Auth/Firebase Auth?** → Tự viết trên nền `node:crypto` để hiểu và kiểm soát toàn bộ luồng, phục vụ mục tiêu học; thừa nhận thực tế nên dùng giải pháp đã được kiểm chứng (Supabase Auth, Auth.js, Clerk) để có sẵn 2FA, OAuth, xác minh email.
40. **Code này có dùng AI hỗ trợ không?** → Trả lời trung thực; nhấn mạnh mình **hiểu và giải thích được từng quyết định**. Chính tài liệu này là để đảm bảo điều đó.

---

## Phần 10. Mẹo khi phản biện

- **Mở sẵn trong VS Code** trước buổi: `app.ts`, `auth.service.ts`, `password.ts`, `password-reset.service.ts`, migration `password_reset_rpc`, `password-recovery-page.tsx`. Bị hỏi là mở đúng chỗ, chỉ vào dòng code.
- **Chuẩn bị demo:** bật Mailpit (`npm run mail:up`), mở `localhost:8025` ở một tab, demo quên mật khẩu: nhập email → OTP hiện trong Mailpit → nhập sai OTP vài lần (xem thông báo) → nhập đúng → đổi mật khẩu → đăng nhập lại. **Quay sẵn video** phòng khi mạng hoặc Supabase lỗi.
- **Mở DevTools > Network** khi demo để chỉ request/response, header `X-CashCash-Request`, cookie `HttpOnly`. Tab **Application > Cookies** để chỉ cờ HttpOnly, SameSite.
- **Không biết thì nói thật:** "Phần này em chưa tìm hiểu sâu, theo em hiểu thì… em sẽ bổ sung." Tốt hơn nhiều so với nói sai.
- **Trả lời theo khung:** *Là gì → Trong app em làm thế nào (chỉ code) → Vì sao chọn cách đó → Hạn chế/hướng cải thiện.*
- Câu khó về phần **không phải của mình**: trả lời ở mức kiến trúc (Phần 1–5), rồi nói "phần chi tiết bạn X phụ trách".
