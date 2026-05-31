# Kolo Kept — Full Codebase Explanation

Kolo Kept is a **savings tracker** web app. It lets people sign up, log in, record how much money they saved each day, set a savings goal, and see their progress. It's built with Next.js (App Router), uses SQLite as its database (via Prisma), and has lots of security features.

---

## 1. What Is the App Made Of? (File Layout)

```
src/
├── app/                          # All the pages and API routes
│   ├── page.tsx                  # Homepage — just redirects to /dashboard
│   ├── layout.tsx                # The outer HTML shell (fonts, CSS)
│   ├── globals.css               # Tailwind CSS styles
│   ├── api/logout/route.ts       # API endpoint to log out
│   ├── auth/
│   │   ├── login/page.tsx        # Login page (what you see)
│   │   ├── login/actions.ts      # Login logic (what the computer does)
│   │   ├── register/page.tsx     # Sign-up page
│   │   ├── register/actions.ts   # Sign-up logic
│   │   ├── forgot-password/page.tsx
│   │   ├── forgot-password/actions.ts
│   │   ├── reset-password/page.tsx
│   │   └── reset-password/actions.ts
│   ├── dashboard/page.tsx        # Main dashboard after login
│   ├── dashboard/actions.ts      # Add entry & update goal logic
│   ├── dashboard/EntryForm.tsx   # The "Add Savings Entry" form
│   ├── dashboard/GoalForm.tsx    # The "Set Goal" mini-form
│   └── settings/page.tsx         # Settings page (log out everywhere)
│       └── settings/actions.ts
├── lib/
│   ├── prisma.ts                 # Connects to the database
│   ├── auth.ts                   # Password hashing, sessions
│   ├── security.ts               # Rate limiting, account lockout
│   └── generated/                # Prisma auto-generated code
├── proxy.ts                      # Middleware that runs on every request
prisma/
├── schema.prisma                 # Database model definitions
└── migrations/                   # SQL to create the database tables
```

---

## 2. The Database — What Gets Saved Where

The database has **5 tables** (like 5 different boxes where information is stored):

### User (the people box)
- `id` — a unique name for each person (cuid)
- `email` — their email address (must be unique)
- `passwordHash` — their password, scrambled so nobody can read it
- `failedAttempts` — how many times they typed the wrong password (starts at 0)
- `lockoutUntil` — if they're in "time-out", when time-out ends
- `resetToken` — a secret code to reset their password
- `resetExpires` — when that secret code expires
- `createdAt` / `updatedAt` — when they joined / last changed

### Session (the login cookies box)
- `id` — a random code that goes into the browser's cookie
- `userId` — which person this session belongs to
- `expiresAt` — when this login expires (7 days)
- `userAgent` / `ipAddress` — info about the device they used

### Entry (the savings records box)
- `id` — unique name for this record
- `userId` — who saved this money
- `amount` — how much money
- `note` — what it's for
- `date` — when they saved it

### Goal (the savings target box)
- `id` — unique name for this goal
- `userId` — who set the goal (only one goal per person)
- `targetAmount` — how much they want to save total

### RateLimit (the "stop bothering us" box)
- `key` — a label like `login:ip:127.0.0.1`
- `count` — how many login attempts came from this IP
- `lastAttempt` — when the last attempt happened

---

## 3. The Middleware — What Happens on Every Request (`proxy.ts`)

The file `src/proxy.ts` is a **middleware** — code that runs on **every single request** before the page loads. It does two things:

### 3a. CSRF Protection (stops bad guys from tricking you)

When you submit a form (like login), the middleware checks that the request came from the same website, not from a bad guy's page.

- It looks at the `Origin` header (where the request came from) and the `Host` header (where the request is going).
- If they don't match → **blocked with error 403** ("CSRF Protection: Invalid Origin").
- If neither Origin nor Referer is present on mutating requests (POST, PUT, DELETE, PATCH) → **blocked**.

### 3b. Route Protection (keeps pages private)

- If you try to visit `/dashboard`, `/settings`, or `/` **without** a session cookie → you get sent to `/auth/login`.
- If you already have a session cookie and try to visit `/auth/login` or `/auth/register` → you get sent to `/dashboard`.
- API routes (`/api/...`) are NOT protected by this middleware.

---

## 4. How Rate Limiting Decides When to Block a Request

Rate limiting is like **saying "slow down!" when someone tries too many times**. It lives in `src/lib/security.ts`.

