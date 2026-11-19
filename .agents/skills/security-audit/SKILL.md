---
name: security-audit
description: Mandatory security audit run before completing each implementation step. Ensures zero npm audit vulnerabilities, zero leaked secrets, strict input/output boundaries, and safe server bindings.
---

# Security Audit Skill

Run this audit before finishing **every step**. All checks must pass with zero findings.

## 1. Zero Dependency Vulnerabilities
Run `npm audit`. It must report **0 vulnerabilities** across all dependencies (including devDependencies).
- If a package introduces a vulnerability with no patched version available, replace it (e.g., use Node's built-in `node:test` instead of heavy third-party test runners that pull vulnerable glob/fs trees).
- Keep dependencies minimal: prefer Node built-ins (`node:test`, `node:assert`, `node:crypto`, `node:http`, `process.loadEnvFile`, `fetch`).

## 2. Secret & Credential Hygiene
Verify across the workspace and unstaged/staged changes:
- `.env` is git-ignored and never tracked (`git status --ignored`).
- `.env.example` contains variable names and safe non-secret defaults only (no real keys, no prose).
- No hardcoded keys, tokens, or fallback secret literals exist in `src/`, `scripts/`, `eval/`, or `test/`.
- `loadServiceConfig` and `loadPipelineConfig` remain isolated so `LLM_API_KEY` is never read by the HTTP service and `SERVICE_API_KEY` is never read by the offline pipeline.
- Error messages and logs never echo secret values (verified by unit tests and header redaction for `x-api-key` and `authorization`).

## 3. AI & Regulated-Surface Guardrails
- No LLM or embedding client is imported by the request-serving modules (`src/server.ts`, `src/recommender.ts`).
- `EnrichmentOutput` in `src/schema.ts` strictly excludes factual/regulatory fields (`rtp`, `provider`, `brands`, `status`, `releaseDate`) and uses controlled vocabularies.
- No LLM-generated free text (`summary`) is returned in API responses.

## 4. Network & Input Boundaries
- Server defaults to `127.0.0.1` via configurable `HOST` (local and test servers bind to `127.0.0.1`).
- Service authentication compares `x-api-key` using `crypto.timingSafeEqual`.
- Query parameters (`gameId`, `brand`, `limit`) are validated against strict schemas before use.
