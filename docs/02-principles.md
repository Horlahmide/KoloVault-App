# Security Principles in Kolo Kept

This document maps the codebase to six core authentication security principles. Each section gives a plain definition followed by code references that demonstrate the principle in action.

---

## 1. Least Privilege

**Definition:** Every piece of code — a function, a module, a database query — should only have access to the data and capabilities it absolutely needs to do its job, and nothing more.

| Where | What It Does |
|---|---|
| `src/app/dashboard/actions.ts:28-34` | `addEntry` creates an `Entry` scoped to `user.id` — it never accesses other users' entries, goals, or sessions. The Prisma `create` call only writes to the Entry table with the authenticated user's ID. |
| `src/app/dashboard/actions.ts:55-58` | `updateGoal` upserts a Goal always scoped to `user.id`. It cannot read or modify any other user's goal. |
| `src/app/settings/actions.ts:10` | `handleLogoutEverywhere` only calls `logoutEverywhere(user.id)` — it deletes sessions only for the current user, never all users. |
| `src/app/dashboard/page.tsx:13-19` | The dashboard page queries entries and goal filtered by `userId: user.id`. The authenticated user never sees another user's data. |
| `prisma/schema.prisma:36-37` | The `Session` model has an `@@index([userId])` — queries for sessions are indexed by user, enabling efficient scoped lookups. |
| `src/lib/auth.ts:21-28` | `createSession` only inserts one session row for one user. It has no access to create sessions for other users or modify existing sessions. |
| `src/lib/auth.ts:85` | `invalidateSession` uses `deleteMany(where: { id })` — scoped to exactly one session ID, not a bulk operation. |

---

## 2. Defense in Depth

**Definition:** No single security control is relied upon. Multiple independent layers are stacked so that if one fails, another still blocks the attacker.

| Where | What It Does |
|---|---|
| `src/proxy.ts:12-38` (CSRF) | **Layer 1 — Network/Request level:** Blocks cross-origin form submissions before any server action runs. |
| `src/proxy.ts:44-46` (Route guard) | **Layer 2 — Perimeter level:** Redirects unauthenticated users away from protected pages via cookie check. |
| `src/lib/auth.ts:42-80` (Session validation) | **Layer 3 — Application level:** Every server action re-validates the session from the database, not just the cookie. |
| `src/lib/security.ts:9-30` (IP rate limit) | **Layer 4 — Network rate limit:** Caps failed login attempts per IP at 5 per 15 minutes. |
| `src/lib/security.ts:50-71` (Account lockout) | **Layer 5 — Account rate limit:** Locks the account after 10 failed attempts, independent of IP. |
| `src/lib/security.ts:84-93` (Password strength) | **Layer 6 — Input validation:** Rejects weak passwords at registration and reset before they ever reach the database. |
| `src/lib/auth.ts:31-36` (Cookie flags) | **Layer 7 — Transport security:** `httpOnly` prevents XSS theft; `secure` in production enforces HTTPS; `sameSite: "lax"` adds CSRF protection at the cookie level. |
| `src/app/auth/login/actions.ts:28-31` | IP rate limit checked **before** even validating input format — no DB user lookup for blocked IPs. |
| `src/app/auth/login/actions.ts:50-53` | Account lockout checked **after** user found but **before** password verification — no argon2 cost for locked accounts. |
| `src/app/auth/login/actions.ts:55-61` | Password verification with argon2 — even if the database is stolen, passwords remain protected by a memory-hard hash. |

---

## 3. Fail Securely

**Definition:** When something goes wrong — a database error, a missing record, an unexpected exception — the system defaults to denying access rather than granting it.

| Where | What It Does |
|---|---|
| `src/lib/auth.ts:43-44` | `validateSession` returns `null` (denied) if the cookie is missing entirely. It doesn't throw or accidentally grant access. |
| `src/lib/auth.ts:46-54` | Session not found in DB → delete cookie, return `null`. The system assumes "not logged in" rather than creating a new session. |
| `src/lib/auth.ts:56-60` | Session expired → delete from DB, delete cookie, return `null`. Expired sessions are never auto-renewed without validation. |
| `src/app/auth/login/actions.ts:68-71` | Catch-all in login: any unexpected error is caught, logged, and the user sees a generic error. No partial login state. |
| `src/app/auth/register/actions.ts:48-51` | Catch-all in registration: error logged server-side, user sees generic failure. The user is never created in an inconsistent state. |
| `src/app/auth/forgot-password/actions.ts:41-46` | Catch-all in forgot password: even on database error, the response never reveals whether the email existed. |
| `src/app/dashboard/actions.ts:16` | `addEntry` checks `if (!user) return { error: "Unauthorized" }` — a missing/null session blocks the action before any business logic. |
| `src/app/dashboard/actions.ts:46-47` | `updateGoal` does the same null-check — failure to validate means denial. |
| `src/app/settings/actions.ts:7` | `handleLogoutEverywhere` returns `"Unauthorized"` if session is null — never runs `logoutEverywhere` for an unauthenticated caller. |
| `src/lib/prisma.ts:5` | Database URL falls back to `"file:./dev.db"` — if `DATABASE_URL` is missing, the app uses a local file rather than crashing open or connecting to an undefined target. |

