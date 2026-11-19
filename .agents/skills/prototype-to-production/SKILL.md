---
name: prototype-to-production
description: Reusable productionisation checklist for turning R&D AI prototypes into regulated, player-facing services. Enforces offline/online separation, schema-constrained AI outputs, factual provenance, decline thresholds, and split software/AI evaluation checks.
---

# Prototype-to-Production Skill

Apply these rules whenever converting an R&D AI prototype into a live service on a regulated, latency-sensitive surface. Do not sign off until every rule below is satisfied and verified against the codebase.

## 1. Architecture & Latency Boundary
- **Decouple AI from the request path:** When the input domain is bounded (catalogues, rules, promos, FAQs), run LLM calls, embeddings, and similarity computation offline into a versioned serving artifact. The online service must not import an LLM client or hold raw embedding vectors in RAM when a precomputed key-value lookup suffices.
- **Deterministic code before AI:** Handle formatting, normalisation, synonym stripping, and hard eligibility filters (brand, jurisdiction, active status, duplicate suppression) in plain code. Call the LLM only for genuine semantic gaps, skipping already-complete records.
- **Content-hash caching for both LLM and embedding calls:** Key offline LLM calls by `(id, inputHash, promptHash, model)` and embeddings by `(embeddingModel, text)` so incremental catalogue updates only pay for changed records.

## 2. Regulated-Surface Guardrails
- **Strict schema + structural exclusion:** Define an explicit AI output schema (`zod` / Pydantic + provider JSON Schema) that physically omits regulated/factual fields (RTP, odds, payouts, licensing, availability, release dates). Re-validate every response, and fall back to source data on failure without crashing the batch.
- **Per-field provenance:** Tag every enriched field with its source (`catalogue` | `llm` | `missing`) so downstream consumers and audits can distinguish facts from inferred metadata.
- **No unreviewed generated text to end users:** Restrict live API responses to canonical IDs, catalogue titles, and scores, keeping LLM-generated summaries internal.
- **Decline rather than guess:** Enforce a confidence/similarity floor and return an empty result with an explicit machine-readable reason (e.g. `NO_CONFIDENT_MATCHES`) so callers hide the surface instead of showing weak matches.

## 3. Split Evaluation & Pass Checks
- **Software tests (`npm test` / `pytest`):** 100% offline with mocked AI clients and fixture data. Cover API contracts, auth, input validation, hard filters, caching, and error fallbacks. Never present test coverage as AI quality evaluation.
- **Stage-by-stage AI evaluation (`npm run eval`):** Evaluate each AI stage separately and fail the build (`exit 1`) on any failed check:
  - *Safety rules (always strict):* 100% schema validity, `0` factual-field fabrications, `0` compliance/hype violations, `0` hard-constraint or `mustNot` violations.
  - *Baseline comparisons (proves AI earns its cost):* Each AI stage must beat a non-AI baseline (e.g. LLM tagger vs most-frequent-tags predictor, and enriched matching vs raw un-enriched matching).
  - *Regression baselines:* Record initial quality scores with sample size `n` as regression floors rather than arbitrary quality claims, and publish concrete failure and decline cases in the report.

## 4. Operational Sign-Off
- **Zero secret leakage & credential isolation:** Isolate inbound service credentials (`SERVICE_API_KEY`) from outbound AI credentials (`LLM_API_KEY`) across processes. Prohibit committed keys or fallback defaults, keep `.env` gitignored, never pass credentials in URLs or echo them in error messages, redact auth headers in structured logs, and default server binding to `127.0.0.1` via a configurable `HOST` environment variable.
- Document production architecture, rejected alternatives, player-facing failure behaviour (hiding the UI widget on error), scaling triggers, and revisit criteria in a concise ADR (`docs/ADR.md`).
