# Security Audit — Kolo Kept

A comprehensive audit covering timing-based enumeration, CSRF gaps, token entropy and expiry, race conditions, email service failure modes, and information leakage through error messages.

---

## 1. Timing-Based Enumeration

**Risk:** An attacker can determine whether an email is registered by measuring response time differences between "email exists" vs. "email does not exist" code paths.

### 1a. Login (`src/app/auth/login/actions.ts`)

**Path when email does NOT exist (fast):**

| Step | Operation | Est. time |
|---|---|---|
| Line 40 | `prisma.user.findUnique({ where: { email } })` | ~1–5 ms |
| Line 44-47 | Returns `"Invalid email or password."` | immediate |

Total: **~1–5 ms**

**Path when email DOES exist (slow):**

| Step | Operation | Est. time |
|---|---|---|
| Line 40 | `prisma.user.findUnique({ where: { email } })` | ~1–5 ms |
| Line 55 | `verifyPassword(password, user.passwordHash)` — argon2 verify | **~50–500 ms** |
| Line 57-61 | Returns `"Invalid email or password."` only if password wrong | immediate |

Total: **~50–500 ms** (argon2 dominates)

**Verdict:** Measurable timing oracle. Even though the error message is generic, the response time reveals whether the email exists.

### 1b. Register (`src/app/auth/register/actions.ts`)

**Path when email DOES exist (fast):**

| Step | Operation | Est. time |
|---|---|---|
| Line 29-31 | `prisma.user.findUnique({ where: { email } })` | ~1–5 ms |
| Line 33-36 | Returns generic error | immediate |

Total: **~1–5 ms**

**Path when email does NOT exist (slow):**

| Step | Operation | Est. time |
|---|---|---|
| Line 29-31 | `prisma.user.findUnique({ where: { email } })` | ~1–5 ms |
| Line 38 | `hashPassword(password)` — argon2 hash | **~50–500 ms** |
| Line 40-45 | `prisma.user.create(...)` | ~5–10 ms |
| Line 47 | Returns `{ success: true }` | immediate |

Total: **~50–500 ms**

**Verdict:** Strong timing oracle. The argon2 hashing cost makes this especially noticeable.

### 1c. Forgot Password (`src/app/auth/forgot-password/actions.ts`)

**Path when email does NOT exist:**

| Step | Operation | Est. time |
|---|---|---|
| Line 14-16 | `prisma.user.findUnique({ where: { email } })` | ~1–5 ms |
| Line 37 | `console.log(...)` | ~1 ms |
| Line 40 | Returns `{ success: true }` | immediate |

Total: **~2–6 ms**

**Path when email DOES exist:**

| Step | Operation | Est. time |
|---|---|---|
| Line 14-16 | `prisma.user.findUnique({ where: { email } })` | ~1–5 ms |
| Line 21 | `nanoid(48)` — negligible | ~0 ms |
| Line 24-30 | `prisma.user.update(...)` — DB write | **~5–15 ms** |
| Line 33-34 | `console.log(...)` | ~1 ms |
| Line 40 | Returns `{ success: true }` | immediate |

Total: **~7–22 ms**

**Verdict:** Subtle timing difference (DB write vs. no DB write). Less exploitable than login/register over a network, but measurable under controlled conditions (local network, same data center).

### 1d. Reset Password (`src/app/auth/reset-password/actions.ts`)

Token validity is independent of email, so timing is uniform regardless of email status. No timing oracle here.

### Recommendation — Mitigation for all timing oracles

Add a configurable artificial delay to all auth endpoints so fast and slow paths take the same wall-clock time. For example, in a shared utility:

```typescript
export async function constantTimeAuthDelay() {
  // Wait enough time to cover an argon2 verify (~500ms)
  await new Promise(r => setTimeout(r, 500));
}
```

Apply it in the catch block and on every early return path in `login`, `register`, and `forgot-password` actions.

---

## 2. CSRF Gaps

### 2a. Middleware Coverage (`src/proxy.ts`)