### The Rules (constants)
- **IP_RATE_LIMIT_MAX = 5** — maximum 5 failed attempts per IP address
- **IP_RATE_LIMIT_WINDOW_MS = 15 minutes** — that 5-attempt window resets after 15 minutes
- **ACCOUNT_LOCKOUT_MAX = 10** — after 10 wrong passwords on the same account, lock it
- **ACCOUNT_LOCKOUT_WINDOW_MS = 1 hour** — the account stays locked for 1 hour

### checkIpRateLimit(ip) — "Should we let this request through?"

1. Look in the **RateLimit** table for a record with key = `login:ip:<the IP address>`.
2. If no record exists → **allow** (return `true`).
3. If a record exists, check the time:
   - If **more than 15 minutes** have passed since `lastAttempt` → reset count to 0, set `lastAttempt = now` → **allow**.
   - If **less than 15 minutes** have passed → check if `count < 5`:
     - Yes → **allow**
     - No → **block** (return `false`)

### incrementIpRateLimit(ip) — "Count this failed attempt"

This is called whenever a login attempt fails (wrong email format, user not found, wrong password). It uses `upsert` — which means "update if exists, create if not":

- If a RateLimit record for this IP exists → add 1 to `count`, update `lastAttempt`.
- If not → create a new record with `count = 1` and `lastAttempt = now`.

### In the login flow (`login/actions.ts`):

```
User submits form
       │
       ▼
checkIpRateLimit(ip) → if false, reject with "Too many attempts"
       │
       ▼
validate email format → if invalid, incrementIpRateLimit(ip) + reject
       │
       ▼
find user by email → if not found, incrementIpRateLimit(ip) + reject
       │
       ▼
check account lockout → if locked, reject with "Account temporarily locked"
       │
       ▼
verify password → if wrong, incrementIpRateLimit(ip) + handleFailedLogin(user.id) + reject
       │
       ▼
SUCCESS → resetFailedLogin(user.id) + create session
```

---

## 5. How Account Lockout State Is Stored and Checked

### Stored on the User record itself

Every `User` has:
- `failedAttempts` (number) — starts at 0, goes up by 1 each wrong password
- `lockoutUntil` (date or null) — when the lockout ends

### handleFailedLogin(userId) — "Record a wrong password"

1. Find the user by their `id`.
2. Add 1 to `failedAttempts`.
3. If `failedAttempts >= 10` → set `lockoutUntil` to **now + 1 hour**.
4. Save both values to the database.

### During login — "Is this account locked?"

In `login/actions.ts` line 51:
```
if (user.lockoutUntil && user.lockoutUntil > new Date()) {
    return { error: "Account temporarily locked. ..." };
}
```

This checks: "Does `lockoutUntil` exist AND is it still in the future?" If yes → block.

### resetFailedLogin(userId) — "They got it right!"

When a user logs in successfully:
```
failedAttempts = 0
lockoutUntil = null
```

This clears the lockout state completely.

### When does lockout get cleared?

