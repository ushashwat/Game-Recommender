---
name: secure-coding
description: Backend and API secure coding rules for this TypeScript service. Enforces input allow-lists, strict authentication, safe secret handling, security headers, safe default loopback binding, and removal of dead code, bloat, and redundant logic.
---

# Secure Coding Skill

Apply these rules whenever creating or modifying code in `src/`, `scripts/`, `eval/`, or `test/`:

## 1. Input Validation & Allow-Listing
- Treat all external inputs (query strings, headers, upstream catalogue JSON, LLM responses) as untrusted.
- Validate against strict `zod` schemas using explicit regexes, numeric bounds, and enum allow-lists before use.
- Reject unexpected HTTP methods (allow only `GET` on this service, returning `405` otherwise).

## 2. Authentication & Secrets
- Authenticate all non-health endpoints using constant-time comparison (`crypto.timingSafeEqual`).
- Never commit secrets or provide fallback literal values in code. If a required secret is missing, fail fast at startup.
- Never pass secrets in URL query parameters or request bodies. Use HTTP headers (`x-api-key`, `Authorization`) over HTTPS.
- Never log secrets, tokens, or raw auth headers. Always redact `x-api-key` and `authorization`.

## 3. Response Hardening & Error Handling
- Set `Content-Type: application/json; charset=utf-8`, `X-Content-Type-Options: nosniff`, and `Cache-Control: no-store` on API responses.
- Return structured error codes (`UNAUTHORIZED`, `INVALID_QUERY`, `GAME_NOT_FOUND`, `GAME_INACTIVE`, `GAME_NOT_ON_BRAND`) without leaking stack traces or internal paths to callers.

## 4. Network & File Boundaries
- Default server binding to `127.0.0.1` via configurable `HOST` (test servers bind to `127.0.0.1`).
- Never pass user-controlled input into file system paths (`fs.readFileSync`, `fs.writeFileSync`) or shell commands.

## 5. Dead Code, Bloat & Redundancy Pass
After every pass, inspect all touched files and resolve:
- **Dead code:** remove unused exports, unreferenced helpers, unused imports, or unreachable branches.
- **Redundant logic:** collapse duplicate validation, repeated string/array transforms, or wrapper functions that add no value.
- **Bloat:** keep files concise and focused, stripping banner comments (`// ----`), verbose boilerplate, and dependencies that Node built-ins already cover.
