/** Offline software tests for config isolation, schemas, degradation, mocked LLM client, caching, and eval checks. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateEnrichment } from "../eval/enrichment.eval.js";
import { buildReferenceJudgements, evaluateMatching, toRawBaselineIndex } from "../eval/matching.eval.js";
import { formatEvalMarkdown } from "../eval/run-eval.js";
import { ConfigError, loadPipelineConfig, loadServiceConfig } from "../src/config.js";
import { createLlmClient, type LlmClient } from "../src/llm.js";
import { buildNeighborLists, GameIndex } from "../src/pipeline/build-index.js";
import { cosineSimilarity, embedGames, toEmbeddingText } from "../src/pipeline/embed.js";
import { enrichCatalogue } from "../src/pipeline/enrich.js";
import { CatalogueGame, EnrichedGame, EnrichmentOutput } from "../src/schema.js";
import { degradeCatalogue } from "../src/utils/degrade.js";
import { makeCanonicalId } from "../src/utils/hash.js";

const validServiceKey = "a".repeat(64);

const sampleTruth: CatalogueGame[] = Array.from({ length: 20 }, (_, i) =>
  CatalogueGame.parse({
    id: `g_${String(i + 1).padStart(4, "0")}`,
    canonicalId: makeCanonicalId(`Desert Relic ${i + 1}`, "Sunforge Studios"),
    title: `Desert Relic ${i + 1}`,
    provider: "Sunforge Studios",
    category: i === 19 ? "bingo" : "slot",
    description:
      "Explore sun-scorched temples across five reels and twenty paylines. Trigger free spins with expanding wild symbols.",
    themes: i === 19 ? ["classic-casino"] : ["ancient-egypt", "adventure"],
    mechanics: i === 19 ? ["pick-bonus"] : ["paylines", "free-spins", "expanding-wilds"],
    volatility: i % 3 === 0 ? "high" : i % 3 === 1 ? "medium" : "low",
    rtp: 96.25,
    brands: ["northstar", "lucky-harbour"],
    status: "active",
    releaseDate: "2023-06-15",
  }),
);

describe("config & schema guardrails", () => {
  it("isolates service vs pipeline secrets and never echoes weak keys", () => {
    assert.deepEqual(loadServiceConfig({ SERVICE_API_KEY: validServiceKey, LLM_API_KEY: "sk-x" }), {
      SERVICE_API_KEY: validServiceKey,
      HOST: "127.0.0.1",
      PORT: 3000,
    });
    assert.throws(() => loadServiceConfig({}), ConfigError);

    const weak = "short-secret-value";
    try {
      loadServiceConfig({ SERVICE_API_KEY: weak });
      assert.fail("Expected ConfigError");
    } catch (err) {
      assert.ok(err instanceof ConfigError && !err.message.includes(weak));
    }

    const pCfg = loadPipelineConfig({ LLM_API_KEY: "sk-test", SERVICE_API_KEY: validServiceKey });
    assert.ok(!("SERVICE_API_KEY" in pCfg));
  });

  it("strips factual fields from EnrichmentOutput and rejects off-vocabulary tags", () => {
    const parsed = EnrichmentOutput.parse({
      themes: ["ancient-egypt"],
      mechanics: ["free-spins"],
      volatility: null,
      summary: "An Egyptian-themed slot built around a free spins feature.",
      rtp: 99.9,
      provider: "Invented Studios",
    });
    assert.ok(!("rtp" in parsed) && !("provider" in parsed));
    assert.throws(() =>
      EnrichmentOutput.parse({ ...parsed, themes: ["not-a-valid-theme"] }),
    );
  });
});

describe("smart degradation, LLM client & enrichment pipeline", () => {
  it("degrades deterministically across complete, thin, and stub profiles and appends duplicates", () => {
    const first = degradeCatalogue(sampleTruth, 42);
    assert.deepEqual(first, degradeCatalogue(sampleTruth, 42));
    assert.ok(first.length > sampleTruth.length);
    assert.equal(first[sampleTruth.length]!.canonicalId, sampleTruth[0]!.canonicalId);
    assert.ok(first.some((g) => g.themes.length === 0 && g.rtp === null));
    assert.ok(first.some((g) => g.status === "inactive"));
  });

  it("validates structured JSON responses via createLlmClient and orders embeddings", async () => {
    const cfg = {
      LLM_API_KEY: "sk-mock",
      LLM_BASE_URL: "https://openrouter.ai/api/v1",
      LLM_MODEL: "openai/gpt-6-luna",
      EMBEDDING_MODEL: "openai/text-embedding-3-small",
    };

    const client = createLlmClient(cfg, async (url) => {
      if (String(url).endsWith("/embeddings")) {
        return new Response(
          JSON.stringify({
            data: [
              { index: 1, embedding: [0, 1] },
              { index: 0, embedding: [1, 0] },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  themes: ["ancient-egypt"],
                  mechanics: ["free-spins"],
                  volatility: "high",
                  summary: "An Egyptian slot featuring free spins and expanding symbols.",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const out = await client.completeStructured({
      system: "sys",
      user: "usr",
      schemaName: "enrichment",
      schema: EnrichmentOutput,
    });
    assert.deepEqual(out.themes, ["ancient-egypt"]);
    assert.deepEqual(await client.embed(["a", "b"]), [
      [1, 0],
      [0, 1],
    ]);
  });

  it("enriches thin records, caches by hash, falls back on failure, and excludes RTP from embedding text", async () => {
    const thin = CatalogueGame.parse({
      ...sampleTruth[0]!,
      description: null,
      themes: [],
      mechanics: [],
      volatility: null,
      rtp: null,
    });

    let calls = 0;
    const mockClient: LlmClient = {
      model: "openai/gpt-6-luna",
      embeddingModel: "openai/text-embedding-3-small",
      async completeStructured() {
        calls++;
        return {
          themes: ["ancient-egypt"],
          mechanics: ["free-spins"],
          volatility: "high",
          summary: "An ancient Egyptian slot featuring free spins and temple symbols.",
        } as never;
      },
      async embed() {
        return [];
      },
    };

    const [enriched] = await enrichCatalogue([thin], mockClient);
    assert.equal(calls, 1);
    assert.equal(enriched!.provenance.themes, "llm");
    assert.equal(enriched!.rtp, null);

    // Cache hit skips LLM call
    await enrichCatalogue([thin], mockClient, [enriched!]);
    assert.equal(calls, 1);

    // Fallback on LLM error
    const [fallback] = await enrichCatalogue([thin], {
      ...mockClient,
      async completeStructured() {
        throw new Error("LLM down");
      },
    });
    assert.equal(fallback!.enrichment, null);

    const text = toEmbeddingText(sampleTruth[0]!);
    assert.ok(!text.includes("96.25") && !text.includes("Sunforge"));
    assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  });
});

describe("AI evaluation suite", () => {
  it("enforces enrichment and precomputed matching evaluation checks", () => {
    const truth = sampleTruth.slice(0, 4);
    const raw = truth.map((g, i) =>
      i === 0 ? { ...g, themes: [], mechanics: [], volatility: null, rtp: null } : g,
    );
    const enriched: EnrichedGame[] = truth.map((g, i) =>
      EnrichedGame.parse({
        ...g,
        rtp: i === 0 ? null : g.rtp,
        summary: g.description,
        provenance: {
          themes: i === 0 ? "llm" : "catalogue",
          mechanics: i === 0 ? "llm" : "catalogue",
          volatility: i === 0 ? "llm" : "catalogue",
          summary: i === 0 ? "llm" : "catalogue",
        },
        enrichment: i === 0 ? { model: "openai/gpt-6-luna", promptHash: "p1", inputHash: "i1" } : null,
      }),
    );

    const variedTruth = truth.map((g, i) =>
      i === 0 ? g : { ...g, themes: ["pirates" as const], mechanics: ["cluster-pays" as const] },
    );
    const eReport = evaluateEnrichment(variedTruth, raw, enriched);
    assert.equal(eReport.gatesPassed, true);

    const vecs = [
      [1, 0, 0],
      [0.95, 0.3, 0],
      [0.9, 0.4, 0],
      [0, 0, 1],
    ];
    const rawVecs = [
      [0, 1, 0],
      [0.95, 0.3, 0],
      [0.9, 0.4, 0],
      [0, 0, 1],
    ];
    const eNeighbors = buildNeighborLists(enriched, vecs);
    const rNeighbors = buildNeighborLists(enriched, rawVecs);

    const eIndex = GameIndex.parse({
      indexVersion: "idx_e",
      embeddingModel: "openai/text-embedding-3-small",
      enrichmentModel: "openai/gpt-6-luna",
      entries: enriched.map((game, i) => ({ game, neighbors: eNeighbors[i]!, rawNeighbors: rNeighbors[i]! })),
    });
    const rIndex = toRawBaselineIndex(eIndex);

    const judgements = buildReferenceJudgements(truth, eIndex);
    const mReport = evaluateMatching(eIndex, rIndex, judgements, 0.55);
    assert.equal(mReport.thresholdCalibration.length, 7);
    assert.equal(mReport.gatesPassed, true);
    assert.ok(formatEvalMarkdown(eReport, mReport).includes("Overall evaluation checks: **PASSED**"));
  });
});

describe("embedding cache", () => {
  it("embeds each unique text once and only sends unseen texts on later runs", async () => {
    const sent: string[] = [];
    const client: LlmClient = {
      model: "m",
      embeddingModel: "e1",
      async completeStructured() {
        throw new Error("unused");
      },
      async embed(texts) {
        sent.push(...texts);
        return texts.map((t) => [t.length, 1]);
      },
    };
    const cache = new Map<string, number[]>();
    const games = sampleTruth.slice(0, 3);

    const first = await embedGames([...games, games[0]!], client, cache);
    assert.equal(sent.length, 3, "duplicate text is embedded once");
    assert.deepEqual(first[0], first[3]);

    await embedGames(games, client, cache);
    assert.equal(sent.length, 3, "fully cached run makes no calls");

    await embedGames([...games, sampleTruth[3]!], client, cache);
    assert.equal(sent.length, 4, "only the new record is embedded");

    await embedGames(games, { ...client, embeddingModel: "e2" }, cache);
    assert.equal(sent.length, 7, "changing the embedding model invalidates the cache");
  });
});