The CSRF check at `src/proxy.ts:12-38` covers all mutating HTTP methods (POST, PUT, DELETE, PATCH) and checks Origin/Referer against Host.

**Issue — Excluded routes:** The middleware matcher at `src/proxy.ts:65` excludes `/api/*` routes:
```
"/((?!api|_next/static|_next/image|favicon.ico).*)"
```

The `/api/logout` route (`src/app/api/logout/route.ts`) has **no CSRF protection**. A POST to `/api/logout` can be triggered cross-origin without Origin/Referer checks. Impact: an attacker could log the user out (denial-of-service nuisance), but cannot steal data or gain access.

**Issue — Descriptive error bodies:** The middleware returns distinct messages per failure:
- Line 21: `"CSRF Protection: Invalid Origin"`
- Line 29: `"CSRF Protection: Invalid Referer"`
- Line 36: `"CSRF Protection: Missing Origin/Referer"`

An attacker learns exactly which check failed, helping them refine their bypass strategy. A secure response should return a bare `403 Forbidden` with no body.

### 2b. Token Leakage via Referer Header

**Issue:** The password reset token is passed as a URL query parameter (`/auth/reset-password?token=...`). On the page:
- `src/app/auth/reset-password/page.tsx:13`: Token read from `searchParams.get("token")`
- `src/app/auth/reset-password/page.tsx:21`: Token injected into form data via `formData.set("token", token)`

Because the token is in the URL:
- It is stored in browser history
- It is sent as the `Referer` header when clicking any link on the page that navigates away
- It can be leaked to third-party analytics, CDN logs, or external resources loaded by the page

### 2c. No Synchronizer Token Pattern

The CSRF protection relies entirely on Origin/Referer header checking. There is no CSRF token embedded in forms and verified server-side. Some browser configurations (privacy extensions, certain mobile browsers, older HTTP clients) may strip both Origin and Referer headers, causing legitimate requests to be blocked or, conversely, making them bypassable if an attacker can craft requests from origins that the middleware trusts in certain configurations.

### Recommendations

1. Move the reset token out of the URL: pass it only in POST body (form data), never in query parameters. Read it from `searchParams` initially to show the form, but immediately remove it from the URL via `window.history.replaceState` or use a server action that accepts the token as a POST parameter.
2. Return a generic `403 Forbidden` from the CSRF middleware regardless of which check failed.
3. Add CSRF token validation (synchronizer token pattern) inside server actions as a defense-in-depth measure, independent of the middleware.
4. Add CSRF protection to `/api/logout` or move it to a server action (like `/settings/logout`) that goes through middleware.

---

## 3. Token Entropy and Expiry

### 3a. Reset Token (`src/app/auth/forgot-password/actions.ts:21`)

| Property | Value | Assessment |
|---|---|---|
| Generation | `nanoid(48)` | Strong |
| Alphabet | 64 chars (A-Z, a-z, 0-9, -, _) | Standard |
| Entropy | 64⁴⁸ ≈ 2²⁸⁸ | **Excellent** — brute force infeasible |
| Expiry | 1 hour (`3600000 ms`) | Reasonable window |
| Storage | `resetToken` field (`@unique` on schema) | Unique constraint prevents collision |
| Invalidation | Set to `null` after use | Single use ✓ |
| Expiry check | `resetExpires: { gt: new Date() }` | Checked at query time ✓ |

**Issue — Token visible in URL:** See §2b above.

### 3b. Session ID (`src/lib/auth.ts:18`)

| Property | Value | Assessment |
|---|---|---|
| Generation | `nanoid(32)` | Strong |
| Entropy | 64³² ≈ 2¹⁹² | **Very strong** |
| Expiry | 7 days with refresh at 3.5 days | Reasonable |
| Cookie flags | `httpOnly: true`, `sameSite: "lax"`, `secure: true` in prod | Good |

### 3c. Hardcoded Reset Link (`src/app/auth/forgot-password/actions.ts:34`)

The reset link URL is hardcoded:
```
http://localhost:3000/auth/reset-password?token=${resetToken}
```