1. **Successful login** — `resetFailedLogin()` sets attempts to 0.
2. **Password reset** — `reset-password/actions.ts` also sets `failedAttempts: 0, lockoutUntil: null`.
3. **Time passing** — the app checks `lockoutUntil > new Date()`, so once the lockout time passes, the user just needs to wait. The next login attempt after the lockout expires will go through (provided they aren't still rate-limited).

### The two layers together

- **IP Rate Limit** blocks the **device/network** (5 failures per 15 minutes).
- **Account Lockout** blocks the **user account** (10 failures per 1 hour).
- They work together: a single attacker sees IP blocks first, then if they keep trying from different IPs, the account itself locks.

---

## 6. How the Password Reset Token Flow Works

This is a **step-by-step journey** from "I forgot my password" to "I'm logged in again."

### Step 1: User visits /auth/forgot-password

The **page** (`forgot-password/page.tsx`) shows a simple form with one field: **Email Address**. When the user types their email and clicks "Send Reset Link", it calls the server action:

### Step 2: Server action runs (forgot-password/actions.ts)

```
"use server";

export async function forgotPassword(formData: FormData) {
    const email = formData.get("email");

    // If email looks invalid (no @), return error
    if (!email || !email.includes("@")) {
        return { error: "Invalid email address." };
    }

    // Look up user by email
    const user = await prisma.user.findUnique({ where: { email } });

    if (user) {
        // User EXISTS → generate a reset token
        const resetToken = nanoid(48);   // 48 random characters
        const resetExpires = new Date(Date.now() + 3600000);  // 1 hour from now

        // Save token + expiry on the User record
        await prisma.user.update({
            where: { id: user.id },
            data: { resetToken, resetExpires },
        });

        // Log the reset link to console (no email server in this project)
        console.log(`http://localhost:3000/auth/reset-password?token=${resetToken}`);
    } else {
        // User DOESN'T EXIST → still pretend everything is fine
        // This prevents attackers from finding out which emails are registered
        console.log(`Password reset requested for non-existent email: ${email}`);
    }

    // IMPORTANT: Always return { success: true } — whether user exists or not
    return { success: true };
}
```

**Security detail:** The app always says "Check your inbox" (via `{ success: true }`) even when the email doesn't exist. This is called **generic error messages** — it prevents an attacker from learning "this email is registered" vs "this email is not registered."

### Step 3: User receives the link (via console log)

For this project, the reset link is printed to the **server console** (since there's no real email server). The link looks like:

```
http://localhost:3000/auth/reset-password?token=abc123...48chars
```

### Step 4: User clicks the link → visits /auth/reset-password?token=...

The **page** (`reset-password/page.tsx`) reads `token` from the URL's query string using `useSearchParams()`. If no token is found, it shows "Invalid Link." If a token is found, it shows a form with one field: **New Password**.

When the user types a new password and clicks "Reset Password", it calls:

### Step 5: Server action runs (reset-password/actions.ts)

```
"use server";

