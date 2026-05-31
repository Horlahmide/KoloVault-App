# Comprehensive Security Cross-Audit

**Date:** May 30, 2026
**Auditor:** Gemini CLI
**Scope:** Enumeration Attacks, Token Security, and General Architectural Integrity

---

## 1. Enumeration Attacks Audit

### 1a. Registration-based Enumeration (Vulnerable)
The `register` server action in `src/app/auth/register/actions.ts` explicitly checks for existing users and returns a specific error message if one is found.
- **Behavior:** Returns `{ error: "Registration failed. Please try again with different credentials." }` if the email exists, and `{ success: true }` otherwise.
- **Risk:** An attacker can programmatically check if any email address is registered on the platform by observing the response.
- **Recommendation:** Return a generic "Registration successful. Please check your email" message regardless of whether the account exists, or handle the existing account case by sending a "You already have an account" email (simulated).

### 1b. Login Timing Attacks (Vulnerable)
The `login` server action in `src/app/auth/login/actions.ts` performs user lookup before password verification.
- **Behavior:** If `prisma.user.findUnique` returns null, the action returns immediately. If a user is found, it proceed to `argon2.verify`, which is computationally expensive (~500ms+ depending on settings).
- **Risk:** An attacker can distinguish between registered and non-registered emails by measuring the response time.
- **Recommendation:** Always perform a "dummy" hash verification even if the user is not found to normalize response timing.

### 1c. Forgot Password Flow (Secure)
The `forgotPassword` action in `src/app/auth/forgot-password/actions.ts` is implemented correctly to prevent enumeration.
- **Behavior:** Always returns `{ success: true }` regardless of whether the email exists in the database.
- **Finding:** Correctly follows security best practices for enumeration prevention.

### 1d. Object ID Enumeration (Secure)
All major entities (`User`, `Entry`, `Goal`) use `cuid()` for primary keys.
- **Behavior:** IDs are non-sequential and non-predictable (e.g., `cl...`).
- **Risk:** Negligible risk of ID crawling/enumeration.

---

## 2. Token Security Audit

### 2a. Plaintext Token Storage (Vulnerability: Medium/High)
The system stores sensitive tokens in plaintext within the database.
- **Affected Fields:** `Session.id` and `User.resetToken`.
- **Risk:** If the database (SQLite `dev.db`) is compromised, an attacker has immediate access to all active session IDs (hijacking every logged-in user) and active password reset tokens.
- **Recommendation:** Store a SHA-256 hash of the session ID and reset token in the database. Verify the incoming token from the client/URL against the stored hash.

### 2b. Session Management (Good)
- **Entropy:** `nanoid(32)` provides sufficient randomness to prevent brute-forcing session IDs.
- **Expiry:** 7-day expiration with a "Sliding Window" refresh logic (refreshes at the 50% mark). This balances security and user experience.
- **Invalidation:** `logoutEverywhere` correctly clears all sessions for a specific user ID.

### 2c. Cookie Security (Good)
Session cookies are configured with:
- `httpOnly: true` (Prevents XSS-based token theft)
- `secure: process.env.NODE_ENV === "production"` (Prevents transmission over HTTP)
- `sameSite: "lax"` (Reasonable protection against CSRF while maintaining usability)

---

## 3. Network & Architectural Gaps

### 3a. Inactive Middleware (CRITICAL)
The security logic defined in `src/proxy.ts` (CSRF protection and route guarding) is **NOT active**.
- **Issue:** Next.js requires a file named `middleware.ts` (or `.js`) in the root or `src` directory. `src/proxy.ts` is never imported or executed as middleware.
- **Impact:**
    1. **CSRF Vulnerability:** All POST/PUT/DELETE requests (like `/api/logout`) are unprotected from Cross-Site Request Forgery.
    2. **Route Guarding:** While pages check sessions, the centralized "Perimeter" defense is missing.
- **Recommendation:** Create `src/middleware.ts` that exports the `proxy` function as default.

### 3b. Rate Limiting Gaps
Rate limiting is only applied to the `login` flow.
- **Issue:** `register` and `forgot-password` endpoints have no rate limiting.
- **Risk:** Attackers can flood these endpoints to perform bulk enumeration or denial of service on the database.
- **Recommendation:** Apply the `checkIpRateLimit` logic to all authentication-related server actions.

---

## 4. Summary Table

| Finding | Severity | Category | Status |
| :--- | :--- | :--- | :--- |
| Inactive Security Middleware | **CRITICAL** | Architecture | **VULNERABLE** |
| Plaintext Session/Reset Tokens | **HIGH** | Token Security | **VULNERABLE** |
| Registration Account Enumeration | **MEDIUM** | Enumeration | **VULNERABLE** |
| Login Timing Attack | **LOW** | Enumeration | **VULNERABLE** |
| CSRF on `/api/logout` | **LOW** | CSRF | **VULNERABLE** |
| Rate Limit Coverage | **MEDIUM** | DOS/Enumeration | **PARTIAL** |

## 5. Strategic Recommendations

1. **Activate Middleware:** Rename `src/proxy.ts` to `src/middleware.ts` and ensure it uses a default export.
2. **Hash Sensitive Tokens:** Update the `Session` and `User` models to store hashes of IDs/tokens rather than the raw values.
3. **Normalize Auth Responses:** Ensure the `login` action takes a consistent amount of time regardless of whether the user exists.
4. **Expand Rate Limiting:** Apply IP-based rate limits to `register` and `forgot-password` to prevent automated abuse.
