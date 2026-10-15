# RescueOS Security Architecture & Threat Model

RescueOS operates as an offline emergency-response coordination platform deployed on local Wi-Fi access points during disasters where cellular, internet, and cloud infrastructure are completely severed.

---

## 1. Threat Model & Operational Context

In a disaster scenario, RescueOS is accessed via:
1. **Ad-hoc Local Wi-Fi Access Point (Hotspot):** Unencrypted or WPA2-PSK local network hosted from a rescue laptop.
2. **Untrusted Client Devices:** Civilian smartphones, field responder tablets, and unknown local devices connecting to the hotspot.
3. **No External Internet Access:** No Certificate Authorities (CA), no cloud identity providers (OAuth/SAML), no remote telemetry.

---

## 2. Protected Assets

| Asset | Protection Level | Threat / Impact | Security Mechanism |
| :--- | :--- | :--- | :--- |
| **Survivor PII & Locations** | High | Doxxing, kidnapping, harassment in disaster zone | Server-side RBAC masking; non-sensitive QR cards |
| **Official Announcements** | Critical | False panic, malicious evacuation orders | Restricted to `COORDINATOR` and `ADMIN` with audit trail |
| **SOS Status & Dispatch** | Critical | False resolution, diversion of rescue boats | Server-side validation; role-restricted state machine |
| **System Integrity & Host OS** | Critical | Host compromise, remote code execution (RCE) | Path traversal guards, zero native compiler dependencies |
| **Audit Log Ledger** | Critical | Tampering with emergency operational record | Append-only SQLite table with event UUIDs |

---

## 3. Attack Surface & Defensive Controls

### 3.1 SQL Injection (SQLi)
* **Risk:** Attacker manipulates input to extract survivor records or drop tables.
* **Control:** 100% of database interactions utilize prepared statements with parameterized inputs via Node.js built-in `node:sqlite` (`DatabaseSync.prepare('...').run(?)`). Zero string concatenation is permitted in SQL queries.

### 3.2 Cross-Site Scripting (XSS)
* **Risk:** Malicious survivor name or emergency message injected with `<script>` tags to hijack coordinator sessions.
* **Control:**
  - Client-side contextual HTML entity escaping (`esc()` converting `&`, `<`, `>`, `"`, `'`).
  - Strict Content-Type headers (`text/html; charset=utf-8`, `application/json`).
  - Security headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.

### 3.3 Path Traversal (Directory Traversal)
* **Risk:** Malicious HTTP GET request (e.g., `GET /../../../../etc/passwd` or `C:\boot.ini`) to read sensitive host files.
* **Control:**
  - `path.normalize()` and `decodeURIComponent()`.
  - Prefix verification: `if (!safePath.startsWith(ROOT)) return 403 Forbidden`.
  - Only regular files (`statSync().isFile()`) within the web root are streamed.

### 3.4 Broken Access Control & IDOR
* **Risk:** Civilian user calls `/api/announcements` or reassigns emergency teams.
* **Control:**
  - Multi-tier Role-Based Access Control (`CITIZEN`, `VOLUNTEER`, `MEDICAL`, `COORDINATOR`, `ADMIN`).
  - Server-side token validation on every request via cryptographic session tokens.
  - Authorization enforced before every state mutation.

### 3.5 Brute-Force & Credential Stuffing
* **Risk:** Automated dictionary attack against standard responder passwords.
* **Control:**
  - In-memory sliding window rate limiter tracking client IP.
  - Maximum 5 failed attempts per 60-second window before HTTP 429 lock-out.
  - Constant-time password verification via `crypto.timingSafeEqual` preventing timing analysis.

### 3.6 Password Hashing & Secret Storage
* **Risk:** Offline database theft exposing plaintext passwords.
* **Control:**
  - Key derivation using `crypto.scryptSync()` with unique 16-byte cryptographically secure random salts.
  - Zero plaintext passwords in memory or database.

### 3.7 Denial of Service (DoS) via Payload Flooding
* **Risk:** Host memory exhaustion via huge JSON payloads.
* **Control:**
  - Body stream parser enforces strict 2MB maximum threshold; exceeds will immediately destroy stream (`req.destroy()`).

---

## 4. Known Operational Limitations

1. **Local Wi-Fi Encryption:**
   - In open emergency hotspots without 802.1X/WPA Enterprise, unencrypted Wi-Fi frames can theoretically be sniffed over the air by nearby actors.
   - *Mitigation:* HTTPS with a pre-installed local self-signed certificate authority is documented in `DEPLOYMENT.md` for hardened multi-station field deployments.
2. **Local Physical Access:**
   - Anyone with direct keyboard access to the host laptop has access to the local SQLite database. Full-disk encryption (LUKS / BitLocker) should be enabled on field hardware.

---

## 5. Vulnerability Reporting

To report a vulnerability or operational security issue in RescueOS, please contact the emergency systems maintainers or open a restricted security issue in the repository.