export async function resetPassword(formData: FormData) {
    const token = formData.get("token");
    const password = formData.get("password");

    // 1. No token? Reject
    if (!token) return { error: "Invalid token." };

    // 2. Validate password strength
    if (!validatePassword(password)) {
        return { error: "Password must be at least 12 characters..." };
    }

    // 3. Find user with this token that hasn't expired
    const user = await prisma.user.findFirst({
        where: {
            resetToken: token,
            resetExpires: { gt: new Date() },  // token must not be expired
        },
    });

    // 4. No user found with this token? Reject
    if (!user) {
        return { error: "Invalid or expired reset token." };
    }

    // 5. Hash the new password
    const passwordHash = await hashPassword(password);

    // 6. Update user: new password, clear token, clear lockout
    await prisma.user.update({
        where: { id: user.id },
        data: {
            passwordHash,        // new scrambled password
            resetToken: null,    // token can only be used once
            resetExpires: null,  // clear expiry too
            failedAttempts: 0,   // unlock the account
            lockoutUntil: null,  // unlock the account
        },
    });

    // 7. Log them out everywhere (safety — someone else might have stolen the token)
    await prisma.session.deleteMany({ where: { userId: user.id } });

    return { success: true };
}
```

### Step 6: User sees success and logs in

The page shows "Password Reset Successful!" with a button to "Go to Login." The user clicks it, types their email + new password, and logs in normally.

### Why the verification in step 3 uses `findFirst` not `findUnique`

The `resetToken` field is marked `@unique` in the schema, so normally you'd use `findUnique`. But the code uses `findFirst` with two conditions:
- `resetToken: token` — must match the token
- `resetExpires: { gt: new Date() }` — must not be expired

This finds the **first user** whose token matches AND hasn't expired. If the token expired, no user is returned, and the request is rejected.

### Token expiration — 1 hour

The token is valid for **exactly 1 hour** (`Date.now() + 3600000`). After that, `resetExpires` is in the past, and the `gt: new Date()` check fails. The user would need to start over.

### Token is one-time use

After a successful reset, `resetToken` is set to `null`. If someone tries to use the same token again, `findFirst` returns no results because `resetToken: token` won't match a `null` field. So the token can never be reused.

---

## 7. How Sessions Work (Staying Logged In)

### Creating a session (`auth.ts:createSession`)

1. Generate a random 32-character ID using `nanoid(32)`.
2. Calculate expiry = **now + 7 days**.
3. Save session to database: `{ id, userId, expiresAt, userAgent, ipAddress }`.
4. Set a cookie named `kolo_session` in the browser with the session ID.
   - `httpOnly: true` — JavaScript in the browser can't read it (prevents XSS theft)
   - `secure: true` in production — only sent over HTTPS
   - `sameSite: "lax"` — helps prevent CSRF
   - `expires` matches the session expiry

### Validating a session (`auth.ts:validateSession`)

1. Read the `kolo_session` cookie from the request.
2. Find the session in the database.
3. If no session found → delete cookie, return `null` (not logged in).
4. If session is expired (now >= expiresAt) → delete session from DB, delete cookie, return `null`.
5. If session is **more than halfway to expiring** (3.5 days old) → **renew it** for another 7 days.
6. Return the `user` object (the person is logged in).

### Invalidating a session (`auth.ts:invalidateSession`)

1. Read the cookie, delete all sessions with that ID from DB, delete the cookie.
Used by the `/api/logout` endpoint.

### Invalidating all sessions (`auth.ts:logoutEverywhere`)

1. Delete **all** sessions belonging to a user, delete the cookie.
Used by the "Log out everywhere" button in Settings.

---

## 8. The Password Strength Rule

In `security.ts:validatePassword`:

```js
if (password.length < 12) return false;
const hasUpper = /[A-Z]/.test(password);        // at least 1 uppercase letter
const hasLower = /[a-z]/.test(password);        // at least 1 lowercase letter
const hasDigit = /[0-9]/.test(password);         // at least 1 number
const hasSymbol = /[!@#$%^&*(),.?":{}|<>]/.test(password);  // at least 1 symbol
return hasUpper && hasLower && hasDigit && hasSymbol;
```

A password is only accepted if it has **all 4 character types** and is **at least 12 characters** long.

---

## 9. Full Request Flow Example (Login)

```
Browser                         Next.js                        Database
  │                               │                               │
  │  POST /auth/login              │                               │
  │  (email + password)            │                               │
  │──────────────────────────────►│                               │
  │                               │                               │
  │                          ┌────┴────┐                          │
  │                          │ proxy.ts│— CSRF check OK           │
  │                          │         │— route OK (no session)   │
  │                          └────┬────┘                          │
  │                               │                               │
  │                          ┌────┴────┐                          │
  │                          │actions.ts│                         │
  │                          │         │                          │
  │                          │ 1. checkIpRateLimit(ip) ────────►│  SELECT FROM RateLimit
  │                          │◄──────────────────────────────────│  (allowed — under 5)
  │                          │         │                          │
  │                          │ 2. validate email (Zod) ─── OK    │
  │                          │         │                          │
  │                          │ 3. findUnique(email) ───────────►│  SELECT FROM User
  │                          │◄──────────────────────────────────│  (found!)
  │                          │         │                          │
  │                          │ 4. Check lockoutUntil ─── not     │
  │                          │    locked                          │
  │                          │         │                          │
  │                          │ 5. verifyPassword(password, hash) │
  │                          │    ─── argon2.verify() ─── MATCH! │
  │                          │         │                          │
  │                          │ 6. resetFailedLogin(id) ────────►│  UPDATE User
  │                          │    attempts=0, lockout=null       │
  │                          │         │                          │
  │                          │ 7. createSession(id) ────────────►│  INSERT Session
  │                          │    cookie: kolo_session=abc...    │
  │                          │◄──────────────────────────────────│
  │                          └────┬────┘                          │
  │                               │                               │
  │  { success: true }            │                               │
  │◄──────────────────────────────│                               │
  │                               │                               │
  │  Browser saves cookie         │                               │
  │  Router redirects to          │                               │
  │  /dashboard                   │                               │
```

---

## 10. Summary of Security Layers

| Layer | What it protects | Mechanism | Limits |
|---|---|---|---|
| CSRF Protection | Form submissions from other websites | Origin/Host header check | Blocks mismatched origins |
| Route Protection | Private pages (dashboard, settings) | Session cookie check | Redirects to login |
| IP Rate Limiting | Too many attempts from one network | RateLimit table with sliding window | 5 attempts per 15 minutes |
| Account Lockout | Too many wrong passwords on one account | `failedAttempts` + `lockoutUntil` on User | 10 attempts per 1 hour |
| Password Hashing | Stolen database secrets | argon2 (slow, memory-hard hash) | N/A |
| Password Strength | Weak passwords | `validatePassword()` | 12 chars, upper, lower, digit, symbol |
| Session Security | Hijacked cookies | httpOnly, secure, sameSite flags | N/A |
| Session Expiry | Stale sessions | 7-day expiry with refresh | Auto-deleted after 7 days |
| Generic Error Messages | Account enumeration | Always return same message | Never say "email not found" |
| One-Time Reset Token | Stolen reset links | Token deleted after use + expires in 1 hour | Single use + time limit |