This must be configurable via an environment variable (e.g., `APP_URL`) to be production-ready. The hardcoded value also prevents the app from working behind a reverse proxy or custom domain without a code change.

### Recommendations

1. Set `window.history.replaceState(null, "", "/auth/reset-password")` in the reset-password page after capturing the token from the URL, to prevent referrer leakage and clean browser history.
2. Make the base URL configurable: `process.env.APP_URL ?? "http://localhost:3000"`.
3. No changes needed to entropy or expiry values — they are already strong.

---

## 4. Race Conditions

### 4a. IP Rate Limiter (`src/lib/security.ts`)

**Code path:**
1. `checkIpRateLimit(ip)` — reads `RateLimit` record (line 11)
2. If allowed, login proceeds
3. On failure: `incrementIpRateLimit(ip)` — upserts with `increment: 1` (line 36)

**Race:** Two concurrent requests that both pass `checkIpRateLimit` (both see `count = 4`, both see `count < 5 = true`) will both be allowed through. After both increment, `count = 6` instead of the intended `5`.

**Window:** Between `checkIpRateLimit` reading the count and `incrementIpRateLimit` writing the incremented count.

**Exploit:** Send 5+ login requests simultaneously. All may pass before any increments are written.

**Severity:** Low-Medium. In practice, SQLite serializes writes, but the read-and-check happens before the write lock is acquired. An attacker can get ~2–3 extra attempts per window.

### 4b. Account Lockout (`src/lib/security.ts:50-71`)

**Code path:**
1. Read `failedAttempts` from user (line 51-54)
2. Increment locally (line 58)
3. Write back (line 65-71)

**Race:** Two concurrent `handleFailedLogin` calls for the same user both read `failedAttempts = 9`, both compute `newAttempts = 10`, both write `failedAttempts = 10`. They each set `lockoutUntil` to the same time. Result: only 10 total attempts, but two increments were lost — the count is 10 instead of 11.

**Worse case:** If both read `failedAttempts = 0` concurrently (user just registered), both write `failedAttempts = 1`. Two failed attempts are recorded as 1.

**Severity:** Low. The lockout threshold is still reached at approximately the right number. The count drifts slightly but the lockout still triggers when `failedAttempts >= 10` after any of the concurrent writes.

### 4c. Registration TOCTOU (`src/app/auth/register/actions.ts:29-40`)

**Code path:**
1. Check if email exists (line 29-31)
2. Hash password (line 38)
3. Create user (line 40-45)

**Race:** Two concurrent registration requests for the same new email both pass the "does not exist" check at line 33 (both see null), both hash, both attempt `create`. One succeeds, one hits the `@unique` constraint on `email` and is caught by the catch block at line 48.

**Severity:** Low. The unique constraint prevents duplicate emails. The second request gets a generic error. No data corruption.

### 4d. Session Validation (`src/lib/auth.ts:42-80`)

**Code path:**
1. Read session (line 46)
2. Check expiry (line 56)
3. If expired, delete (line 57)
4. If close to expiry, update (line 66-69)

**Race:** Two concurrent requests with the same about-to-expire session could both pass the expiry check, both attempt the refresh update. The second update would succeed (overwriting with a new `expiresAt`), which is harmless.

**Severity:** None. No security impact.

### Recommendations

1. **For rate limiter:** Move the check-and-increment into a single atomic operation. Since Prisma with SQLite doesn't support raw transactions easily, use `prisma.$transaction` to wrap the read + write:

   ```typescript
   export async function checkAndIncrementIpRateLimit(ip: string): Promise<boolean> {
     const key = `login:ip:${ip}`;
     return await prisma.$transaction(async (tx) => {
       const record = await tx.rateLimit.findUnique({ where: { key } });
       const now = Date.now();
       if (!record || (now - record.lastAttempt.getTime()) > IP_RATE_LIMIT_WINDOW_MS) {
         await tx.rateLimit.upsert({ ... create/reset ... });
         return true;
       }
       if (record.count >= IP_RATE_LIMIT_MAX) return false;
       await tx.rateLimit.update({ where: { key }, data: { count: { increment: 1 }, lastAttempt: new Date() } });
       return true;
     });
   }
   ```

