# Design Decisions

## 1. Architecture Flow

A locally runnable TypeScript related-games recommender with an offline AI pipeline for a multi-brand, regulated, real-money casino site.

1. **Dataset (`scripts/generate-catalogue.ts`, `src/utils/degrade.ts`):** LLM generates 88 clean games (`data/catalogue.truth.json`) at `temperature: 0.3` (balances variety across 22-game batches with strict prompt adherence). Seeded degradation (`seed = 42`) produces 100 uneven raw records (`data/catalogue.raw.json`): ~50% complete, ~30% thin, ~20% stubs, plus 12 duplicate edition re-listings (`Deluxe`, `Remastered`, `HD`, `Edition`) sharing `canonicalId`.
2. **Offline AI pipeline (`npm run build:index`):**
   - **Enrich (`src/pipeline/enrich.ts`):** Complete records skip the LLM. Thin/stub records call `openai/gpt-6-luna` (`temperature: 0`, strict JSON Schema + `zod`, 45s timeout, 3 retries with exponential backoff on 429/5xx) to fill missing `themes`, `mechanics`, `volatility`, and an internal `summary` (never shown to players). Hash-cached by `(id, inputHash, promptHash, model)`, falling back to catalogue data on failure.
   - **Embed & precompute (`src/pipeline/embed.ts`, `build-index.ts`):** Embeds gameplay text only with `openai/text-embedding-3-small`, cached locally by `sha256(model + text)` in `data/embedding-cache.json` (unchanged records are never re-embedded). Precomputes top-12 active neighbours per game (`score >= 0.45`, deduped by `canonicalId`) and writes `data/index.json` with **zero 1,536-float vectors** so serving RAM stays flat at scale.
3. **Online service (`npm start`):** Loads `data/index.json` into memory (defaults to `HOST=127.0.0.1`, `PORT=3000`). Serves `GET /v1/recommendations` via **O(1) `gameId` lookup** plus brand/threshold filters in <1 ms, returning `gameId`, `title`, and `score` only.

---

## 2. Key Choices & Parameters

- **Stack:** Node.js `>=22.12` (tested on Node `24`), TypeScript strict ESM via `tsx`, single runtime dependency (`zod` v4), Node built-ins for HTTP/tests/env/fetch (0 `npm audit` vulnerabilities).
- **Secrets:** `SERVICE_API_KEY` (32+ chars, constant-time `x-api-key` check) is isolated to the HTTP service, while `LLM_*` is isolated to the offline pipeline. Request logs redact `x-api-key` and `authorization`.
- **Controlled vocabularies (`src/schema.ts`):** 5 categories (`slot`, `table`, `live`, `instant`, `bingo`), 21 themes, 17 mechanics, 3 volatilities (`low`, `medium`, `high`), 3 brands (`northstar`, `lucky-harbour`, `redcrest`), and per-field `provenance` (`catalogue` | `llm` | `missing`).
- **Regulated fields (`rtp`, `provider`, `brands`, `status`, `releaseDate`):** Structurally excluded from `EnrichmentOutput` and `toEmbeddingText()`, never inferred, never returned in API responses. RTP (Return to Player, `94.35%-96.83%`, `null` on 18 games) is carried through unchanged to verify zero fabrication.
- **Cross-category penalty (`0.12`):** Soft heuristic sized to `text-embedding-3-small`'s score band (~`0.55`-`0.85`) so cross-category title collisions drop below same-category peers without hard-banning strong matches.
- **Decline floor (`DEFAULT_MIN_SCORE = 0.55`):** Lowest threshold in the `0.45`-`0.75` sweep with `0` `mustNot`/decline violations and peak coverage (`98.2%`). Below `0.55`, returns `recommendations: []` and `reason: "NO_CONFIDENT_MATCHES"`.

---

## 3. Evaluation & Metrics (`docs/REPORT.md`)

- **Stage 1 (Enrichment vs `catalogue.truth.json`, `n=28` missing-tag games):** 100% schema validity, `0` factual fabrications, `0` summary compliance violations. LLM F1 must beat a no-LLM "2 most frequent tags" baseline (Themes `0.7429` vs `0.2037`, Mechanics `0.70` vs `0.3308`) and first-run regression floors (`F1 >= 0.70`, `Hit@1 >= 85%`).
- **Stage 2 (Matching vs 23 tag-derived queries in `eval/reference/matching-judgements.json`):** `0` hard-constraint violations across all 300 `(game, brand)` queries, `0` `mustNot` violations, and Enriched `Precision@5` (`0.6909`) >= Raw (`0.6273`), with `Recall@5` `0.2496` vs `0.2264`.

---

## 4. Requirement Traceability

| # | Expectation | Completed | Reasoning |
|---|---|---|---|
| 1 | ~100 uneven fictional games + script | 88 LLM games degraded into 100 records (complete, thin, stubs, 12 duplicates) | Exercises enrichment and deduplication repeatably |
| 2 | Game schema with regulated guardrails | Controlled vocabularies, `canonicalId`, nullable facts, per-field `provenance` | Separates descriptive gameplay fields from regulated facts |
| 3 | AI stage 1: LLM metadata enrichment | Selective LLM on thin/stub records, strict JSON schema + `zod`, hash cache, fallback | Saves tokens on complete records and prevents bad output breaking builds |
| 4 | AI stage 2: semantic embedding matching | Gameplay-only embeddings, model+text hash cache, `0.12` penalty, top-12 precomputed | Gameplay-focused similarity, incremental updates, zero vectors in server RAM |
| 5 | Fast TypeScript service + easy local test | O(1) `gameId` lookup, brand/active/threshold filters, `curl` samples, `npm run demo` | Sub-millisecond serving with zero AI on the request path |
| 6 | Production-shaped security & behaviour | Constant-time `x-api-key` auth, isolated secrets, redacted logs, configurable `HOST`, distinct 404s | Protects the regulated surface and credentials within the 4h scope |
| 7 | Split AI evaluation vs software tests | `npm run eval` -> `docs/REPORT.md` (both AI stages + failure/decline cases) and `npm test` (13 offline tests) | Measures AI quality separately from code contracts |
| 8 | Production ADR, leverage artifact & docs | `docs/ADR.md`, `.agents/skills/prototype-to-production/SKILL.md`, `docs/LEVERAGE.md`, `README.md` | Covers AWS architecture, reusable guardrails, trade-offs, and run steps |
