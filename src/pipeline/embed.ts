/** Gameplay-only embedding text builder, hash-cached batch embedder, and cosine similarity helper. */
import type { LlmClient } from "../llm.js";
import type { CatalogueGame, EnrichedGame } from "../schema.js";
import { sha256 } from "../utils/hash.js";

export function toEmbeddingText(g: EnrichedGame | CatalogueGame): string {
  const summary = "summary" in g ? (g.summary ?? g.description) : g.description;
  const themes = g.themes.join(", ") || "none";
  const mechanics = g.mechanics.join(", ") || "none";
  return [
    `Category: ${g.category} (${g.category})`,
    `Themes: ${themes} | Primary theme: ${g.themes[0] ?? "none"}`,
    `Mechanics: ${mechanics}`,
    `Volatility: ${g.volatility ?? "unknown"}`,
    `Game: ${g.title} - ${summary ?? "no description"}`,
  ].join("\n");
}

const BATCH_SIZE = 50;

export type EmbeddingCache = Map<string, number[]>;

const embeddingCacheKey = (model: string, text: string): string => sha256(`${model}\n${text}`);

export async function embedGames(
  games: Array<EnrichedGame | CatalogueGame>,
  client: LlmClient,
  cache: EmbeddingCache = new Map(),
): Promise<number[][]> {
  const texts = games.map(toEmbeddingText);
  const keys = texts.map((t) => embeddingCacheKey(client.embeddingModel, t));
  const missing = new Map<string, string>();
  keys.forEach((k, i) => {
    if (!cache.has(k)) missing.set(k, texts[i]!);
  });
  const missingKeys = [...missing.keys()];
  for (let i = 0; i < missingKeys.length; i += BATCH_SIZE) {
    const batchKeys = missingKeys.slice(i, i + BATCH_SIZE);
    const vectors = await client.embed(batchKeys.map((k) => missing.get(k)!));
    batchKeys.forEach((k, j) => cache.set(k, vectors[j]!));
  }
  return keys.map((k) => cache.get(k)!);
}
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