2. **For account lockout:** Same pattern — use a transaction to read and increment atomically.
3. **For registration:** Accept the unique constraint as the safety net (current behavior is acceptable).

---

## 5. Email Service Failure

### 5a. Current Implementation

There is no email service. Reset links are logged to the server console:
- `src/app/auth/forgot-password/actions.ts:33-34`

A hardcoded localhost URL is used:
```
http://localhost:3000/auth/reset-password?token=${resetToken}
```

### 5b. Failure Modes If Email Service Were Added

| Failure Mode | Current Handling | What Should Happen |
|---|---|---|
| SMTP connection refused | N/A (no email service) | Retry with exponential backoff, then return generic error |
| Email provider rate limit | N/A | Queue the email, retry later, notify admin |
| Invalid recipient (bounce) | N/A | Log the bounce, do NOT reveal to requestor (prevents enumeration) |
| Partial failure (multi-recipient) | N/A | N/A — always single recipient |
| Timeout | N/A | Timeout after configurable threshold, return generic error |

### 5c. Soft Lock-Out Risk with No Email Service

Because the app has no email delivery, password reset is **impossible in production** without console access. If a user forgets their password:
- The reset link goes to the server console (not their inbox)
- They cannot recover their account without an administrator

This is a **denial-of-service / availability** issue rather than a security vulnerability, but it means the password reset feature is effectively non-functional outside development.

### Recommendations

1. Before adding email, wrap the send operation in a try/catch that returns a generic response regardless of outcome.
2. Implement a simple email queue (in-memory or DB-backed) so transient failures don't lose the reset request.
3. Use an environment variable for the base URL so generated links work in any deployment environment.
4. For production: integrate with a transactional email service (Resend, SendGrid, SES, etc.) via a dedicated `src/lib/email.ts` module.

---

## 6. Error Message Information Leakage

### 6a. CSRF Middleware (`src/proxy.ts`)

| Line | Message Leaked | Risk |
|---|---|---|
| 21 | `"CSRF Protection: Invalid Origin"` | Reveals Origin check failed (attacker knows to try without Origin) |
| 29 | `"CSRF Protection: Invalid Referer"` | Reveals Referer check failed (attacker knows their Referer is wrong) |
| 36 | `"CSRF Protection: Missing Origin/Referer"` | Reveals client sent neither header (attacker knows to add one) |

**Severity:** Low. The attacker learns which CSRF bypass avenue to pursue. However, the check itself still blocks the request, and the 3xx/4xx status code signals failure regardless of body content. Still, best practice is to return a bare `403 Forbidden` with no body.

### 6b. Password Reset Token (`src/app/auth/reset-password/actions.ts:30`)

```
return { error: "Invalid or expired reset token." };
```

This message merges two distinct failure modes: "token never existed" and "token existed but expired." This is good — it does not distinguish between them.

**However**, there is a subtle leak: if the token was already used (set to `null`), it behaves identically to "never existed" (the `findFirst` returns null). The message does not reveal which case, so this is acceptable.

**Severity:** None.

### 6c. Login Actions (`src/app/auth/login/actions.ts`)

| Line | Message | Leaks? |
|---|---|---|
| 36 | `"Invalid email or password."` | Same for format error, missing user, and wrong password ✓ |
| 44-47 | `"Invalid email or password."` | Same message for missing user ✓ |
| 57-61 | `"Invalid email or password."` | Same message for wrong password ✓ |
| 70 | `"An error occurred during login."` | Generic catch-all ✓ |

**Covered by timing oracle (§1a).** While the message is generic, the **response time** leaks the email status irrespective of the message text.

### 6d. Lockout Message (`src/app/auth/login/actions.ts:52`)

```
return { error: "Account temporarily locked. Please try again in an hour." };
```

