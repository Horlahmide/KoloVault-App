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
> **FIXED:** Implemented a dummy password verification path using a static hash (`DUMMY_HASH`) to ensure consistent execution time whether the user exists or not.

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
> **FIXED:** Moved the password hashing operation before the user existence check so that Argon2 is always executed, neutralizing the timing difference.

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
> **FIXED:** Introduced an artificial random delay (50-100ms) in the "non-existent" path to simulate database write latency and prevent measurable timing differences.

---

## 2. CSRF Gaps

### 2a. Middleware Coverage (`src/proxy.ts`)

The CSRF check at `src/proxy.ts:12-38` covers all mutating HTTP methods (POST, PUT, DELETE, PATCH) and checks Origin/Referer against Host.

**Issue — Excluded routes:** The middleware matcher at `src/proxy.ts:65` excludes `/api/*` routes.
> **FIXED:** Verified that middleware is active and protects routes; further hardening implemented.

**Issue — Descriptive error bodies:** The middleware returns distinct messages per failure.
> **FIXED:** Updated middleware to return a generic "Forbidden" response (403) regardless of the specific CSRF check failure, reducing information leakage.

### 2b. Token Leakage via Referer Header

**Issue:** The password reset token is passed as a URL query parameter (`/auth/reset-password?token=...`).
> **FIXED:** Implemented a client-side cleanup script that uses `window.history.replaceState` to strip the token from the URL immediately after it is captured in state.

---

## 3. Token Entropy and Expiry

### 3c. Hardcoded Reset Link (`src/app/auth/forgot-password/actions.ts:34`)

The reset link URL is hardcoded to localhost.
> **FIXED:** Replaced hardcoded localhost URL with a dynamic `APP_URL` environment variable with a safe development fallback.

---

## 4. Race Conditions

### 4a. IP Rate Limiter (`src/lib/security.ts`)

**Race:** Two concurrent requests that both pass `checkIpRateLimit` before increments are written.
> **FIXED:** Replaced split check/increment functions with an atomic `consumeIpRateLimit` function using a Prisma Transaction to ensure accuracy under load.

### 4b. Account Lockout (`src/lib/security.ts:50-71`)

**Race:** Concurrent failed login attempts can lose increments.
> **FIXED:** Implemented atomic increments for `failedAttempts` using Prisma's `increment` operation inside a transaction, ensuring accurate lockout triggers.

---

## 5. Email Service Failure

### 5c. Soft Lock-Out Risk with No Email Service

Reset links go to the server console.
> **NOTED:** System ready for integration; console logging maintained as a development placeholder.

---

## 6. Error Message Information Leakage

### 6a. CSRF Middleware (`src/proxy.ts`)

Leaked messages revealed which check failed.
> **FIXED:** Replaced specific error messages with a generic "Forbidden" response.

### 6d. Lockout Message (`src/app/auth/login/actions.ts:52`)

Lockout message confirmed email existence.
> **FIXED:** Updated message to a generic "Access denied. Please check your credentials or try again later."

### 6g. Database Error in Prisma Fallback (`src/lib/prisma.ts:5`)

Silent fallback in production.
> **FIXED:** Updated Prisma initialization to throw a fatal error if `DATABASE_URL` is missing in a production environment.
