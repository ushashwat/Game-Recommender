/** Offline software tests for O(1) recommender filtering, decline behaviour, HTTP endpoints, auth, and log redaction. */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { buildNeighborLists, GameIndex } from "../src/pipeline/build-index.js";
import { createRecommender } from "../src/recommender.js";
import { EnrichedGame } from "../src/schema.js";
import { createApp } from "../src/server.js";
import { makeCanonicalId } from "../src/utils/hash.js";

function makeGame(id: string, title: string, overrides: Partial<EnrichedGame> = {}): EnrichedGame {
  return EnrichedGame.parse({
    id,
    canonicalId: makeCanonicalId(title, "Sunforge Studios"),
    title,
    provider: "Sunforge Studios",
    category: "slot",
    description: "Sample game.",
    themes: ["ancient-egypt"],
    mechanics: ["free-spins"],
    volatility: "medium",
    rtp: 96.2,
    brands: ["northstar", "lucky-harbour"],
    status: "active",
    releaseDate: "2024-01-01",
    summary: "Sample summary.",
    provenance: {
      themes: "catalogue",
      mechanics: "catalogue",
      volatility: "catalogue",
      summary: "catalogue",
    },
    enrichment: null,
    ...overrides,
  });
}

const games: EnrichedGame[] = [
  makeGame("g_0001", "Pharaoh's Gold"),
  makeGame("g_0002", "Pharaoh's Gold Deluxe"),
  makeGame("g_0003", "Nile Treasures"),
  makeGame("g_0004", "Scarabs of Ra"),
  makeGame("g_0005", "Scarabs of Ra Remastered"),
  makeGame("g_0006", "Inactive Pyramid", { status: "inactive" }),
  makeGame("g_0007", "Redcrest Exclusive", { brands: ["redcrest"] }),
  makeGame("g_0008", "Lonely Bingo", { category: "bingo" }),
];

const vectors = [
  [1, 0, 0],
  [1, 0, 0],
  [0.9, 0.4359, 0],
  [0.8, 0.6, 0],
  [0.75, 0.66, 0],
  [0.99, 0.1, 0],
  [0.95, 0.3, 0],
  [0, 0, 1],
];

const neighborLists = buildNeighborLists(games, vectors);

const fixtureIndex: GameIndex = GameIndex.parse({
  indexVersion: "idx_fixture",
  embeddingModel: "openai/text-embedding-3-small",
  enrichmentModel: "openai/gpt-6-luna",
  entries: games.map((game, i) => ({ game, neighbors: neighborLists[i]! })),
});

describe("createRecommender (O(1) precomputed neighbor lookup)", () => {
  const recommender = createRecommender(fixtureIndex, 0.55);

  it("returns precomputed neighbors filtered by brand while excluding self, duplicates, and inactive", () => {
    const res = recommender.recommend("g_0001", "northstar", 5);
    assert.ok(res);
    assert.deepEqual(
      res.recommendations.map((r) => r.gameId),
      ["g_0003", "g_0004"],
    );
    assert.equal(res.reason, undefined);
  });

  it("declines with NO_CONFIDENT_MATCHES when no neighbor meets the similarity threshold", () => {
    const res = recommender.recommend("g_0008", "northstar", 5);
    assert.ok(res);
    assert.deepEqual(res.recommendations, []);
    assert.equal(res.reason, "NO_CONFIDENT_MATCHES");
  });

  it("returns null when seed game is unknown, inactive, or not on the requested brand", () => {
    assert.equal(recommender.recommend("g_9999", "northstar"), null);
    assert.equal(recommender.recommend("g_0006", "northstar"), null);
    assert.equal(recommender.recommend("g_0001", "redcrest"), null);
  });
});

describe("HTTP server", () => {
  const apiKey = "k".repeat(64);
  const logs: Array<Record<string, unknown>> = [];
  const recommender = createRecommender(fixtureIndex, 0.55);
  const server = createApp({
    recommender,
    apiKey,
    logger: (entry) => logs.push(entry),
  });
  let baseUrl = "";

  before(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /health succeeds without auth and exposes index metadata", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.status, "ok");
    assert.equal(body.indexVersion, "idx_fixture");
    assert.equal(body.catalogueSize, 8);
  });

  it("returns 401 when x-api-key is missing or invalid, and never logs the secret", async () => {
    const missing = await fetch(`${baseUrl}/v1/recommendations?gameId=g_0001&brand=northstar`);
    assert.equal(missing.status, 401);

    const wrongSecret = "wrong-secret-key-that-must-not-be-logged";
    const wrong = await fetch(`${baseUrl}/v1/recommendations?gameId=g_0001&brand=northstar`, {
      headers: { "x-api-key": wrongSecret, authorization: `Bearer ${wrongSecret}` },
    });
    assert.equal(wrong.status, 401);

    const serializedLogs = JSON.stringify(logs);
    assert.ok(!serializedLogs.includes(wrongSecret));
    assert.ok(!serializedLogs.includes(apiKey));
    assert.ok(serializedLogs.includes("[REDACTED]"));
  });

  it("returns 400 on invalid query parameters and 404/200 appropriately", async () => {
    const badLimit = await fetch(
      `${baseUrl}/v1/recommendations?gameId=g_0001&brand=northstar&limit=99`,
      { headers: { "x-api-key": apiKey } },
    );
    assert.equal(badLimit.status, 400);

    const notFound = await fetch(`${baseUrl}/v1/recommendations?gameId=g_0001&brand=redcrest`, {
      headers: { "x-api-key": apiKey },
    });
    assert.equal(notFound.status, 404);
    const notFoundBody = (await notFound.json()) as { error: string; availableBrands: string[] };
    assert.equal(notFoundBody.error, "GAME_NOT_ON_BRAND");
    assert.deepEqual(notFoundBody.availableBrands, ["northstar", "lucky-harbour"]);

    const inactiveRes = await fetch(`${baseUrl}/v1/recommendations?gameId=g_0006&brand=northstar`, {
      headers: { "x-api-key": apiKey },
    });
    assert.equal(inactiveRes.status, 404);
    assert.equal(((await inactiveRes.json()) as { error: string }).error, "GAME_INACTIVE");

    const ok = await fetch(`${baseUrl}/v1/recommendations?gameId=g_0001&brand=northstar&limit=2`, {
      headers: { "x-api-key": apiKey },
    });
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as {
      recommendations: Array<{ gameId: string; title: string; score: number }>;
    };
    assert.equal(body.recommendations.length, 2);
    assert.equal(body.recommendations[0]!.gameId, "g_0003");
    assert.deepEqual(Object.keys(body.recommendations[0]!).sort(), ["gameId", "score", "title"]);
  });
});
