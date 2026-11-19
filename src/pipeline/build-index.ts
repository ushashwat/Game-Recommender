/** Offline index builder (`npm run build:index`) that enriches, embeds with cache, and precomputes top-K neighbours. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { loadDotEnv, loadPipelineConfig } from "../config.js";
import { createLlmClient } from "../llm.js";
import { CatalogueGame, EnrichedGame } from "../schema.js";
import { sha256 } from "../utils/hash.js";
import { cosineSimilarity, embedGames, type EmbeddingCache } from "./embed.js";
import { enrichCatalogue } from "./enrich.js";

const MAX_PRECOMPUTED_NEIGHBORS = 12;
const MIN_STORED_SCORE = 0.45;
const EMBEDDING_CACHE_PATH = "data/embedding-cache.json";

export const NeighborScore = z.object({
  gameId: z.string(),
  score: z.number(),
});
export type NeighborScore = z.infer<typeof NeighborScore>;

export const IndexEntry = z.object({
  game: EnrichedGame,
  neighbors: z.array(NeighborScore),
  rawNeighbors: z.array(NeighborScore).optional(),
});
export type IndexEntry = z.infer<typeof IndexEntry>;

export const GameIndex = z.object({
  indexVersion: z.string(),
  embeddingModel: z.string(),
  enrichmentModel: z.string().nullable(),
  entries: z.array(IndexEntry),
});
export type GameIndex = z.infer<typeof GameIndex>;

export function buildNeighborLists(
  games: Array<{ id: string; canonicalId: string; status: string; category?: string }>,
  vectors: number[][],
  maxNeighbors = MAX_PRECOMPUTED_NEIGHBORS,
): NeighborScore[][] {
  return games.map((seed, i) => {
    const seedVec = vectors[i]!;
    const scored: Array<NeighborScore & { canonicalId: string }> = [];
    for (let j = 0; j < games.length; j++) {
      if (i === j) continue;
      const cand = games[j]!;
      if (cand.canonicalId === seed.canonicalId || cand.status !== "active") continue;
      const rawSim = cosineSimilarity(seedVec, vectors[j]!);
      const penalty =
        seed.category && cand.category && seed.category !== cand.category ? 0.12 : 0;
      const score = Number(Math.max(0, rawSim - penalty).toFixed(4));
      if (score >= MIN_STORED_SCORE) {
        scored.push({ gameId: cand.id, score, canonicalId: cand.canonicalId });
      }
    }
    scored.sort((a, b) => b.score - a.score || a.gameId.localeCompare(b.gameId));

    const seenCanonical = new Set<string>();
    const deduped: NeighborScore[] = [];
    for (const { gameId, score, canonicalId } of scored) {
      if (seenCanonical.has(canonicalId)) continue;
      seenCanonical.add(canonicalId);
      deduped.push({ gameId, score });
      if (deduped.length >= maxNeighbors) break;
    }
    return deduped;
  });
}

async function main(): Promise<void> {
  loadDotEnv();
  const cfg = loadPipelineConfig();
  const client = createLlmClient(cfg);

  const rawText = readFileSync("data/catalogue.raw.json", "utf8");
  const rawGames = z.array(CatalogueGame).parse(JSON.parse(rawText));

  const previous = existsSync("data/index.json")
    ? GameIndex.parse(JSON.parse(readFileSync("data/index.json", "utf8"))).entries.map((e) => e.game)
    : [];

  console.log(`Enriching ${rawGames.length} records with ${client.model}...`);
  const enriched = await enrichCatalogue(rawGames, client, previous);

  console.log(`Embedding and precomputing top-${MAX_PRECOMPUTED_NEIGHBORS} neighbors with ${client.embeddingModel}...`);
  const cache: EmbeddingCache = existsSync(EMBEDDING_CACHE_PATH)
    ? new Map(Object.entries(JSON.parse(readFileSync(EMBEDDING_CACHE_PATH, "utf8")) as Record<string, number[]>))
    : new Map();
  const cachedBefore = cache.size;
  const enrichedVectors = await embedGames(enriched, client, cache);
  const rawVectors = await embedGames(rawGames, client, cache);
  console.log(`Embeddings: ${cache.size - cachedBefore} new, ${cachedBefore} cached before this run.`);
  mkdirSync("data", { recursive: true });
  writeFileSync(EMBEDDING_CACHE_PATH, JSON.stringify(Object.fromEntries(cache)));

  const enrichedNeighbors = buildNeighborLists(enriched, enrichedVectors);
  const rawNeighbors = buildNeighborLists(rawGames, rawVectors);

  const catalogueHash = sha256(rawText);
  const index: GameIndex = GameIndex.parse({
    indexVersion: `idx_${sha256(`${catalogueHash}:${client.model}:${client.embeddingModel}`)}`,
    embeddingModel: client.embeddingModel,
    enrichmentModel: client.model,
    entries: enriched.map((game, i) => ({
      game,
      neighbors: enrichedNeighbors[i]!,
      rawNeighbors: rawNeighbors[i]!,
    })),
  });

  writeFileSync("data/index.json", `${JSON.stringify(index, null, 2)}\n`);
  console.log(`Built ${index.indexVersion} (${index.entries.length} games) -> data/index.json.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
