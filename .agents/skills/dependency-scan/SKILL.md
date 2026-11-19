---
name: dependency-scan
description: Pre-install dependency check. Run before adding any npm package to verify necessity and enforce zero npm audit vulnerabilities.
---

# Dependency Scan Skill

Run this check **before** adding or importing any new package in `package.json`:

## 1. Necessity Check (Prefer Node Built-ins)
- Do not add a package if Node 22+ built-ins cover the need (`fetch`, `node:http`, `node:test`, `node:assert`, `node:crypto`, `process.loadEnvFile`).
- Every runtime dependency increases supply-chain and vulnerability surface.

## 2. Audit Verification
- Run `npm audit` after installation. It must report **0 vulnerabilities**.
- If any package (or its transitive tree) introduces a vulnerability with no clean fix, uninstall it immediately and use a built-in or zero-dependency alternative.
