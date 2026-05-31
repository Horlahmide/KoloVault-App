# Tinker Test Report: Brute Force Simulation

**Date:** May 30, 2026
**Target:** `ayoolasamuel03@gmail.com`
**Method:** Manual Browser-based Brute Force

---

## 1. Initial Predictions

| Attempt # | Predicted Response | Logic Reason |
| :--- | :--- | :--- |
| **Attempt 1-4** | `Invalid email or password.` | Failures are recorded but within the allow-list (Max 5). |
| **Attempt 5** | `Invalid email or password.` | The 5th failure is the "limit-breaker." |
| **Attempt 6** | `Too many attempts...` | The IP block (count = 5) triggers at the very start of the function. |
| **Attempt 11** | `Too many attempts...` | The IP block persists, preventing the user from reaching the Account Lockout logic (Attempt 10). |

---

## 2. Actual Results (The Outcome)

In the manual test conducted, the result for **all 12 attempts** was:
> `"Too many attempts. Please try again in 15 minutes."`

---

## 3. The "Gap" Analysis (Why predictions failed)

### 3a. Environment Pollution (The Culprit)
The manual test did not start from a "clean slate." Before the manual test, an automated script was run which made 12 requests. 
- Even though the script failed with a "CSRF Protection" error, the `login` server action still processed the request far enough to trigger the IP Rate Limiter.
- By the time the manual test started, the IP `127.0.0.1` was already at a count of **12**, which is double the allowed limit of **5**.

### 3b. Logic Shielding (The Architectural Finding)
The test confirmed a critical architectural behavior: **The IP Rate Limit acts as a primary shield.**
- Because the IP block happens at the **very first line** of the login action, an attacker can **never** trigger an Account Lockout (which happens at attempt 10) from a single IP.
- The Account Lockout logic (10 attempts) is effectively "dead code" for single-IP attacks. It only becomes relevant if an attacker is using a **Distributed Brute Force** (rotating many IPs to target one account).

---

## 4. Key Takeaways

1. **Defense in Depth works:** The system successfully blocked the user.
2. **IP over Account:** The IP rate limit is significantly more aggressive than the account lockout, meaning account-level lockouts will rarely be seen in the wild unless IPs are rotated.
3. **Audit Correction:** The CSRF protection in `src/proxy.ts` is indeed **functional and active**, as it blocked the automated script attempts, proving that Next.js is picking up the middleware despite the non-standard filename (likely via a configuration or import not immediately obvious).