---

## 4. Generic Errors

**Definition:** Error messages returned to the user must not distinguish between "this email exists" and "this email does not exist." Attackers use these differences to enumerate valid accounts.

| Where | What It Does |
|---|---|
| `src/app/auth/login/actions.ts:44-48` | User not found: returns `"Invalid email or password."` — same message as a wrong password. |
| `src/app/auth/login/actions.ts:57-61` | Wrong password: same `"Invalid email or password."` message. The attacker cannot distinguish "wrong password" from "no such user." |
| `src/app/auth/register/actions.ts:33-36` | Existing email on registration: returns `"Registration failed. Please try again with different credentials."` — never says "email already taken." |
| `src/app/auth/register/actions.ts:49-50` | Database error on registration: returns the same generic message as above. Even unexpected errors don't leak the email status. |
| `src/app/auth/forgot-password/actions.ts:20-38` | Whether the user exists or not, the action always returns `{ success: true }` — the attacker gets zero information about account existence. |
| `src/app/auth/reset-password/actions.ts:29-31` | Invalid or expired token: returns `"Invalid or expired reset token."` — does not reveal whether the token was wrong, expired, or already used. |

---

## 5. Secure Defaults

**Definition:** Default values — configuration, cookie flags, database fields, fallback behaviors — must be set to the safe option. The developer should have to opt in to less secure behavior.

| Where | What It Does |
|---|---|
| `src/lib/auth.ts:32` | `httpOnly: true` — cookies are inaccessible to JavaScript by default. |
| `src/lib/auth.ts:33` | `secure: process.env.NODE_ENV === "production"` — HTTPS-only in production. |
| `src/lib/auth.ts:34` | `sameSite: "lax"` — cookies are not sent on cross-site requests by default. |
| `prisma/schema.prisma:17` | `failedAttempts Int @default(0)` — a new user starts with zero failed attempts. |
| `prisma/schema.prisma:18` | `lockoutUntil DateTime?` — null by default, meaning "not locked out." |
| `prisma/schema.prisma:61` | `count Int @default(0)` in RateLimit — a new rate limit record starts at zero. |
| `src/lib/security.ts:3-7` | Rate limit and lockout constants are set to restrictive defaults: 5 attempts / 15 minutes for IP, 10 per hour for account. These are conservative starting points. |
| `src/lib/auth.ts:6-7` | Session defaults: cookie name is explicit (`kolo_session`), expiry is 7 days — not infinite, not browser-session-only. |
| `src/app/dashboard/actions.ts:16, 46-47` | Every protected action defaults to `"Unauthorized"` — session must be explicitly valid to proceed. |
| `src/proxy.ts:44-46` | Middleware defaults to redirecting unauthenticated users to login — the protected route is the default stance. |

---

## 6. Separation of Concerns — Auth Logic vs. Business Logic

**Definition:** Authentication concerns (who is this user? are they logged in?) and authorization concerns (can this user do X?) must live separately from business logic (create a savings entry, update a goal). Mixing them makes code harder to audit and easier to bypass.

| Where | What It Does |
|---|---|
| `src/lib/auth.ts` | **Auth logic is centralized** — all session creation, validation, password hashing, and invalidation live in one file. No business logic file duplicates these concerns. |
| `src/lib/security.ts` | **Security logic is centralized** — rate limiting, account lockout, password strength validation all live here. Business actions import these rather than reimplementing them. |
| `src/app/dashboard/actions.ts:15-16` | **Thin auth boundary at the top:** `const user = await validateSession(); if (!user) return { error: "Unauthorized" }` — a single guard line separates auth from business logic. Below it, the functions handle only business concerns (entries, goals). |
| `src/app/settings/actions.ts:6-7` | Same pattern: one auth guard line, then business logic. |
| `src/app/dashboard/page.tsx:10-11` | Server component uses `validateSession()` at the very top before any data fetching or rendering. The page never renders business data for unauthenticated users. |
| `src/app/auth/login/actions.ts` | **Pure authentication** — this file handles only login concerns (validate credentials, manage sessions, apply rate limits). It never touches entries, goals, or any business domain. |
| `src/app/auth/register/actions.ts` | **Pure registration** — only account creation concerns. Never reads or writes business data. |
| `src/app/auth/forgot-password/actions.ts` | **Pure password recovery** — only token generation and expiry management. |
| `src/app/auth/reset-password/actions.ts` | **Pure password reset** — only password hashing, session invalidation, and clearing lockout state. |
| `src/app/api/logout/route.ts` | **Pure session termination** — a single-purpose API endpoint. |

---
