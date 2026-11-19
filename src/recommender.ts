/** O(1) related-games lookup over the precomputed neighbour index with brand, status, and score filtering. */
import type { GameIndex, IndexEntry } from "./pipeline/build-index.js";
import type { Brand } from "./schema.js";

export const DEFAULT_MIN_SCORE = 0.55;

export interface RecommendationItem {
  gameId: string;
  title: string;
  score: number;
}

export interface RecommendationResult {
  gameId: string;
  brand: Brand;
  indexVersion: string;
  recommendations: RecommendationItem[];
  reason?: "NO_CONFIDENT_MATCHES";
}

export type LookupOutcome =
  | { ok: true; result: RecommendationResult }
  | { ok: false; error: "GAME_NOT_FOUND" | "GAME_INACTIVE" | "GAME_NOT_ON_BRAND"; gameId: string; title?: string; brand?: Brand; availableBrands?: Brand[] };

export interface Recommender {
  readonly indexVersion: string;
  readonly catalogueSize: number;
  lookup(gameId: string, brand?: Brand, limit?: number): LookupOutcome;
  recommend(gameId: string, brand?: Brand, limit?: number): RecommendationResult | null;
}

export function createRecommender(index: GameIndex, minScore = DEFAULT_MIN_SCORE): Recommender {
  const byId = new Map<string, IndexEntry>(index.entries.map((e) => [e.game.id, e]));

  function lookup(gameId: string, brand?: Brand, limit = 5): LookupOutcome {
    const seed = byId.get(gameId);
    if (!seed) return { ok: false, error: "GAME_NOT_FOUND", gameId };
    if (seed.game.status !== "active") {
      return { ok: false, error: "GAME_INACTIVE", gameId, title: seed.game.title };
    }
    const effectiveBrand = brand ?? seed.game.brands[0];
    if (!effectiveBrand || !seed.game.brands.includes(effectiveBrand)) {
      return {
        ok: false,
        error: "GAME_NOT_ON_BRAND",
        gameId,
        title: seed.game.title,
        brand: effectiveBrand ?? "northstar",
        availableBrands: seed.game.brands,
      };
    }

    const recommendations: RecommendationItem[] = [];
    for (const neighbor of seed.neighbors) {
      if (neighbor.score < minScore) break;
      const cand = byId.get(neighbor.gameId);
      if (
        !cand ||
        cand.game.status !== "active" ||
        cand.game.canonicalId === seed.game.canonicalId ||
        !cand.game.brands.includes(effectiveBrand)
      ) {
        continue;
      }
      recommendations.push({
        gameId: cand.game.id,
        title: cand.game.title,
        score: neighbor.score,
      });
      if (recommendations.length >= limit) break;
    }

    return {
      ok: true,
      result: {
        gameId,
        brand: effectiveBrand,
        indexVersion: index.indexVersion,
        recommendations,
        ...(recommendations.length === 0 ? { reason: "NO_CONFIDENT_MATCHES" as const } : {}),
      },
    };
  }

  return {
    indexVersion: index.indexVersion,
    catalogueSize: index.entries.length,
    lookup,
    recommend(gameId: string, brand?: Brand, limit = 5): RecommendationResult | null {
      const res = lookup(gameId, brand, limit);
      return res.ok ? res.result : null;
    },
  };
}
