# AGENTS.md

Rules for any coding agent (Antigravity, Claude, Codex, Cursor, ...) working in this repo.
Read `docs/DECISIONS.md` before making changes. It is the source of truth for scope.

## Context

A related-games recommender ("Because you played X, you might like...") for a **player-facing,
regulated, real-money** casino site with a latency budget. Timeboxed take-home: prefer the
smallest correct change over new features. If something is out of scope, note it for the README
instead of building it.

## Architecture rules (do not break)

- **No LLM or embedding calls on the request path.** AI runs only in the offline pipeline, and
  the service serves a prebuilt in-memory index.
- **Deterministic code before AI.** Use plain code for anything a parser/regex can do
  (formats, casing, synonyms). Use the LLM only for semantic gaps.
- **Every LLM response is validated with zod** (`src/schema.ts`) before use. Invalid output is
  rejected and the record falls back to catalogue data. Never loosen a schema to make output pass.
- **The LLM never supplies factual/regulatory fields**: rtp, provider, brands, status,
  releaseDate. Missing facts stay `null`. Do not add these to `EnrichmentOutput`.
- **No generated text reaches players.** API responses contain catalogue ids, titles and scores only.
- **Decline rather than guess.** Below the similarity threshold, return an empty list with a reason.
- Prompts live in `prompts/*.md`, not inline in code. File names carry no version numbers, and
  changes are tracked by content hash and git.

## Secrets

- Never read, print, cat, or log `.env` or environment variable values. Never ask for keys.
- Never hardcode secrets or add default values for them. Config goes through `src/config.ts`.
- The service only loads `SERVICE_API_KEY`, and the pipeline only loads `LLM_*`. Keep them separate.
- Commands that need `LLM_API_KEY` (catalogue generation, index build, enrichment eval) are run
  by the human in their own terminal, not by the agent.
- Redact `authorization` and `x-api-key` in logs. Never put credentials in URLs.

## Code standards

- TypeScript only, strict mode, ESM. Run via `tsx` with no build step.
- Small, pure functions where possible (ranking, normalisation) so they are testable without I/O.
- Add a dependency only when it clearly earns its place, preferring Node built-ins.
- Default server binding to `127.0.0.1` via configurable `HOST`.
- No speculative abstractions, feature flags or "future-proofing" beyond the plan.

## Tests vs evaluation

- `npm test` (`node:test`) checks software behaviour. It must never hit the network: mock the LLM
  client and use fixture vectors.
- `npm run eval` measures AI quality (enrichment vs ground truth, matching vs labelled
  judgements). Do not present test coverage as AI evaluation.

## Workflow

- **Never run `git commit`, `git add`, `git pull`, or `git push`.** The human controls all staging, commits, and remote git operations in their own terminal.
- Follow `.agents/skills/secure-coding/SKILL.md` (including the dead-code/bloat/redundancy pass after each pass) when writing code and `.agents/skills/dependency-scan/SKILL.md` before adding any package.
- Before finishing a step: `npm run typecheck`, `npm test`, and `.agents/skills/security-audit/SKILL.md` (including `npm audit` with 0 vulnerabilities) must pass.
- Keep `README.md` and `docs/DECISIONS.md` in sync when a decision changes.
- Writing style in docs: plain hyphens, no em dashes.