This confirms that the email is **registered** (otherwise we couldn't know about the lockout). An attacker who sees this message learns the email exists.

**Severity:** Low-Medium. The attacker only sees this after bypassing IP rate limiting AND guessing or enumerating past the lockout threshold. In practice, the account lockout mechanism limits this to 10 attempts per hour before the message appears. However, it does convert a "maybe exists" to "definitely exists."

### 6e. Reset Password Page Missing Token (`src/app/auth/reset-password/page.tsx:38-39`)

| Line | Message | Leaks? |
|---|---|---|
| 39 | `"Invalid Link"` / `"The password reset link is missing a token."` | Reveals the link is malformed (no token) — no security impact |
| 42 | `"Request a new link"` (link to forgot-password) | Standard UX — no leak |

**Severity:** None.

### 6f. Registration Password Policy (`src/app/auth/register/actions.ts:24`)

```
"Password must be at least 12 characters long and include uppercase, lowercase, numbers, and symbols."
```

This reveals the full password policy. **This is standard and acceptable** — most login forms reveal password requirements. However, it does help attackers narrow their password-guessing dictionary to only passwords meeting these criteria.

**Severity:** None (standard practice).

### 6g. Database Error in Prisma Fallback (`src/lib/prisma.ts:5`)

```typescript
url: process.env.DATABASE_URL ?? "file:./dev.db"
```

If `DATABASE_URL` is missing, the app falls back to `file:./dev.db` in the current working directory. In production, this could mean:
- An unset environment variable silently connects to a local file instead of failing loudly
- The developer might not realize they are using the wrong database

**Severity:** Low. Information is not leaked, but the default is not the safest operational choice for production.

### Recommendations

1. **CSRF middleware:** Replace specific error messages with a bare `new NextResponse(null, { status: 403 })` to avoid giving attackers diagnostic information.
2. **Lockout message:** Change to `"Access denied. Please try again later."` to avoid confirming account existence.
3. **Prisma client:** Remove the fallback in production:

   ```typescript
   url: process.env.DATABASE_URL ?? (process.env.NODE_ENV === "production" 
     ? (() => { throw new Error("DATABASE_URL is required in production") })() 
     : "file:./dev.db")
   ```

---

## Audit Summary

| # | Finding | Severity | File(s) | Recommendation |
|---|---|---|---|---|
| 1 | Timing oracle on login (argon2 verify reveals email existence) | **High** | `src/app/auth/login/actions.ts:40-61` | Add constant-time delay (~500ms) on all auth paths |
| 2 | Timing oracle on register (argon2 hash reveals email availability) | **High** | `src/app/auth/register/actions.ts:29-45` | Add constant-time delay (~500ms) on all auth paths |
| 3 | CSRF middleware leaks which check failed | **Low** | `src/proxy.ts:21,29,36` | Return bare 403 with no body |
| 4 | No CSRF protection on `/api/logout` | **Low** | `src/app/api/logout/route.ts`, `src/proxy.ts:65` | Add CSRF check or move to server action |
| 5 | Reset token in URL leaks via Referer / history | **Medium** | `src/app/auth/reset-password/page.tsx:13` | Use `history.replaceState` to strip token from URL |
| 6 | Reset link URL hardcoded to localhost | **Medium** | `src/app/auth/forgot-password/actions.ts:34` | Use `process.env.APP_URL` |
| 7 | Race condition in rate limiter (TOCTOU) | **Medium** | `src/lib/security.ts:9-30,32-48` | Wrap in `prisma.$transaction` |
| 8 | Race condition in account lockout counter | **Low** | `src/lib/security.ts:50-71` | Wrap in `prisma.$transaction` |
| 9 | No email service — reset is non-functional in prod | **Medium** | `src/app/auth/forgot-password/actions.ts` | Integrate transactional email + env-based base URL |
| 10 | Lockout message confirms email exists | **Low-Medium** | `src/app/auth/login/actions.ts:52` | Change to generic denial message |
| 11 | Prisma DATABASE_URL fallback silent in production | **Low** | `src/lib/prisma.ts:5` | Remove fallback when `NODE_ENV === "production"` |
| 12 | Forgot-password timing oracle (DB write vs. no write) | **Low** | `src/app/auth/forgot-password/actions.ts:14-30` | Add constant-time delay |
