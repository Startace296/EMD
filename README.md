# Xác thực & phân quyền trong CashCash — tài liệu chuyên sâu

> Tài liệu này giải thích **toàn bộ phần auth** của CashCash: lý thuyết nền (JWT, refresh token, OAuth 2.0, OpenID Connect, PKCE, CSRF…), rồi đi qua **từng file, từng luồng** ở backend (Express + Supabase) và frontend (React + TanStack Query).
> Mục tiêu: đọc xong có thể tự giải thích, debug và mở rộng hệ thống, và trả lời được câu hỏi phỏng vấn về auth.

---

## Mục lục

1. [Bức tranh tổng thể](#1-bức-tranh-tổng-thể)
2. [Kiến thức nền](#2-kiến-thức-nền)
3. [JWT — JSON Web Token](#3-jwt--json-web-token)
4. [Access token + Refresh token](#4-access-token--refresh-token)
5. [OAuth 2.0 và OpenID Connect](#5-oauth-20-và-openid-connect)
6. [Backend: bản đồ file](#6-backend-bản-đồ-file)
7. [Backend: pipeline middleware](#7-backend-pipeline-middleware)
8. [Backend: cookie](#8-backend-cookie)
9. [Backend: database & RPC](#9-backend-database--rpc)
10. [Các luồng chi tiết](#10-các-luồng-chi-tiết)
11. [Hash mật khẩu](#11-hash-mật-khẩu)
12. [Phân quyền theo role (USER / ADMIN)](#12-phân-quyền-theo-role-user--admin)
13. [Frontend](#13-frontend)
14. [Cấu hình môi trường](#14-cấu-hình-môi-trường)
15. [Mô hình tấn công & cách hệ thống chống](#15-mô-hình-tấn-công--cách-hệ-thống-chống)
16. [Kiểm thử](#16-kiểm-thử)
17. [Đánh đổi, giới hạn & hướng mở rộng](#17-đánh-đổi-giới-hạn--hướng-mở-rộng)
18. [Câu hỏi ôn tập](#18-câu-hỏi-ôn-tập)
19. [Thuật ngữ](#19-thuật-ngữ)

---

## 1. Bức tranh tổng thể

```
┌──────────────────────────┐   cookie HttpOnly (cc_access, cc_refresh)   ┌────────────────────────────┐
│  Trình duyệt             │ ─────────────────────────────────────────►  │  Express API (backend)     │
│  React SPA (frontend)    │   header X-CashCash-Request: 1              │  - ký / kiểm JWT (jose)     │
│  - không bao giờ đọc     │ ◄─────────────────────────────────────────  │  - hash mật khẩu (scrypt)   │
│    được token (HttpOnly) │   JSON / 204 / Set-Cookie                   │  - xoay vòng refresh token  │
└──────────┬───────────────┘                                             │  - OAuth2 với Google        │
           │ điều hướng toàn trang (Google login)                        └──────────┬─────────────────┘
           ▼                                                                        │ secret key (service role)
┌──────────────────────────┐                                             ┌──────────▼─────────────────┐
│  Google (OAuth2 / OIDC)  │ ◄──── đổi code lấy id_token (server→server) │  Supabase Postgres          │
└──────────────────────────┘                                             │  users, refresh_tokens,     │
                                                                         │  oauth_accounts,            │
                                                                         │  password_resets + RPC      │
                                                                         └────────────────────────────┘
```

Những quyết định thiết kế cốt lõi:

| Quyết định | Lý do |
|---|---|
| **Tự làm auth trong Express**, không dùng Supabase Auth | Toàn quyền kiểm soát luồng, role, cookie; Supabase chỉ là database (gọi bằng secret key phía server). |
| **Access token = JWT HS256, sống 15 phút** | Mỗi request chỉ cần kiểm chữ ký → không truy vấn DB (stateless, nhanh). |
| **Refresh token = chuỗi ngẫu nhiên 256 bit, sống 7 ngày, xoay vòng** | Thu hồi được (lưu DB), phát hiện bị đánh cắp (reuse detection). |
| **Cả hai token nằm trong cookie `HttpOnly`** | JavaScript (kể cả mã XSS) không đọc được token. |
| **CSRF chặn bằng `SameSite=Lax` + header tuỳ chỉnh + kiểm Origin** | Cookie tự động gửi kèm nên phải chống CSRF. |
| **Google login = OAuth 2.0 Authorization Code + PKCE + state + nonce** | Chuẩn an toàn nhất hiện nay cho web app. |
| **Role nằm trong JWT, kiểm ở middleware** | Không cần query DB cho mỗi request admin. |

---

## 2. Kiến thức nền

### 2.1 Authentication vs Authorization

- **Authentication (xác thực — "bạn là ai?")**: chứng minh danh tính. Ví dụ: nhập email + mật khẩu, đăng nhập Google. Sai → **401 Unauthorized** (tên gây nhầm, thực chất nghĩa là *unauthenticated*).
- **Authorization (phân quyền — "bạn được làm gì?")**: đã biết là ai, kiểm có quyền làm việc này không. Ví dụ: chỉ ADMIN vào `/admin`, user A không xem được giao dịch của user B. Sai → **403 Forbidden**.

Trong CashCash:
- `currentUser` middleware = authentication (→ 401 `UNAUTHENTICATED`).
- `requireRole('ADMIN')` = authorization theo role (→ 403 `FORBIDDEN`).
- Mỗi service lọc theo `req.userId` = authorization theo quyền sở hữu dữ liệu.

### 2.2 HTTP là stateless — vậy "đăng nhập" lưu ở đâu?

Mỗi request HTTP độc lập, server không tự nhớ bạn. Sau khi đăng nhập, client phải **gửi kèm một bằng chứng** ở mọi request. Có hai trường phái:

| | Session (stateful) | Token (stateless) |
|---|---|---|
| Client giữ | Session ID ngẫu nhiên (vô nghĩa) | Token tự chứa thông tin (JWT) |
| Server giữ | Bảng session trong DB/Redis | Chỉ giữ **khoá** để kiểm chữ ký |
| Mỗi request | Tra DB xem session còn không | Kiểm chữ ký + hạn, **không** tra DB |
| Thu hồi (logout, khoá tài khoản) | Xoá dòng → hiệu lực ngay | Khó: token còn hạn vẫn hợp lệ |
| Mở rộng nhiều server | Cần store chung | Dễ, chỉ cần chung khoá |

**CashCash dùng kết hợp**: access token là JWT (stateless, ngắn hạn), refresh token giống session (stateful, lưu DB, thu hồi được). Lấy ưu điểm của cả hai — đây là mô hình phổ biến nhất hiện nay.

> Lịch sử dự án: trước đây CashCash dùng session thuần (cookie `cashcash_session` + bảng `sessions`). Migration `20261017130000_refresh_tokens` đổi tên bảng `sessions` → `refresh_tokens`, xoá session cũ, thêm `familyId`, `revokedAt`, `replacedBy`.

### 2.3 Cookie và các thuộc tính quan trọng

Cookie là cặp `tên=giá trị` server gửi qua header `Set-Cookie`, trình duyệt **tự động** gửi lại qua header `Cookie` cho các request phù hợp.

| Thuộc tính | Ý nghĩa | CashCash |
|---|---|---|
| `HttpOnly` | JS (`document.cookie`) không đọc được | ✅ mọi cookie auth |
| `Secure` | Chỉ gửi qua HTTPS | ✅ khi `NODE_ENV=production` |
| `SameSite=Strict` | Không gửi trong mọi request cross-site | — |
| `SameSite=Lax` | Không gửi trong request cross-site **ngầm** (POST form, fetch, iframe, img); **có** gửi khi người dùng điều hướng top-level bằng GET (bấm link) | ✅ |
| `SameSite=None` | Luôn gửi (bắt buộc `Secure`) | — |
| `Path` | Chỉ gửi khi URL bắt đầu bằng path này | access `/`, refresh `/api/v1/auth` |
| `Max-Age` | Sống bao nhiêu giây; hết thì trình duyệt tự xoá | access 900s, refresh 7 ngày |

**"Site" khác "Origin"**: origin = scheme + host + port (`http://localhost:5173`); site ≈ scheme + domain đăng ký (`https://example.com` bao gồm cả `api.example.com`). `SameSite` xét theo *site*, CORS xét theo *origin*.

### 2.4 Lưu token ở đâu trên trình duyệt?

| Nơi lưu | XSS đọc được? | Tự gửi kèm (CSRF)? | Ghi chú |
|---|---|---|---|
| `localStorage` / `sessionStorage` | **Có** — XSS lấy được token, gửi về máy kẻ tấn công, dùng mãi tới khi hết hạn | Không | Dễ code nhưng rủi ro lớn |
| Biến JS trong RAM | Có (khi trang đang mở) | Không | Mất khi reload |
| **Cookie HttpOnly** | **Không** | **Có** → phải chống CSRF | CashCash chọn cách này |

XSS vẫn nguy hiểm với cookie HttpOnly (mã độc có thể *gửi request thay bạn* khi trang đang mở) nhưng **không đánh cắp được token** để dùng từ nơi khác. Đánh đổi: phải tự chống CSRF (mục 7.3).

---

## 3. JWT — JSON Web Token

### 3.1 JWT là gì?

JWT (RFC 7519) là một chuỗi **tự chứa thông tin** (self-contained) và **có chữ ký**, dùng để truyền "lời khẳng định" (claims) giữa hai bên. Ai cũng **đọc** được nội dung, nhưng chỉ người có khoá mới **tạo/sửa** được mà không bị phát hiện.

> ⚠️ JWT **không mã hoá** (đó là JWE). Payload chỉ là Base64URL — ai cầm token cũng decode được. **Không bao giờ để mật khẩu, số dư, thông tin nhạy cảm trong JWT.** CashCash chỉ để `sub` (user id) và `role`.

### 3.2 Cấu trúc: `header.payload.signature`

Ba phần, mỗi phần mã hoá **Base64URL** (Base64 thay `+`→`-`, `/`→`_`, bỏ `=`), nối bằng dấu chấm:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiVVNFUiIsInN1YiI6Ii4uLiJ9.3q2-7w...
└──────────── header ────────────┘ └──────────── payload ────────────┘ └ signature ┘
```

Ví dụ minh hoạ access token của CashCash (giá trị là ví dụ):

**Header** — tạo ở `jwt.ts` dòng `setProtectedHeader({ alg: 'HS256', typ: 'JWT' })`:
```json
{ "alg": "HS256", "typ": "JWT" }
```

**Payload (claims)**:
```json
{
  "role": "USER",                                  // claim riêng của CashCash
  "sub":  "3f1c2a9e-8b7d-4e21-9c55-0a1b2c3d4e5f",  // subject: user id
  "iss":  "cashcash-api",                          // issuer: ai phát hành
  "aud":  "cashcash-api",                          // audience: dành cho ai
  "iat":  1792233600,                              // issued at (giây Unix)
  "exp":  1792234500                               // expiration = iat + 900
}
```

**Signature**:
```
HMAC-SHA256( base64url(header) + "." + base64url(payload), JWT_SECRET )
```

Tự decode thử một token (trong DevTools → Application → Cookies → `cc_access`):
```js
JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
```
Bạn đọc được payload, nhưng nếu sửa `"role":"ADMIN"` rồi gửi lên, chữ ký không khớp → server trả 401.

### 3.3 Registered claims (claim chuẩn)

| Claim | Tên đầy đủ | Ý nghĩa | CashCash |
|---|---|---|---|
| `iss` | Issuer | Ai phát hành token | `env.JWT_ISSUER` (mặc định `cashcash-api`) |
| `sub` | Subject | Token nói về ai | user UUID |
| `aud` | Audience | Token dành cho dịch vụ nào | `cashcash-api` |
| `exp` | Expiration | Hết hạn lúc nào | `iat + ACCESS_TOKEN_TTL` |
| `iat` | Issued At | Phát hành lúc nào | thời điểm ký |
| `nbf` | Not Before | Chưa được dùng trước lúc này | không dùng |
| `jti` | JWT ID | ID duy nhất (để blacklist) | không dùng |

Kiểm `iss` + `aud` để token của **hệ thống khác** dùng chung khoá (hoặc id_token của Google) không bị chấp nhận nhầm.

### 3.4 Thuật toán ký: đối xứng vs bất đối xứng

| | HS256 (HMAC + SHA-256) | RS256 / ES256 (RSA / ECDSA) |
|---|---|---|
| Khoá | **Một** secret dùng chung để ký và kiểm | **Private key** ký, **public key** kiểm |
| Ai kiểm được | Chỉ ai có secret (= cũng ký được) | Bất kỳ ai có public key |
| Dùng khi | Một dịch vụ vừa phát vừa kiểm token | Bên phát khác bên kiểm |
| Ví dụ | **Access token CashCash** | **id_token của Google** (CashCash kiểm bằng public key Google lấy từ JWKS) |

CashCash tự phát và tự kiểm → HS256 là đủ và đơn giản. Google phát cho hàng triệu app → phải RS256, mỗi app tự kiểm bằng public key.

**JWKS (JSON Web Key Set)**: URL công khai chứa public key của issuer — Google ở `https://www.googleapis.com/oauth2/v3/certs`. Mỗi key có `kid`; header của id_token ghi `kid` nào đã ký. Thư viện `jose` (`createRemoteJWKSet`) tự tải, cache và chọn đúng key, tự tải lại khi Google xoay khoá.

### 3.5 Quá trình verify một JWT (đúng cách)

`verifyAccessToken` trong [backend/src/modules/auth/jwt.ts](../backend/src/modules/auth/jwt.ts):

```ts
const { payload } = await jwtVerify(token, key(), {
  algorithms: ['HS256'],          // 1. chỉ chấp nhận đúng thuật toán
  issuer: env.JWT_ISSUER,         // 2. đúng iss
  audience: 'cashcash-api',       // 3. đúng aud
  requiredClaims: ['sub', 'exp', 'iat'],
})                                // + jose tự kiểm chữ ký và exp
const claims = claimsSchema.safeParse(payload)  // 4. sub là UUID, role ∈ {USER, ADMIN}
```

Các bước:
1. Tách 3 phần, decode header.
2. **Ép thuật toán** từ phía server (`algorithms: ['HS256']`), *không tin* `alg` trong header.
3. Tính lại chữ ký với secret, so sánh với signature → khác là token bị sửa/giả.
4. Kiểm `exp` (hết hạn chưa), `iss`, `aud`.
5. Kiểm hình dạng claim (Zod) — phòng token "hợp lệ chữ ký" nhưng thiếu/ sai dữ liệu.
6. Mọi lỗi `JOSEError` → trả `null` (middleware biến thành 401). Lỗi khác (bug) → ném ra để không bị nuốt im lặng.

### 3.6 Các lỗ hổng JWT kinh điển — và CashCash chặn thế nào

| Lỗ hổng | Mô tả | Cách chặn trong code |
|---|---|---|
| **`alg: none`** | Kẻ tấn công đổi header thành `"alg":"none"`, bỏ chữ ký; thư viện ngây thơ chấp nhận | `algorithms: ['HS256']` |
| **Algorithm confusion** (RS256→HS256) | Server dùng public key RSA; kẻ tấn công ký HS256 bằng chính public key (công khai) | Ép thuật toán; với Google ép `['RS256']` |
| **Không kiểm `exp`** | Token cũ dùng mãi | `jose` kiểm `exp`, `requiredClaims` bắt buộc có `exp` |
| **Secret yếu** | Brute-force offline secret từ một token bất kỳ | `JWT_SECRET` tối thiểu 32 ký tự, khuyên 48 byte ngẫu nhiên (`env.ts`) |
| **Token cross-service** | Token của dịch vụ khác cùng khoá | Kiểm `iss` + `aud` |
| **Tin claim không kiểm** | Payload thiếu `sub` hay `role` lạ | Zod `claimsSchema` |
| **Đánh cắp qua XSS** | Token trong localStorage | Cookie HttpOnly |
| **Không thu hồi được** | Token lộ còn dùng tới khi hết hạn | TTL ngắn (15 phút) + refresh token thu hồi được |

### 3.7 Ưu và nhược của JWT

**Ưu**: stateless (không tra DB mỗi request), mang sẵn thông tin (user id, role), chuẩn hoá, thư viện mọi ngôn ngữ, phù hợp hệ phân tán.

**Nhược**: không thu hồi tức thời; thông tin trong token có thể **cũ** (đổi role thì token cũ vẫn ghi role cũ tới khi hết hạn); kích thước lớn hơn session ID; dễ dùng sai (các lỗ hổng ở trên).

→ Giải pháp chuẩn: **access token ngắn hạn + refresh token dài hạn thu hồi được**.

---

## 4. Access token + Refresh token

### 4.1 Vì sao cần hai loại token?

| | Access token (`cc_access`) | Refresh token (`cc_refresh`) |
|---|---|---|
| Dạng | JWT HS256 | 64 ký tự hex ngẫu nhiên (32 byte = 256 bit), **không phải JWT** |
| Thời hạn | `ACCESS_TOKEN_TTL` = 900s (15 phút), cho phép 60–3600 | 7 ngày (`REFRESH_MS`), tính từ lần làm mới gần nhất |
| Gửi kèm | **Mọi** request API (Path `/`) | **Chỉ** các route `/api/v1/auth/*` |
| Kiểm bằng | Chữ ký (không DB) | Tra bảng `refresh_tokens` |
| Server lưu | Không | Chỉ lưu **SHA-256** của token |
| Thu hồi | Không (chờ hết hạn ≤ 15 phút) | Có, ngay lập tức |

Ý tưởng: token đi kèm mọi request (dễ lộ hơn) thì **sống ngắn**; token sống dài thì **ít khi gửi** và **thu hồi được**.

Tại sao refresh token là chuỗi ngẫu nhiên, không phải JWT? Vì đằng nào cũng phải tra DB để kiểm thu hồi → không cần tự chứa thông tin; chuỗi ngẫu nhiên 256 bit đơn giản và không thể đoán.

Tại sao DB chỉ lưu hash ([refresh-token.ts](../backend/src/modules/auth/refresh-token.ts))? Nếu DB bị lộ (backup, SQL injection…), kẻ tấn công chỉ có hash, không dùng được để đăng nhập. Token có entropy 256 bit nên SHA-256 thường là đủ (không cần scrypt như mật khẩu — mật khẩu người đặt có entropy thấp nên mới cần hash chậm).

### 4.2 Rotation (xoay vòng)

Mỗi lần gọi `/auth/refresh`:
1. Refresh token cũ bị đánh dấu `revokedAt = now`, `replacedBy = hash mới`.
2. Cấp refresh token mới (cùng `familyId`) + access token mới.

Lợi ích: một refresh token **chỉ dùng được một lần**. Nếu bị đánh cắp, sẽ có lúc cả kẻ trộm và người dùng thật cùng dùng một token → phát hiện được.

### 4.3 Token family & reuse detection

`familyId` gom mọi token sinh ra từ **một lần đăng nhập** (một thiết bị/trình duyệt):

```
login ──► T1 ──refresh──► T2 ──refresh──► T3        (cùng familyId = F)
          revoked          revoked          active
```

Kịch bản trộm:
1. Kẻ gian lấy được T2, người dùng thật đã refresh sang T3 (T2 đã revoked).
2. Kẻ gian dùng T2 → DB thấy T2 **đã bị thu hồi từ lâu** → coi là **bị dùng lại (reused)** → **thu hồi toàn bộ family F** (kể cả T3).
3. Cả hai bên đều phải đăng nhập lại; kẻ gian không có mật khẩu → bị loại.

Ngược lại, nếu kẻ gian refresh trước (dùng T2 → T3'), lần sau người dùng thật dùng T2 → cũng bị phát hiện → huỷ cả family. Rotation biến việc đánh cắp thành thứ **tự lộ ra**.

### 4.4 Trường hợp đặc biệt: nhiều tab refresh cùng lúc (`stale`)

Hai tab cùng lúc thấy access token hết hạn và cùng gửi T2:
- Tab A tới trước → xoay T2 → T3, server ghi cookie mới.
- Tab B tới sau với T2 → T2 vừa revoked → nếu coi là "reused" thì người dùng bị đăng xuất oan.

Giải pháp trong `cashcash_refresh_rotate`: nếu token **đã được thay thế (`replacedBy` có giá trị) và mới revoked trong vòng 10 giây** → trả `stale`, **không** huỷ family. Controller trả `401 REFRESH_STALE` và **không xoá cookie** (cookie mới tab A nhận đã nằm trong trình duyệt, cookie dùng chung giữa các tab). Frontend coi `REFRESH_STALE` như thành công và gửi lại request — lần này mang cookie mới.

Ngoài ra `FOR UPDATE` khoá dòng token trong transaction để hai request song song không thể cùng xoay một token.

---

## 5. OAuth 2.0 và OpenID Connect

### 5.1 OAuth 2.0 giải quyết vấn đề gì?

OAuth 2.0 (RFC 6749) là chuẩn **ủy quyền (authorization)**: cho phép một ứng dụng truy cập tài nguyên của người dùng ở dịch vụ khác **mà không cần biết mật khẩu** của họ. Ví dụ "Cho phép app X đọc Google Drive của bạn".

Bản thân OAuth 2.0 **không phải giao thức đăng nhập** — nó cấp *access token* để gọi API, không nói "người này là ai". **OpenID Connect (OIDC)** là lớp xây trên OAuth 2.0 để **xác thực**: thêm scope `openid` và trả thêm **`id_token`** (một JWT chứa danh tính người dùng). "Đăng nhập bằng Google" thực chất là OIDC.

### 5.2 Các vai trò

| Vai trò | Trong CashCash |
|---|---|
| **Resource Owner** | Người dùng (chủ tài khoản Google) |
| **Client** | Backend CashCash (có `client_id` + `client_secret`) |
| **Authorization Server** | `accounts.google.com` (trang đăng nhập/đồng ý) + `oauth2.googleapis.com/token` |
| **Resource Server** | Google APIs — CashCash **không dùng**, chỉ cần `id_token` |

### 5.3 Các grant type (luồng)

| Grant | Dùng khi | Trạng thái |
|---|---|---|
| **Authorization Code (+ PKCE)** | Web app, mobile, SPA | ✅ Khuyến nghị — CashCash dùng |
| Implicit | SPA đời cũ, token trả thẳng trên URL | ❌ Lỗi thời, không dùng |
| Resource Owner Password | App nhập mật khẩu Google hộ | ❌ Bị loại bỏ |
| Client Credentials | Server ↔ server, không có người dùng | Dùng cho máy |
| Device Code | TV, thiết bị không bàn phím | Trường hợp riêng |
| Refresh Token | Lấy access token mới | Đi kèm các luồng trên |

### 5.4 Authorization Code flow

Ý tưởng: trình duyệt chỉ cầm một **code** ngắn hạn, dùng một lần; việc đổi code lấy token diễn ra **server ↔ server** kèm `client_secret` → token không bao giờ lộ trên URL hay trình duyệt.

```
Trình duyệt          CashCash API                    Google
    │ bấm "Đăng nhập Google"   │                          │
    │ GET /auth/google ───────►│                          │
    │◄── 302 tới Google ───────│ (client_id, redirect_uri, scope, state, nonce, code_challenge)
    │ ─────────────────────────────────────────────────► │ đăng nhập + đồng ý
    │◄──────────────────── 302 redirect_uri?code=…&state=…│
    │ GET /auth/google/callback?code&state ─►│            │
    │                          │ POST /token (code, code_verifier, client_secret) ─►│
    │                          │◄─────────────────────── { id_token, access_token } │
    │                          │ verify id_token, tạo/tìm user, cấp cookie CashCash │
    │◄── 302 về APP_URL + Set-Cookie ───│                 │
```

### 5.5 Ba "chốt an toàn": state, PKCE, nonce

Cả ba được sinh ngẫu nhiên 32 byte (base64url → 43 ký tự) trong `googleAuthorization()` ([google.ts](../backend/src/modules/auth/google.ts)) và lưu trong cookie `cc_google_flow` dạng `state.verifier.nonce`.

**`state` — chống CSRF trên callback / login CSRF**
- Gửi `state` lên Google, Google trả lại y nguyên ở callback.
- Server so `state` trên URL với `state` trong cookie (so bằng `timingSafeEqual`).
- Nếu không có: kẻ tấn công đăng nhập Google bằng tài khoản **của hắn**, lấy `code`, rồi lừa nạn nhân mở `…/callback?code=<code_của_hắn>` → nạn nhân bị đăng nhập vào tài khoản kẻ tấn công và nhập dữ liệu tài chính vào đó (*login CSRF*). Có `state` thì nạn nhân không có cookie khớp → bị từ chối (`google_state`).

**PKCE (Proof Key for Code Exchange, RFC 7636) — chống đánh cắp code**
- Sinh `code_verifier` bí mật; gửi lên Google chỉ `code_challenge = BASE64URL(SHA256(verifier))`, `code_challenge_method=S256`.
- Khi đổi code, gửi `code_verifier` thật. Google tính lại SHA-256 và so.
- Kẻ chặn được `code` (qua log, history, Referer, app độc trên mobile) không có `verifier` → không đổi được. Ban đầu PKCE dành cho public client (không có secret), nay **khuyến nghị cho mọi client** (OAuth 2.1). CashCash dùng cả `client_secret` lẫn PKCE.

**`nonce` — chống replay id_token**
- Gửi `nonce` lên Google, Google nhúng nó vào `id_token`.
- Server kiểm `payload.nonce === nonce trong cookie` → id_token này được tạo **cho đúng lượt đăng nhập này**, không phải id_token cũ bị phát lại.

Cookie flow là **dùng một lần**: callback xoá nó ngay đầu hàm, dù thành công hay thất bại. Sống tối đa 10 phút, Path `/api/v1/auth/google`.

Vì sao cookie flow dùng `SameSite=Lax` chứ không `Strict`? Callback là một điều hướng **top-level GET từ trang Google** (cross-site). `Strict` sẽ không gửi cookie trong trường hợp này → luôn lỗi `google_state`. `Lax` cho phép đúng kiểu điều hướng này.

### 5.6 id_token vs access_token của Google

| | `id_token` | `access_token` (Google) |
|---|---|---|
| Dạng | JWT RS256 | Chuỗi mờ (opaque) |
| Mục đích | **Ai** đăng nhập (OIDC) | Gọi Google API |
| Đối tượng (`aud`) | `client_id` của CashCash | Google APIs |
| CashCash | ✅ Dùng, verify kỹ | ❌ Không dùng, không lưu |

Không lưu thứ không dùng = giảm bề mặt tấn công.

### 5.7 Kiểm id_token (`verifyGoogleIdToken`)

```ts
jwtVerify(idToken, googleKeys(), {
  algorithms: ['RS256'],                                       // ép thuật toán
  issuer: ['https://accounts.google.com', 'accounts.google.com'], // Google dùng cả 2 dạng
  audience: env.GOOGLE_CLIENT_ID,                              // token phải cấp cho CashCash
  requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
  clockTolerance: 30,                                          // chịu lệch đồng hồ 30s
})
if (payload.nonce !== nonce)        → google_failed
if (payload.email_verified !== true) → google_email_unverified
Zod: sub (1–255), email hợp lệ, name (tuỳ chọn, cắt 80)
```

**Dùng `sub` chứ không dùng `email` làm định danh Google**: email có thể đổi, `sub` là ID vĩnh viễn duy nhất của tài khoản Google. Bảng `oauth_accounts` có unique `(provider, providerUserId)`.

**Bắt buộc `email_verified`**: vì CashCash liên kết tài khoản Google vào user có **cùng email**. Nếu chấp nhận email chưa xác minh, ai đó tạo tài khoản Google gắn email của nạn nhân (chưa xác minh) có thể chiếm tài khoản CashCash của nạn nhân.

### 5.8 Scope

`scope: 'openid email profile'`:
- `openid` — bật OIDC, nhận `id_token`.
- `email` — nhận `email`, `email_verified`.
- `profile` — nhận `name` (và ảnh, CashCash không dùng).

Nguyên tắc **least privilege**: chỉ xin đúng thứ cần. `prompt: 'select_account'` buộc Google hiện màn chọn tài khoản (tiện khi máy có nhiều tài khoản Google).

---

## 6. Backend: bản đồ file

```
backend/src/
├── app.ts                              # dựng pipeline: helmet, cors, chống CSRF, /auth, currentUser, apiRouter
├── routes.ts                           # apiRouter (mọi route cần đăng nhập), gắn /admin
├── config/env.ts                       # validate JWT_SECRET, TTL, Google, SMTP… (sai → thoát)
├── types/express.d.ts                  # khai báo req.userId, req.role
├── lib/supabase.ts                     # client Supabase dùng secret key (server-only)
├── middlewares/
│   ├── current-user.ts                 # verify access token → req.userId, req.role (401)
│   ├── require-role.ts                 # requireRole('ADMIN') (403)
│   └── rate-limit.ts                   # giới hạn số lần thử trong 15 phút (429)
└── modules/
    ├── auth/
    │   ├── auth.routes.ts              # định nghĩa route /api/v1/auth/* + rate limit
    │   ├── auth.controller.ts          # xử lý HTTP: cookie, redirect, status code
    │   ├── auth.service.ts             # nghiệp vụ: register, login, refresh, logout, googleLogin
    │   ├── auth.cookie.ts              # tên + option cookie, đọc/ghi/xoá cookie
    │   ├── jwt.ts                      # signAccessToken / verifyAccessToken
    │   ├── refresh-token.ts            # sinh refresh token, hash SHA-256
    │   ├── google.ts                   # OAuth2/OIDC: URL authorize, đổi code, verify id_token
    │   ├── password.ts                 # scrypt hash/verify
    │   ├── password-reset.service.ts   # quên mật khẩu: OTP → reset token → đổi mật khẩu
    │   └── password-reset.mail.ts      # gửi email OTP (nodemailer)
    ├── users/                          # PATCH /users/me, POST /users/me/password
    └── admin/admin.routes.ts           # /admin/* (requireRole ADMIN)

backend/db/
├── migrations/20261017120000_user_role/       # cột role + trigger bảo vệ + cashcash_set_role
├── migrations/20261017130000_refresh_tokens/  # sessions → refresh_tokens, RPC rotate/revoke
├── migrations/20261017140000_oauth_accounts/  # bảng oauth_accounts + cashcash_oauth_login
└── promote-admins.ts                          # npm run db:admins

packages/shared/src/
├── schemas/auth.schema.ts              # Zod: login, register, forgot, verify OTP, reset; type AuthUser
└── enums.ts                            # USER_ROLES = ['USER', 'ADMIN']
```

Phân tầng: **routes** (URL + middleware) → **controller** (HTTP: parse input, cookie, status) → **service** (nghiệp vụ) → **RPC Postgres** (thay đổi nhiều bảng trong một transaction).

---

## 7. Backend: pipeline middleware

[backend/src/app.ts](../backend/src/app.ts) — thứ tự quan trọng:

```
request
  │
  ├─ helmet()                     header bảo mật (HSTS, X-Content-Type-Options, CSP mặc định…)
  ├─ cors({ origin: CORS_ORIGIN, credentials: true })
  ├─ express.json({ limit: '100kb' })
  ├─ requestLogger (trừ test)
  ├─ GET /health
  │
  ├─ /api/v1  chống CSRF: method ≠ GET/HEAD/OPTIONS phải có
  │           X-CashCash-Request: 1  và  Origin (nếu có) ∈ CORS_ORIGIN    → không thì 403 INVALID_ORIGIN
  │
  ├─ /api/v1/auth   → authRouter        (KHÔNG qua currentUser: login/register/refresh… là public)
  │                    ├─ rateLimit theo route
  │                    └─ controller
  │
  ├─ /api/v1        → currentUser → apiRouter
  │                    (mọi route còn lại bắt buộc access token hợp lệ)
  │                    └─ /admin → requireRole('ADMIN') → adminRouter
  │
  ├─ notFoundHandler
  └─ errorHandler   (HttpError → JSON { error: { code, message, details } })
```

### 7.1 `currentUser` — xác thực mỗi request

```ts
const claims = await verifyAccessToken(accessToken(req))  // đọc cookie cc_access
if (!claims) throw new HttpError(401, 'UNAUTHENTICATED', ...)
req.userId = claims.sub
req.role = claims.role
```

- **Không truy vấn DB** → nhanh. Hệ quả: user bị xoá/đổi role/đăng xuất ở nơi khác thì access token cũ vẫn hợp lệ tối đa `ACCESS_TOKEN_TTL` (chấp nhận được với 15 phút).
- `req.userId`, `req.role` chỉ lấy từ token server ký — **không bao giờ** từ body/query của client ([express.d.ts](../backend/src/types/express.d.ts)).

### 7.2 Đọc cookie

Dự án không dùng `cookie-parser`; `readCookie` trong [auth.cookie.ts](../backend/src/modules/auth/auth.cookie.ts) tự tách header `Cookie` theo `;`. Ghi cookie dùng `res.cookie()` có sẵn của Express.

### 7.3 Chống CSRF — ba lớp

**CSRF (Cross-Site Request Forgery)**: trang độc `evil.com` khiến trình duyệt của bạn gửi request tới CashCash; vì cookie tự động đi kèm, server tưởng chính bạn gửi.

| Lớp | Cơ chế | Chặn được gì |
|---|---|---|
| 1. `SameSite=Lax` | Cookie không đi kèm POST/fetch cross-site | Phần lớn CSRF ở trình duyệt hiện đại |
| 2. Header `X-CashCash-Request: 1` | Form HTML không thể đặt header tuỳ chỉnh; `fetch` cross-origin có header tuỳ chỉnh → trình duyệt gửi **preflight OPTIONS**, CORS không cho origin lạ → request thật không được gửi | Form POST, fetch từ origin lạ, trình duyệt cũ không hỗ trợ SameSite |
| 3. Kiểm `Origin` | Nếu có header `Origin` thì phải nằm trong `CORS_ORIGIN` | Phòng thủ bổ sung, kể cả subdomain cùng site |

Chỉ áp cho method thay đổi trạng thái. Hệ quả bắt buộc: **mọi route GET phải không có tác dụng phụ** (logout là POST chứ không phải GET). `GET /auth/google` chỉ đặt cookie flow và redirect — vô hại. `GET /auth/google/callback` được bảo vệ bằng `state`.

### 7.4 CORS với `credentials: true`

Cho phép frontend ở origin khác gửi cookie và đọc response. Khi `credentials: true`, CORS **không được** dùng `*` mà phải liệt kê origin cụ thể — `env.ts` validate `CORS_ORIGIN` là danh sách origin hợp lệ không có path. Lúc dev, frontend gọi qua **proxy Vite** (`/api` → `localhost:4000`) nên thực chất cùng origin.

### 7.5 Rate limit

[rate-limit.ts](../backend/src/middlewares/rate-limit.ts): cửa sổ cố định 15 phút, đếm trong RAM theo `bucket:key`.

| Bucket | Route | Giới hạn / 15 phút | Khoá |
|---|---|---|---|
| `credentials` | login, register, forgot-password, verify-reset-otp, reset-password (chung một bộ đếm) | 20 | IP |
| `refresh` | /auth/refresh | 120 (mỗi tab refresh ~1 lần / TTL) | IP |
| `google` | /auth/google/callback | 20 | IP |
| `password` | POST /users/me/password | 10 | **userId** |

Đổi mật khẩu đếm theo userId: kẻ có access token bị lộ không thể đổi IP để dò mật khẩu hiện tại. Khi bảng đếm đầy 10.000 khoá → mọi request bị 429 (**fail closed**, chống tấn công làm tràn RAM).

---

## 8. Backend: cookie

| Cookie | Nội dung | Path | Max-Age | HttpOnly | SameSite | Secure |
|---|---|---|---|---|---|---|
| `cc_access` | JWT HS256 `{ sub, role, iss, aud, iat, exp }` | `/` | `ACCESS_TOKEN_TTL` (900s) | ✅ | Lax | prod |
| `cc_refresh` | 64 hex ngẫu nhiên | `/api/v1/auth` | 7 ngày | ✅ | Lax | prod |
| `cc_google_flow` | `state.verifier.nonce` | `/api/v1/auth/google` | 10 phút | ✅ | Lax | prod |

- `cc_access` hết `Max-Age` thì trình duyệt tự xoá → request tiếp theo không có cookie → 401 → frontend refresh. Max-Age trùng `exp` của JWT.
- `cc_refresh` **Path hẹp**: không đi kèm hàng trăm request `/transactions`, `/summary`… → giảm khả năng lộ qua log/proxy. Nó vẫn tới `/auth/login`, `/auth/register`, `/auth/google/callback` để server **thu hồi family cũ** của trình duyệt khi đăng nhập lại (xem 10.2).
- `clearCookie` phải truyền **đúng Path** như lúc set, nếu không trình duyệt coi là cookie khác và không xoá — vì vậy `clearAuthCookies` dùng lại `accessCookieOptions`, `refreshCookieOptions`.

---

## 9. Backend: database & RPC

### 9.1 Bảng liên quan

**`users`**
| Cột | Ghi chú |
|---|---|
| `id` UUID | `sub` trong JWT |
| `email` | unique, luôn lowercase (Zod `transform`) |
| `passwordHash` | `scrypt$salt$digest`, **NULL** với user tạo bằng Google chưa đặt mật khẩu |
| `role` | `'USER' \| 'ADMIN'`, CHECK constraint, default `USER`, có trigger bảo vệ |
| `displayName`, `avatar` | hồ sơ |

**`refresh_tokens`**
| Cột | Ghi chú |
|---|---|
| `tokenHash` (PK) | SHA-256 hex của refresh token |
| `userId` | FK users |
| `familyId` | gom token của một lần đăng nhập |
| `expiresAt` | hạn 7 ngày |
| `revokedAt` | NULL = còn hiệu lực |
| `replacedBy` | hash token kế tiếp (có = đã xoay vòng; NULL mà revoked = logout/huỷ) |
| `createdAt` | |

**`oauth_accounts`**: `provider` ('google'), `providerUserId` (= `sub` Google), `userId`, `email`. Unique `(provider, providerUserId)`.

**`password_resets`**: `userId`, `tokenHash`, `otpHash` (scrypt của OTP; NULL sau khi OTP đã xác thực), `expiresAt`, `attempts`.

Mọi bảng bật **RLS** (Row Level Security) không có policy cho `anon`/`authenticated` → không ai gọi trực tiếp Data API của Supabase bằng anon key được. Chỉ backend dùng **secret key (service role)**. Mọi RPC auth đều `REVOKE ... FROM PUBLIC, anon, authenticated` và `GRANT ... TO service_role`, `SET search_path = ''` (chống tấn công đổi search_path).

### 9.2 Vì sao dùng RPC (function Postgres)?

Nhiều bước phải **cùng thành công hoặc cùng thất bại** (transaction) và **không bị race condition** (khoá dòng). Supabase Data API (REST) không có transaction nhiều lệnh, nên gói vào function PL/pgSQL.

| RPC | Làm gì |
|---|---|
| `cashcash_register` | Insert user (role luôn `USER`) + ví & danh mục mặc định + refresh token (family mới) |
| `cashcash_session_create` | Khoá user `FOR UPDATE`, kiểm `passwordHash` **chưa đổi** từ lúc verify, dọn token hết hạn, tạo refresh token family mới |
| `cashcash_refresh_rotate` | Khoá token `FOR UPDATE` → trả `invalid / stale / reused / expired / ok`; `reused` thì huỷ cả family; `ok` thì tạo token mới cùng family, đánh dấu token cũ |
| `cashcash_refresh_revoke` | Logout: huỷ cả family chứa token |
| `cashcash_change_password` | Kiểm hash cũ khớp, đổi mật khẩu, **huỷ mọi** refresh token của user, tạo token mới cho thiết bị hiện tại |
| `cashcash_oauth_login` | linked / attached / created (mục 10.7) + refresh token family mới |
| `cashcash_reset_issue` / `_fail` / `_verify` / `_consume` | Các bước quên mật khẩu; `_consume` đổi mật khẩu và huỷ mọi refresh token |
| `cashcash_set_role` | Cách duy nhất đổi role |

### 9.3 Logic `cashcash_refresh_rotate` (trái tim của refresh)

```
tìm token theo hash (FOR UPDATE)
├─ không có                                         → invalid
├─ đã revoked
│   ├─ replacedBy ≠ NULL và revoked < 10 giây trước → stale   (tab khác vừa refresh)
│   └─ ngược lại                                    → huỷ cả family, reused  (nghi bị trộm)
├─ hết hạn                                          → expired
├─ user không tồn tại                               → invalid
└─ ok: insert token mới (cùng familyId, hạn mới 7 ngày)
       update token cũ: revokedAt = now, replacedBy = hash mới
       trả user_id + role (role đọc MỚI từ DB → đổi role có hiệu lực ở lần refresh kế)
```

---

## 10. Các luồng chi tiết

Bảng API (`/api/v1/auth`):

| Method & path | Input | Thành công | Lỗi thường gặp |
|---|---|---|---|
| `POST /register` | `{ displayName, email, password }` | `201` AuthUser + 2 cookie | 400 validate, 409 email trùng, 429 |
| `POST /login` | `{ email, password }` | `200` AuthUser + 2 cookie | 401 `INVALID_CREDENTIALS`, 429 |
| `POST /refresh` | cookie `cc_refresh` | `204` + 2 cookie mới | 401 `REFRESH_STALE` (giữ cookie), 401 `UNAUTHENTICATED` (xoá cookie) |
| `POST /logout` | cookie `cc_refresh` | `204`, xoá cookie | — |
| `GET /me` | cookie `cc_access` | `200` AuthUser | 401 |
| `GET /google` | — | `302` tới Google | `302 /login?error=google_unavailable` |
| `GET /google/callback` | `code`, `state` (Google gắn) | `302 APP_URL/` + cookie | `302 /login?error=…` |
| `POST /forgot-password` | `{ email }` | `202` (luôn) | 503 `MAIL_BUSY`, 429 |
| `POST /verify-reset-otp` | `{ email, otp }` | `200 { token }` | 400 OTP sai/hết hạn/quá 5 lần |
| `POST /reset-password` | `{ token, password }` | `204`, xoá cookie | 400 phiên không hợp lệ |

Ngoài `/auth`: `POST /users/me/password` (đổi/đặt mật khẩu), `PATCH /users/me` (hồ sơ), `GET /admin/ping` (ADMIN).

`AuthUser` trả về client: `{ id, email, displayName, avatar, role, hasPassword }` — **không bao giờ** có `passwordHash` (`toAuthUser` tách ra, chỉ để lại `hasPassword` boolean).

### 10.1 Đăng ký

```
Frontend                                Backend                                   DB
 Zod registerSchema (client) ──POST /auth/register──►
                                parseInput(registerSchema)   (validate lại ở server!)
                                hashPassword (scrypt)
                                newRefreshToken() → token, hash, expiresAt
                                rpc cashcash_register ───────────────────────► users + ví/danh mục + refresh_tokens
                                    23505 (unique email) → 409 "Email đã được sử dụng"
                                logout(cookie refresh cũ nếu có)
                                signAccessToken({ sub, role: 'USER' })
                                Set-Cookie cc_access, cc_refresh
 ◄──────────────── 201 AuthUser ──
 xoá cache riêng tư, setQueryData(AUTH_KEY, user), navigate('/')
```

Validate **ở cả hai phía** bằng chung schema `@cashcash/shared`: client để báo lỗi nhanh, server vì client không đáng tin (có thể gọi API bằng curl). Role **không** nhận từ client — RPC hard-code `'USER'`, trigger cũng ép `USER` khi insert.

### 10.2 Đăng nhập bằng mật khẩu

```ts
// auth.service.ts
const user = select ... where email = input.email
const valid = await verifyPassword(input.password, user?.passwordHash ?? null)
if (!user || !valid) throw invalidCredentials()          // cùng một thông báo
rpc cashcash_session_create(p_expected_hash = user.passwordHash, ...)
if (!created) throw invalidCredentials()                 // mật khẩu vừa bị đổi giữa chừng
```

Điểm đáng chú ý:
- **Chống dò email (user enumeration)**: email không tồn tại hay sai mật khẩu đều trả cùng `401 "Email hoặc mật khẩu không đúng"`. Hơn nữa `verifyPassword` **vẫn chạy scrypt** khi user không tồn tại (dùng salt giả) → thời gian phản hồi như nhau, không đoán được email có tồn tại qua độ trễ.
- **Race condition**: giữa lúc verify mật khẩu và lúc tạo phiên, mật khẩu có thể vừa được đổi (ở thiết bị khác). `p_expected_hash` + `FOR UPDATE` đảm bảo chỉ tạo phiên nếu hash vẫn là hash đã kiểm.
- User Google chưa đặt mật khẩu (`passwordHash = NULL`) → `verifyPassword` trả false → không đăng nhập bằng mật khẩu được.
- Controller gọi `authService.logout(refreshToken(req))` **trước khi** set cookie mới: nếu trình duyệt đang giữ refresh token của phiên cũ (ví dụ đăng nhập tài khoản khác), family cũ bị huỷ thay vì bị bỏ rơi trong DB.

### 10.3 Request đã đăng nhập (ví dụ `GET /transactions`)

```
trình duyệt tự gửi Cookie: cc_access=<jwt>      (cc_refresh KHÔNG đi kèm vì Path)
 → currentUser: verify chữ ký + exp + iss + aud → req.userId, req.role
 → controller/service: mọi query đều .eq('userId', req.userId)
```

Không có truy vấn DB nào để xác thực.

### 10.4 Access token hết hạn → refresh tự động

```
Frontend http.ts                          Backend
GET /summary ───────────────────────────► currentUser: không có cookie/hết hạn → 401
refreshSession()  (single-flight)
POST /auth/refresh  (Cookie cc_refresh) ─► isRefreshToken? → rpc cashcash_refresh_rotate
                                           ok    → Set-Cookie 2 token mới, 204, Cache-Control: no-store
                                           stale → 401 REFRESH_STALE, KHÔNG xoá cookie
                                           invalid/expired/reused → xoá cookie, 401 UNAUTHENTICATED
'refreshed' → gửi lại GET /summary (retried = true) ─► 200
'failed'    → ném ApiError 401, phát sự kiện 'auth-expired' → về /login
```

`isRefreshToken` kiểm regex `^[a-f0-9]{64}$` trước khi chạm DB → cookie rác không tốn query.

### 10.5 Đăng xuất

`POST /auth/logout` → `cashcash_refresh_revoke` huỷ **family** của token hiện tại (chỉ thiết bị này, các thiết bị khác vẫn đăng nhập) → xoá 2 cookie → frontend xoá cache dữ liệu riêng tư.

Lưu ý: nếu ai đó đã sao chép được access token, nó vẫn dùng được tới khi hết hạn (≤ 15 phút) — giới hạn cố hữu của JWT stateless.

### 10.6 `GET /auth/me`

```ts
const claims = await verifyAccessToken(accessToken(req))
const user = claims && await authService.findUser(claims.sub)   // có truy vấn DB
if (!user) throw expired()
```

Khác `currentUser`, `/me` **đọc DB** để trả hồ sơ mới nhất (tên, avatar, role, hasPassword). Frontend dùng nó để biết "đang đăng nhập là ai" lúc mở app. `/me` không nằm trong danh sách `NO_REFRESH` nên nếu access token hết hạn, frontend tự refresh rồi gọi lại.

### 10.7 Đăng nhập Google (chi tiết)

**Bước 1 — `GET /auth/google`** (`googleStart`)
1. `Cache-Control: no-store` (redirect chứa state, không được cache).
2. Chưa cấu hình đủ 3 biến Google → `302 /login?error=google_unavailable`.
3. Sinh `state`, `verifier`, `nonce`; set cookie `cc_google_flow`.
4. `302` tới `https://accounts.google.com/o/oauth2/v2/auth?client_id=…&redirect_uri=…&response_type=code&scope=openid email profile&state=…&nonce=…&code_challenge=…&code_challenge_method=S256&prompt=select_account`.

**Bước 2 — người dùng đăng nhập/đồng ý ở Google**, Google redirect về `GOOGLE_REDIRECT_URI?code=…&state=…` (hoặc `?error=access_denied` nếu bấm huỷ).

**Bước 3 — `GET /auth/google/callback`** (`googleCallback`)
```
flow = đọc cookie cc_google_flow;  xoá cookie ngay (dùng một lần)
kiểm Google đã bật                          → google_unavailable
state trên URL khớp flow.state (timingSafe) → google_state
?error=access_denied                        → google_denied   (lỗi khác → google_failed)
có code                                     → google_code
exchangeGoogleCode(code, verifier)          POST oauth2.googleapis.com/token, timeout 10s
verifyGoogleIdToken(id_token, nonce)        chữ ký JWKS, RS256, iss, aud, exp, nonce, email_verified
authService.googleLogin(profile)            rpc cashcash_oauth_login
logout(refresh cũ), setAuthCookies
302 APP_URL/
```
Mọi lỗi → `302 APP_URL/login?error=<code>`; frontend dịch mã lỗi thành thông báo tiếng Việt (`GOOGLE_ERRORS` trong `auth-page.tsx`). Chỉ lỗi không xác định (`google_failed`) mới được log ra console server.

**Bước 4 — `cashcash_oauth_login` quyết định user**:

| Trường hợp | outcome | Hành động |
|---|---|---|
| `(google, sub)` đã có trong `oauth_accounts` | `linked` | Đăng nhập user đó; cập nhật email nếu Google email đổi |
| Chưa liên kết, nhưng có user cùng email | `attached` | Liên kết Google vào user đó (user giữ nguyên mật khẩu cũ) |
| Không có gì | `created` | Tạo user mới `passwordHash = NULL` + ví/danh mục mặc định, liên kết |

Sau đó luôn tạo refresh token family mới.

Về `attached`: liên kết theo email an toàn vì (1) Google đã xác minh email, (2) người kiểm soát hộp thư đó vốn đã có thể đặt lại mật khẩu CashCash qua OTP email.

**Vì sao nút Google là thẻ `<a href>` chứ không phải `fetch`?** OAuth cần **điều hướng toàn trang** sang domain Google (fetch không thể hiển thị trang đăng nhập Google và CORS cũng chặn). Callback cũng là điều hướng toàn trang, trả `302` kèm `Set-Cookie`, nên cookie nằm sẵn khi SPA tải lại ở `/`.

**Vì sao dev dùng `GOOGLE_REDIRECT_URI=http://localhost:5173/api/v1/auth/google/callback`** (cổng của Vite chứ không phải 4000)? Để callback đi qua proxy Vite → cookie được set cho origin `localhost:5173`, cùng origin với web app.

### 10.8 Quên mật khẩu (OTP qua email)

Ba bước, mỗi bước là một request:

```
① POST /forgot-password { email }
   → trả 202 NGAY, trước khi tra user hay gửi mail (queuePasswordReset + setImmediate)
   → nền: user tồn tại VÀ có passwordHash?
          sinh OTP 6 số (randomInt), lưu scrypt(OTP), tokenHash, hạn 10 phút (cashcash_reset_issue)
          gửi email; gửi lỗi → xoá bản ghi
② POST /verify-reset-otp { email, otp }
   → lấy bản ghi mới nhất còn otpHash; hết hạn hoặc attempts ≥ 5 → 400
   → OTP sai → cashcash_reset_fail (attempts++) → 400
   → OTP đúng → sinh reset token 64 hex mới, cashcash_reset_verify (otpHash = NULL, đổi tokenHash, hạn 10 phút mới)
   → 200 { token }   (Cache-Control: no-store)
③ POST /reset-password { token, password }
   → bản ghi phải tồn tại, otpHash = NULL (đã qua bước ②), chưa hết hạn
   → cashcash_reset_consume: đổi mật khẩu, xoá mọi reset của user, HUỶ MỌI refresh token
   → xoá cookie trình duyệt hiện tại, 204 → người dùng đăng nhập lại bằng mật khẩu mới
```

Các điểm bảo mật:
- **Không lộ email có tồn tại**: luôn 202 với cùng thông điệp; thời gian phản hồi không phụ thuộc việc tra DB/gửi SMTP vì việc đó chạy nền. Hàng đợi tối đa 10 job (quá → 503 `MAIL_BUSY`) để không bị lợi dụng spam/DoS.
- OTP 6 số chỉ có 1 triệu khả năng → **giới hạn 5 lần thử** + hạn 10 phút + rate limit IP. OTP lưu dạng **scrypt hash**.
- Tách OTP và reset token: OTP (ngắn, dễ gõ) chỉ để đổi lấy token dài 256 bit; token mới dùng để đổi mật khẩu → OTP không bao giờ đủ để tự đổi mật khẩu nếu chưa qua bước kiểm attempts.
- Không log nội dung email, OTP, token.
- User chỉ đăng nhập Google (`passwordHash = NULL`) không nhận OTP; họ đặt mật khẩu trong trang Cá nhân.

### 10.9 Đổi / đặt mật khẩu khi đang đăng nhập

`POST /users/me/password` (qua `currentUser`, rate limit 10 lần/15 phút **theo userId**):
- Đã có mật khẩu → bắt buộc `currentPassword` đúng.
- Tài khoản Google chưa có mật khẩu → **đặt lần đầu**, không cần mật khẩu cũ.
- `cashcash_change_password`: kiểm hash vẫn là hash đã đọc (chống race), đổi mật khẩu, **huỷ mọi refresh token** (đăng xuất mọi thiết bị khác), tạo token mới cho thiết bị đang dùng → set cookie mới, người dùng không bị đá ra.
- Frontend: toast "Các thiết bị khác đã bị đăng xuất", cập nhật `hasPassword: true` trong cache.

---

## 11. Hash mật khẩu

[password.ts](../backend/src/modules/auth/password.ts):

```ts
scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 MB })
// lưu: "scrypt$<salt 16 byte hex>$<digest 64 byte hex>"
```

- **Không bao giờ lưu mật khẩu thô hoặc mã hoá được**. Lưu **hash một chiều**.
- **Salt ngẫu nhiên** mỗi user: hai người cùng mật khẩu có hash khác nhau; vô hiệu hoá rainbow table.
- **Hash chậm có chủ đích (KDF)**: scrypt tốn CPU **và RAM** (N=2^15, r=8 → ~32 MB mỗi lần) → brute-force bằng GPU/ASIC rất đắt. SHA-256 thuần quá nhanh, không phù hợp cho mật khẩu. Các lựa chọn tương đương: Argon2id, bcrypt.
- Định dạng có tiền tố `scrypt$` để sau này đổi thuật toán vẫn nhận biết được hash cũ.
- **`timingSafeEqual`**: so sánh thời gian hằng, không dừng ở byte khác đầu tiên → không đoán dần được digest qua thời gian.
- **Luôn tính scrypt trước khi kiểm định dạng** (kể cả `hash` null) → thời gian đăng nhập như nhau dù email có tồn tại hay không.

---

## 12. Phân quyền theo role (USER / ADMIN)

### 12.1 Nguồn sự thật

```
DB users.role ──(đọc khi login/refresh/google)──► JWT claim "role" ──► req.role ──► requireRole
```

- **Gán role**: chỉ qua `cashcash_set_role`. Trigger `users_guard_role` chặn mọi `INSERT`/`UPDATE` khác: insert bị ép `USER`, update cột role mà không qua function → lỗi `42501`. Phòng trường hợp code tương lai lỡ spread `req.body` vào update.
- **Nâng ADMIN**: điền `ADMIN_EMAILS=a@x.com,b@y.com` trong `backend/.env`, user phải đăng ký trước, rồi `npm run db:admins -w @cashcash/api`.
- **Kiểm quyền**: `adminRouter.use(requireRole('ADMIN'))`; sai → 403.

### 12.2 Độ trễ khi đổi role

Role nằm trong JWT → đổi role trong DB **chưa có hiệu lực** cho tới khi access token được làm mới (≤ `ACCESS_TOKEN_TTL`, vì `cashcash_refresh_rotate` đọc role mới từ DB). Muốn thu hồi quyền ADMIN ngay: hạ role + huỷ refresh token của user đó; access token cũ vẫn còn tối đa 15 phút. Nếu cần tức thời, có thể cho `requireRole` tra DB (đánh đổi hiệu năng) — xem mục 17.

### 12.3 Frontend chỉ để hiển thị

`isAdmin(user)` và `AdminGate` chỉ **ẩn/hiện giao diện**. Ai sửa JS trên trình duyệt để hiện trang admin cũng chỉ thấy khung trống vì API trả 403. **Quyền thật luôn ở server.** Trang Admin gọi `/admin/ping` để xác nhận.

---

## 13. Frontend

### 13.1 `http.ts` — lớp gọi API

[frontend/src/lib/http.ts](../frontend/src/lib/http.ts)

- `credentials: 'include'` → trình duyệt gửi cookie HttpOnly. Frontend **không bao giờ** chạm vào token.
- Mọi method ≠ GET tự thêm `X-CashCash-Request: 1` (để qua lớp chống CSRF).
- **Tự refresh khi gặp 401**:
  ```ts
  if (response.status === 401 && !retried && !NO_REFRESH.includes(path)) {
    const outcome = await refreshSession()
    if (outcome === 'refreshed') return request(method, path, options, true)   // thử lại đúng 1 lần
    if (outcome === 'offline')   throw NETWORK_ERROR
  }
  ```
- **`NO_REFRESH`**: các route mà 401 là *kết quả thật* (sai mật khẩu ở `/auth/login`…) hoặc chính là route refresh → không refresh, tránh vòng lặp vô hạn.
- **Single-flight**: biến module `refreshing` giữ một Promise duy nhất. Trang Tổng quan có thể bắn 5 request cùng lúc, cả 5 bị 401 → chỉ **một** `POST /auth/refresh`, cả 5 chờ chung rồi cùng gửi lại. Không có nó, 5 refresh song song sẽ xoay 1 token 5 lần → 4 lần sau bị coi là reused/stale.
- `REFRESH_STALE` → coi như `refreshed` (tab khác vừa làm mới, cookie mới đã có).
- Refresh thất bại → request ban đầu ném `ApiError 401`, và nếu path không thuộc `/auth/` → `window.dispatchEvent(new Event('auth-expired'))`.
- Lỗi mạng khi refresh → `'offline'` → báo "Không kết nối được máy chủ" thay vì đăng xuất người dùng.

### 13.2 `auth.tsx` — trạng thái đăng nhập

[frontend/src/features/auth/auth.tsx](../frontend/src/features/auth/auth.tsx)

- **`useAuth()`**: TanStack Query `['auth','me']` gọi `GET /auth/me`. 401 → trả `null` (chưa đăng nhập, không phải lỗi). Lỗi khác (mạng) → `isError`. `staleTime: 0`, `retry: false`.
- **`AuthGate`** (bọc mọi trang cần đăng nhập):
  - đang tải → "Đang kiểm tra phiên đăng nhập…"
  - lỗi mạng → nút "Thử lại"
  - `null` → `<Navigate to="/login" replace />`
  - có user → `<Outlet />`
  - lắng nghe `auth-expired` → `clearPrivateCache`.
- **`clearPrivateCache`**: đóng sheet quick-add, huỷ query đang chạy, **xoá mọi cache trừ nhánh `auth`**, đặt user = null. Tránh trường hợp đăng xuất xong, người khác đăng nhập trên cùng máy vẫn thấy dữ liệu tài chính người trước trong cache.
- **`AdminGate`**: user không phải ADMIN → về `/`.
- **`useLogout`**: `POST /auth/logout` → `clearPrivateCache`. Nút đăng xuất bị vô hiệu khi còn mutation đang chạy (tránh mất dữ liệu đang lưu).

### 13.3 Router

[frontend/src/app/router.tsx](../frontend/src/app/router.tsx)

```
/login, /register, /forgot-password     → công khai
/reset-password                         → chuyển về /forgot-password (luồng cũ dùng link)
<AuthGate>
  <AppShell>
    / , /transactions, /profile, /debts, /reports, /add
    <AdminGate> /admin </AdminGate>
```

### 13.4 Trang đăng nhập / đăng ký (`auth-page.tsx`)

- Validate bằng `loginSchema` / `registerSchema` dùng chung với backend; đăng ký kiểm thêm "nhập lại mật khẩu".
- Thành công → xoá cache riêng tư cũ, `setQueryData(AUTH_KEY, user)` (khỏi gọi lại `/me`), `navigate('/')`.
- Đã đăng nhập mà vào `/login` → tự về `/`.
- Đọc `?error=` từ redirect Google → hiển thị thông báo.
- `autoComplete="current-password" / "new-password"` để trình quản lý mật khẩu hoạt động đúng.

### 13.5 Trang quên mật khẩu (`password-recovery-page.tsx`)

State machine `email → otp → password → done`. Reset token nhận ở bước OTP chỉ giữ trong **state React** (không localStorage, không URL), xoá sau khi dùng. Có cooldown 60 giây cho nút "Gửi lại OTP". `submitting` ref chặn double-submit. Xong thì xoá cache (server đã huỷ mọi phiên).

### 13.6 Trang Cá nhân

Form "Đổi mật khẩu" (có ô mật khẩu hiện tại) hoặc "Đặt mật khẩu" (tài khoản Google, `hasPassword = false`), dựa vào `user.hasPassword` từ `/auth/me`.

### 13.7 Vite proxy

`vite.config.ts`: `/api` → `http://localhost:4000`. Frontend gọi `/api/v1/...` cùng origin `localhost:5173` → không vướng CORS, cookie gắn đúng origin của web.

---

## 14. Cấu hình môi trường

Mọi biến được validate bằng Zod trong [env.ts](../backend/src/config/env.ts) — sai là API **thoát ngay khi khởi động** (fail fast), không chạy với cấu hình nửa vời.

| Biến | Ràng buộc | Ghi chú |
|---|---|---|
| `JWT_SECRET` | ≥ 32 ký tự | Tạo: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. **Ai có khoá này ký được token của bất kỳ ai, kể cả ADMIN.** Mỗi môi trường một khoá. Đổi khoá → mọi access token mất hiệu lực ngay, client tự refresh. |
| `JWT_ISSUER` | mặc định `cashcash-api` | |
| `ACCESS_TOKEN_TTL` | 60–3600 giây, mặc định 900 | |
| `CORS_ORIGIN` | danh sách origin, không path, không `/` cuối | |
| `APP_URL` | URL http(s), không user/pass/query/hash | Đích redirect sau Google; production bắt buộc https |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | điền **cả ba** hoặc **bỏ trống cả ba** | Bỏ trống → Google login tắt |
| `ADMIN_EMAILS` | danh sách email | Dùng cho `npm run db:admins` |
| `SMTP_*`, `MAIL_FROM` | `SMTP_USER` và `SMTP_PASS` đi cùng nhau | Dev mặc định Mailpit `localhost:1025`, inbox `localhost:8025` |
| `SUPABASE_SECRET_KEY` | bắt buộc | **Chỉ ở backend**, không bao giờ đưa vào frontend |

Cấu hình Google Cloud Console: APIs & Services → Credentials → OAuth client ID (Web application) → Authorized redirect URIs = đúng `GOOGLE_REDIRECT_URI` (khác một ký tự là Google báo `redirect_uri_mismatch`).

---

## 15. Mô hình tấn công & cách hệ thống chống

| Tấn công | Phòng thủ |
|---|---|
| **XSS đánh cắp token** | Cookie `HttpOnly`; React tự escape output |
| **CSRF** | `SameSite=Lax` + header `X-CashCash-Request` + kiểm `Origin` + GET không có tác dụng phụ |
| **Login CSRF qua OAuth callback** | `state` gắn với cookie |
| **Đánh cắp authorization code** | PKCE S256 + `client_secret` + code đổi phía server |
| **Replay id_token** | `nonce`, `exp`, cookie flow dùng một lần |
| **Giả mạo / sửa JWT** | Chữ ký HS256, ép `algorithms`, kiểm `iss`/`aud`/`exp`, Zod |
| **Leo thang quyền (tự đặt role ADMIN)** | Role chỉ trong JWT do server ký; register ép USER; trigger DB chặn đổi role |
| **IDOR** (xem dữ liệu người khác) | Mọi query lọc theo `req.userId` lấy từ token |
| **Đánh cắp refresh token** | Path hẹp, HttpOnly, rotation + reuse detection huỷ cả family |
| **Lộ database** | Chỉ lưu hash: scrypt cho mật khẩu/OTP, SHA-256 cho refresh/reset token; RLS chặn anon |
| **Brute-force mật khẩu online** | Rate limit 20/15 phút/IP; đổi mật khẩu 10/15 phút/user; scrypt chậm |
| **Brute-force OTP** | 5 lần thử, hạn 10 phút, OTP hash, rate limit |
| **Dò email tồn tại** | Cùng thông báo lỗi login; scrypt chạy cả khi không có user; forgot-password luôn 202 và xử lý nền |
| **Timing attack** | `timingSafeEqual` cho mật khẩu và `state` |
| **Race condition** | RPC transaction + `FOR UPDATE`; `p_expected_hash` |
| **Phiên còn sống sau đổi/reset mật khẩu** | Huỷ mọi refresh token; reset còn xoá cookie hiện tại |
| **Chiếm tài khoản qua Google email chưa xác minh** | Bắt buộc `email_verified === true`; định danh bằng `sub` |
| **Cache trung gian lưu response nhạy cảm** | `Cache-Control: no-store` ở refresh, verify OTP, Google start/callback |
| **Dữ liệu người trước còn trong cache SPA** | `clearPrivateCache` khi login/logout/hết phiên |
| **Cấu hình sai khi deploy** | Zod validate env, thoát khi sai; production ép HTTPS |

---

## 16. Kiểm thử

**Unit / integration test (Vitest, `npm test`)**

| File | Kiểm gì |
|---|---|
| `backend/src/modules/auth/jwt.test.ts` | Ký/verify, token giả, sai thuật toán, hết hạn, sai iss/aud, thiếu claim |
| `backend/src/modules/auth/auth.refresh.test.ts` | Các trạng thái refresh: ok / stale / reused / expired, cookie |
| `backend/src/modules/auth/auth.google.test.ts` | Luồng Google với Google giả lập: state, nonce, email_verified, mã lỗi redirect |
| `backend/src/modules/auth/password.test.ts` | scrypt hash/verify |
| `backend/src/modules/auth/password-reset.service.test.ts` | OTP, số lần thử, hết hạn |
| `backend/src/middlewares/current-user.test.ts` | 401 khi thiếu/sai token, gắn userId/role |
| `backend/src/modules/admin/admin.routes.test.ts` | USER bị 403, ADMIN qua |
| `backend/src/modules/users/user.password.test.ts` | Đổi/đặt mật khẩu |
| `frontend/src/lib/http.test.ts` | Tự refresh, single-flight, REFRESH_STALE, offline, auth-expired |
| `frontend/src/features/auth/auth.test.tsx`, `admin-gate.test.tsx`, `password-recovery-page.test.tsx` | UI gate và form |

**Script với Supabase thật**
- `npm run test:auth -w @cashcash/api` — tạo 2 tài khoản thử: đăng ký, đăng nhập, cookie, JWT giả mạo, xoay vòng, phát hiện dùng lại refresh token, logout, refresh hết hạn, đổi mật khẩu huỷ token, CSRF, cô lập dữ liệu 2 user, rồi dọn dẹp.
- `npm run mail:up` rồi `npm run test:password-reset -w @cashcash/api` — luồng OTP qua Mailpit.

**Tự kiểm bằng tay (DevTools)**
1. Application → Cookies: thấy `cc_access` (Path `/`), `cc_refresh` (Path `/api/v1/auth`), cột HttpOnly đã tick.
2. Console gõ `document.cookie` → **không** thấy hai cookie trên.
3. Xoá riêng `cc_access` rồi bấm sang trang khác → Network thấy request 401 → `POST /auth/refresh` 204 → request được gửi lại 200.
4. Copy `cc_refresh`, refresh một lần, rồi dán lại giá trị cũ sau hơn 10 giây và refresh → 401, phiên bị huỷ (reuse detection).

---

## 17. Đánh đổi, giới hạn & hướng mở rộng

| Hiện tại | Hệ quả | Hướng mở rộng khi cần |
|---|---|---|
| Access token không thu hồi được | Logout/đổi role/khoá user có độ trễ ≤ TTL | Giảm TTL; denylist `jti` trong Redis; `requireRole` tra DB cho route nhạy cảm |
| Rate limit trong RAM | Reset khi restart; không chia sẻ giữa nhiều instance | Redis / rate limit ở reverse proxy |
| HS256 một secret | Mọi service kiểm token đều ký được token | RS256/EdDSA + JWKS nếu có nhiều service; thêm `kid` để xoay khoá mềm |
| Đổi `JWT_SECRET` cắt mọi access token ngay | Mọi tab refresh một lần | Hỗ trợ 2 khoá song song khi xoay (`kid`) |
| Chỉ provider `google` | CHECK constraint `provider IN ('google')` | Thêm provider: mở rộng CHECK, thêm module tương tự `google.ts` |
| Không có trang quản lý thiết bị | Không xem/đăng xuất từng thiết bị | Bảng `refresh_tokens` đã có `familyId`, `createdAt` → liệt kê family đang hoạt động |
| Không có 2FA / xác minh email khi đăng ký | — | TOTP, xác minh email bằng OTP như luồng reset |
| Không huỷ liên kết Google | — | Endpoint xoá dòng `oauth_accounts` (chỉ khi user đã có mật khẩu) |

---

## 18. Câu hỏi ôn tập

<details><summary>1. JWT có mã hoá dữ liệu không? Để gì trong payload?</summary>

Không, chỉ ký. Payload là Base64URL, ai cũng đọc được. Chỉ để định danh và thông tin không nhạy cảm (`sub`, `role`).
</details>

<details><summary>2. Vì sao access token sống ngắn còn refresh token sống dài?</summary>

Access token đi kèm mọi request, không thu hồi được → ngắn để giới hạn thiệt hại khi lộ. Refresh token ít khi gửi, lưu DB nên thu hồi được → dài để người dùng không phải đăng nhập lại liên tục.
</details>

<details><summary>3. Rotation + reuse detection hoạt động thế nào?</summary>

Mỗi lần refresh, token cũ bị thu hồi và cấp token mới cùng family. Nếu một token đã thu hồi lại được dùng (ngoài cửa sổ 10s cho tab song song) → nghi bị trộm → thu hồi toàn bộ family.
</details>

<details><summary>4. Vì sao lưu token trong cookie HttpOnly thay vì localStorage? Cái giá phải trả?</summary>

XSS không đọc được cookie HttpOnly. Cái giá: cookie tự gửi kèm nên phải chống CSRF (SameSite + header tuỳ chỉnh + Origin).
</details>

<details><summary>5. Header X-CashCash-Request chống CSRF bằng cách nào?</summary>

Form HTML không đặt được header tuỳ chỉnh; fetch cross-origin có header tuỳ chỉnh phải qua preflight CORS, origin lạ bị chặn nên request thật không được gửi.
</details>

<details><summary>6. OAuth 2.0 khác OpenID Connect thế nào?</summary>

OAuth 2.0 là ủy quyền (cấp access token gọi API). OIDC là lớp xác thực trên OAuth 2.0, thêm scope `openid` và `id_token` (JWT chứa danh tính).
</details>

<details><summary>7. state, PKCE, nonce mỗi cái chống gì?</summary>

`state`: CSRF/login CSRF ở callback. PKCE: kẻ chặn được `code` không đổi được token. `nonce`: id_token bị phát lại từ lượt đăng nhập khác.
</details>

<details><summary>8. Vì sao định danh user Google bằng `sub` chứ không bằng email?</summary>

Email có thể đổi hoặc được tái sử dụng; `sub` là ID vĩnh viễn, duy nhất.
</details>

<details><summary>9. Vì sao kiểm chữ ký id_token Google được mà không cần secret của Google?</summary>

Google ký RS256 bằng private key; CashCash kiểm bằng public key công bố ở JWKS.
</details>

<details><summary>10. Đổi role ADMIN → USER thì bao lâu có hiệu lực?</summary>

Tối đa `ACCESS_TOKEN_TTL` (15 phút), khi access token được làm mới và RPC rotate đọc role mới từ DB.
</details>

<details><summary>11. Vì sao frontend cần single-flight khi refresh?</summary>

Nhiều request 401 đồng thời sẽ cùng gửi một refresh token; chỉ lần đầu xoay thành công, các lần sau bị coi là dùng lại → đăng xuất oan. Gộp thành một lần refresh.
</details>

<details><summary>12. Vì sao login vẫn chạy scrypt khi email không tồn tại?</summary>

Để thời gian phản hồi như nhau, kẻ tấn công không đo độ trễ để biết email nào có tài khoản.
</details>

<details><summary>13. Vì sao mật khẩu dùng scrypt còn refresh token chỉ cần SHA-256?</summary>

Mật khẩu do người đặt, entropy thấp → cần hash chậm để chống brute-force. Refresh token 256 bit ngẫu nhiên → brute-force bất khả thi dù hash nhanh.
</details>

<details><summary>14. Ẩn menu Admin ở frontend có đủ bảo mật không?</summary>

Không. Đó chỉ là UI; quyền thật kiểm ở `requireRole` trên server (403).
</details>

---

## 19. Thuật ngữ

| Thuật ngữ | Giải thích |
|---|---|
| **Authentication** | Xác thực danh tính (bạn là ai) |
| **Authorization** | Phân quyền (bạn được làm gì) |
| **JWT / JWS / JWE** | Token JSON; JWS = có chữ ký; JWE = có mã hoá |
| **Claim** | Một cặp khoá–giá trị trong payload JWT |
| **HS256 / RS256** | HMAC-SHA256 (khoá đối xứng) / RSA-SHA256 (cặp khoá) |
| **JWKS** | Tập public key của issuer, công khai qua URL |
| **Access token** | Token ngắn hạn để gọi API |
| **Refresh token** | Token dài hạn để xin access token mới |
| **Rotation** | Mỗi lần dùng refresh token thì đổi sang token mới |
| **Token family** | Chuỗi refresh token sinh ra từ một lần đăng nhập |
| **OAuth 2.0** | Chuẩn ủy quyền truy cập tài nguyên |
| **OIDC** | OpenID Connect — lớp xác thực trên OAuth 2.0 |
| **Authorization code** | Mã ngắn hạn, dùng một lần, đổi lấy token phía server |
| **PKCE** | Proof Key for Code Exchange — gắn code với verifier bí mật |
| **state** | Giá trị ngẫu nhiên chống CSRF trong OAuth |
| **nonce** | Giá trị ngẫu nhiên gắn id_token với một lượt đăng nhập |
| **id_token** | JWT do OIDC provider phát, chứa danh tính người dùng |
| **Scope** | Phạm vi quyền xin từ provider |
| **CSRF** | Giả mạo request từ site khác, lợi dụng cookie tự gửi |
| **XSS** | Chèn mã JS độc vào trang |
| **CORS** | Cơ chế trình duyệt cho phép/chặn request cross-origin |
| **SameSite** | Thuộc tính cookie kiểm soát việc gửi cookie cross-site |
| **HttpOnly** | Cookie JS không đọc được |
| **KDF** | Key Derivation Function — hàm hash chậm cho mật khẩu (scrypt, Argon2, bcrypt) |
| **Salt** | Chuỗi ngẫu nhiên trộn vào mật khẩu trước khi hash |
| **Timing attack** | Suy ra bí mật từ thời gian xử lý |
| **User enumeration** | Dò xem email nào có tài khoản |
| **IDOR** | Truy cập dữ liệu người khác bằng cách đổi ID |
| **RLS** | Row Level Security của Postgres |
| **RPC** | Function Postgres gọi qua Supabase, chạy trong một transaction |
| **Fail closed** | Khi có sự cố thì từ chối thay vì cho qua |
