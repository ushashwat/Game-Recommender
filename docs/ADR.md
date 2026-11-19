# ADR: Related-Games Recommender

## Context
Product wants to serve related-game recommendations on live, regulated, real-money casino sites across multiple brands. The service sits on a player-facing game page with a tight latency budget. R&D demonstrated two AI capabilities:
1. LLM metadata enrichment for thin or incomplete catalogue records.
2. Semantic similarity matching over embeddings.

The catalogue changes over time (new releases, brand availability changes, game retirements), but is bounded in size (hundreds to low thousands of games per brand).

## Decision
Decouple **offline AI index & nearest-neighbour precomputation** from **online O(1) request serving**:

```text
Offline Build (EventBridge / ECS Task - runs on catalogue change)
|
Upstream Catalogue (data/catalogue.raw.json)
|
├── LLM Enrich  -> thin/stub records only, strict JSON schema + zod, hash-cached
├── Embed       -> gameplay text only, hash-cached, precompute top-K neighbours
└── Eval Checks -> safety rules + baseline checks (abort publish on failure)
|
S3 (index.json) / Redis / DynamoDB  (compact neighbour table, zero vectors)
|
Online Serving (ECS Fargate - O(1) lookup by gameId, zero AI calls)
|
Player Browser <-> Casino Backend
|  (x-api-key header)
Load Balancer -> Recommender Service (<1 ms)
|
├── 200 OK  -> ranked gameIds, titles, and scores
├── 200 OK  -> empty list + NO_CONFIDENT_MATCHES (below threshold)
└── 404     -> GAME_NOT_FOUND / GAME_INACTIVE / GAME_NOT_ON_BRAND
```

1. **Offline pipeline (ECS scheduled/event task):** Triggered when the catalogue changes. Calls the LLM (`temperature 0`, strict JSON schema) only for thin/stub records whose `inputHash` changed, embeds gameplay metadata (cached by model + text hash), **precomputes each game's top-K nearest neighbours** (excluding self, duplicate `canonicalId`s, and `inactive` titles), runs the automated evaluation checks, and publishes the compact neighbour table (`index.json` or Redis/DynamoDB items keyed by `gameId`) only if all checks pass.
2. **Online service (stateless TypeScript tasks on ECS Fargate behind a load balancer / API Gateway):** Holds only the lightweight precomputed top-K neighbour IDs and scores per game (never the 1,536-float embedding vectors) and serves `GET /v1/recommendations` via an O(1) key lookup by `gameId` plus brand and threshold filtering (<0.1 ms compute). Locally `index.json` is read from disk. At high scale, the exact same `gameId -> neighbors` map lives in Redis or DynamoDB so worker RAM stays flat regardless of catalogue size.
3. **Secrets & identity:** In AWS, outbound LLM calls use IAM roles (Amazon Bedrock) or keys injected from AWS Secrets Manager into the offline task only. Inbound calls from the casino backend authenticate via API Gateway / `x-api-key` stored in Secrets Manager.

## Alternatives Considered

| Option | Why Rejected |
|---|---|
| **Live LLM or embedding calls on the request path** | Violates latency budget (hundreds of ms to seconds), couples player page availability and cost to third-party LLM uptime/rate limits, and risks unreviewed AI output reaching players. |
| **Managed vector database (OpenSearch Serverless / Aurora pgvector)** | Unnecessary operational cost and network hop for 100-10,000 games. Offline pairwise cosine similarity plus precomputed O(1) neighbour lookup has zero external runtime dependencies. |
| **AWS Lambda per request** | Cold starts and reloading the neighbour index into memory on uncached invocations add tail latency (p99). Two small Fargate tasks keep the index hot in memory at predictable cost. |

## Trade-offs and Consequences Accepted
- **Freshness lag:** New or edited catalogue games appear in recommendations only after the next offline index build (minutes), not instantaneously.
- **Bounded top-K precomputation:** Each game stores at most its top 12 nearest active neighbours with `score >= 0.45`. If a brand carries none of those above `minScore`, the service declines rather than scanning the rest of the catalogue.
- **Lower coverage from confidence threshold:** Enforcing `minScore` means isolated games (e.g. a sole bingo title) return an empty list rather than weak guesses.

## Failure Behaviour (What the Player Sees)
- **Recommender service down, timeout, or HTTP 4xx/5xx:** The calling casino backend applies a short timeout (~150 ms) and fails open by **hiding the recommendation section**. The player sees the normal game page with zero error banners or broken UI.
- **Below confidence threshold (`reason: "NO_CONFIDENT_MATCHES"`) or unknown/inactive game (`404`):** The casino backend hides the recommendation section.
- **LLM provider outage or schema/eval failure during offline build:** The pipeline aborts publishing. Running Fargate tasks continue serving the last known-good `indexVersion` from S3 with zero player impact.

## Scaling and Triggers
- **Traffic growth (higher request rate):** Scale stateless ECS Fargate tasks horizontally on CPU / p95 latency, and add short-lived response caching (30-60s) at CloudFront or the casino backend keyed by `(gameId, brand, limit)`.
- **Catalogue growth (>50,000 games):** Move the precomputed `gameId -> neighbors` lookup table from a local JSON artifact into ElastiCache (Redis) or DynamoDB so service container memory stays O(1), and use an offline approximate nearest-neighbour index during the batch build step when offline all-pairs similarity exceeds the batch window.

## Evidence to Revisit This Decision
- **Commercial / engagement:** Online A/B test shows click-through or game-launch rate does not beat a simpler non-AI baseline (e.g. top-played games in the same category on that brand).
- **Quality / compliance:** Evaluation checks regress on a catalogue update, or Responsible Gambling / compliance review flags unsuitable pairings across volatility tiers.
- **Operational:** Catalogue updates require sub-second live reflection (e.g. real-time jackpot state driving recommendations), or neighbour index size grows past single-process memory limits.
