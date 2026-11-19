# AI Game Recommender

A locally runnable TypeScript related-games recommendation service with an offline AI enrichment and embedding pipeline, built for a multi-brand, regulated, real-money casino site.

- **Design Decisions:** [`docs/DECISIONS.md`](./docs/DECISIONS.md)
- **Production Architecture (ADR):** [`docs/ADR.md`](./docs/ADR.md)
- **Reusable Leverage Artifact & Note:** [`.agents/skills/prototype-to-production/SKILL.md`](./.agents/skills/prototype-to-production/SKILL.md), [`docs/LEVERAGE.md`](./docs/LEVERAGE.md)
- **AI Evaluation Report:** [`docs/REPORT.md`](./docs/REPORT.md)

---

## Quick Start

### 1. Install Node.js
Requires Node.js `>=22.12` (tested on Node `24`). Install from [nodejs.org](https://nodejs.org/) or via `nvm`:
```bash
nvm install 24 && nvm use 24
node -v
```

### 2. Install and run software tests
```bash
npm install
npm run typecheck
npm test
```

### 3. Set `SERVICE_API_KEY` and start the server
`SERVICE_API_KEY` protects `GET /v1/recommendations` so only callers with the `x-api-key` header can query it, kept separate from `LLM_API_KEY`.

Create `.env` and generate a local key:
```bash
cp .env.example .env
# node -e "console.log('SERVICE_API_KEY=' + require('crypto').randomBytes(32).toString('hex'))" >> .env
```

Start the server (`HOST` defaults to `127.0.0.1`, `PORT` defaults to `3000`):
```bash
npm start
```

### 4. Test the service

Catalogue IDs are `g_0001`-`g_0100` in `data/catalogue.raw.json` (used below: `g_0001` = Tomb of Anubis, `g_0088` = sole bingo outlier, `g_0016` = inactive game). `npm run demo` accepts either a title or an ID.

*(On PowerShell, use `curl.exe` and `$env:SERVICE_API_KEY`. `brand` is optional and defaults to the game's primary brand.)*

#### Health check (`GET /health`)
```bash
curl -s http://127.0.0.1:3000/health
```
```json
{
  "status": "ok",
  "indexVersion": "idx_47d4f8eadbd06f7f",
  "catalogueSize": 100,
  "brands": ["northstar", "lucky-harbour", "redcrest"]
}
```

#### CLI demo (`npm run demo`)
```bash
npm run demo -- "Tomb of Anubis"
```
```text
Because you played Tomb of Anubis, you might like...
  1. Tomb of Anubis Megaways
  2. Scarab Caravan
  3. Jungle Relic Expedition
  4. Pharaoh's Curse
  5. Sphinx Gateways
```
Run `npm run demo` with no arguments to list available brands and usage.

#### Recommendations endpoint (`GET /v1/recommendations`)
Export `SERVICE_API_KEY` once in your terminal, then unset it when done:
```bash
# macOS / Linux
export SERVICE_API_KEY="<your-key>"
# unset SERVICE_API_KEY

# Windows PowerShell
$env:SERVICE_API_KEY = "<your-key>"
# Remove-Item Env:SERVICE_API_KEY
```

##### `200 OK` - matches found
```bash
curl -s -H "x-api-key: $SERVICE_API_KEY" \
  "http://127.0.0.1:3000/v1/recommendations?gameId=g_0001&limit=3"
```
```json
{
  "gameId": "g_0001",
  "brand": "northstar",
  "indexVersion": "idx_47d4f8eadbd06f7f",
  "recommendations": [
    { "gameId": "g_0003", "title": "Tomb of Anubis Megaways", "score": 0.9442 },
    { "gameId": "g_0010", "title": "Scarab Caravan", "score": 0.8204 },
    { "gameId": "g_0022", "title": "Jungle Relic Expedition", "score": 0.811 }
  ]
}
```

##### `200 OK` - below confidence threshold (no matches returned)
```bash
curl -s -H "x-api-key: $SERVICE_API_KEY" \
  "http://127.0.0.1:3000/v1/recommendations?gameId=g_0088"
```
```json
{
  "gameId": "g_0088",
  "brand": "lucky-harbour",
  "indexVersion": "idx_47d4f8eadbd06f7f",
  "recommendations": [],
  "reason": "NO_CONFIDENT_MATCHES"
}
```

##### `404 Not Found` (`GAME_NOT_FOUND`, `GAME_INACTIVE`, `GAME_NOT_ON_BRAND`)
```bash
curl -s -H "x-api-key: $SERVICE_API_KEY" \
  "http://127.0.0.1:3000/v1/recommendations?gameId=g_0016"
```
```json
{ "error": "GAME_INACTIVE", "gameId": "g_0016", "title": "Pegasus Over the Aegean" }
```
```bash
curl -s -H "x-api-key: $SERVICE_API_KEY" \
  "http://127.0.0.1:3000/v1/recommendations?gameId=g_0001&brand=lucky-harbour"
```
```json
{
  "error": "GAME_NOT_ON_BRAND",
  "gameId": "g_0001",
  "title": "Tomb of Anubis",
  "brand": "lucky-harbour",
  "availableBrands": ["northstar", "redcrest"]
}
```

### 5. Run the AI evaluation
Evaluates both offline AI stages separately from software tests and writes [`docs/REPORT.md`](./docs/REPORT.md):
- **Stage 1 (LLM enrichment):** schema validity, zero fabricated facts, and theme/mechanic F1 against ground truth (`data/catalogue.truth.json`) vs a no-LLM baseline.
- **Stage 2 (embedding matching):** `Precision@5`, `Recall@5`, zero rule/`mustNot` violations, enriched vs raw baseline, and threshold sweep across 23 queries (`eval/reference/matching-judgements.json`). See [`docs/DECISIONS.md`](./docs/DECISIONS.md) for pass criteria rationale.
```bash
npm run eval
```

### 6. Optional - Regenerate data and index
Requires `LLM_API_KEY` in `.env` (defaults to OpenRouter, and also works with OpenAI or Ollama via `LLM_BASE_URL`):
```bash
npm run generate:catalogue
npm run build:index
npm run eval
```

---

## Assumptions
- The API accepts `gameId` because it is a backend-to-backend service called by a game page that already has the ID. Titles are not unique across studios or editions, whereas `gameId` gives exact O(1) lookup, clean caching, and strict input validation. `npm run demo` resolves titles locally, and unknown, inactive, or off-brand IDs return `404`.
- `brands[]` controls which casino brands can offer each game. Per-player checks (such as self-exclusion or stake limits) depend on user-account data and are handled by the calling casino platform.
- Recommendations are item-to-item only (no player history or collaborative filtering).
- Enrichment ground truth is the clean synthetic catalogue before degradation.

## Known Limitations
- **Enrichment does not help every individual game:** Average `Precision@5` rises (`0.6273` to `0.6909`), but individual games can lose a good neighbour after enrichment (e.g. `Osiris and the Green Kingdom`).
- **Small, synthetic evaluation set:** Only `28` degraded games for enrichment and `23` tag-derived matching queries (no real player clicks or human ratings), so metrics are directional and do not prove live commercial lift.
- **Score threshold depends on the current model and catalogue:** `0.55` was calibrated for `text-embedding-3-small` on these 100 games. Changing the embedding model or catalogue can shift similarity scores and requires recalibration.

## Intentionally Left Out
- **Vector database:** Offline cosine similarity + precomputed O(1) lookup handles 100-10,000 games with no vector DB.
- **Metrics backend, CI/CD, and Terraform:** Out of scope per the brief (see [`docs/ADR.md`](./docs/ADR.md)).
- **Rate limiting, TLS, and key rotation:** Handled at the API Gateway / load balancer and deployment layer.
- **Secrets manager:** Local runs use `.env`. In team setups with coding agents, inject secrets per command via something like Infisical so no `.env` file sits on disk/terminal where an agent could read it.

**Production Metrics:**
- **Latency & availability:** p50/p95/p99 latency, HTTP 4xx/5xx rates.
- **Pipeline health:** Index age, LLM fallback/error rate, eval check pass/fail.
- **Recommender behaviour:** Decline rate, brand coverage, click-through rate vs baseline.

---

## Time Allocation
| Block | Approx. Time |
|---|---|
| Planning, schema & dataset preparation | ~1h |
| Offline enrichment & embedding pipeline | ~30m |
| Service, testing & AI evaluation | ~1h30m |
| ADR, skills, docs & formatting | ~1h |

### AI Models & Artifacts Used
- **Models:** Claude and Gemini for coding and review, plus `openai/gpt-6-luna` and `openai/text-embedding-3-small` via OpenRouter.
- **Retained artifacts:** [`AGENTS.md`](./AGENTS.md), [`.agents/skills/`](./.agents/skills/) (`secure-coding`, `dependency-scan`, `security-audit`, `prototype-to-production`), [`prompts/`](./prompts/), and [`docs/DECISIONS.md`](./docs/DECISIONS.md).

### One AI Output Rejected
The assistant first suggested `vitest`, `fastify`, `dotenv`, and the `openai` SDK. The dependency scan found **5 high-severity vulnerabilities** in `vitest`'s dependency tree (`tinyglobby` / `picomatch`) with no non-breaking fix. It was switched to Node 22+ built-ins (`node:test`, `node:http`, `process.loadEnvFile`, `fetch`) plus `zod` only, reaching **0 `npm audit` vulnerabilities**.
