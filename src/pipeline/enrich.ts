/** Selective, hash-cached LLM enrichment stage for thin/stub catalogue records with source-data fallback. */
import { readFileSync } from "node:fs";
import type { LlmClient } from "../llm.js";
import {
  type CatalogueGame,
  EnrichedGame,
  EnrichmentOutput,
  MECHANICS,
  THEMES,
} from "../schema.js";
import { sha256 } from "../utils/hash.js";

const MIN_RICH_DESCRIPTION = 80;

function needsEnrichment(g: CatalogueGame): boolean {
  return (
    !g.description ||
    g.description.length < MIN_RICH_DESCRIPTION ||
    g.themes.length === 0 ||
    g.mechanics.length === 0 ||
    g.volatility === null
  );
}

function computeInputHash(g: CatalogueGame): string {
  return sha256(
    JSON.stringify({
      title: g.title,
      category: g.category,
      description: g.description,
      themes: g.themes,
      mechanics: g.mechanics,
      volatility: g.volatility,
    }),
  );
}

export function fallbackEnriched(g: CatalogueGame): EnrichedGame {
  return EnrichedGame.parse({
    ...g,
    summary: g.description,
    provenance: {
      themes: g.themes.length > 0 ? "catalogue" : "missing",
      mechanics: g.mechanics.length > 0 ? "catalogue" : "missing",
      volatility: g.volatility !== null ? "catalogue" : "missing",
      summary: g.description ? "catalogue" : "missing",
    },
    enrichment: null,
  });
}

export async function enrichCatalogue(
  games: CatalogueGame[],
  client: LlmClient,
  previous: EnrichedGame[] = [],
  promptPath = "prompts/enrich-game.md",
): Promise<EnrichedGame[]> {
  const system = readFileSync(promptPath, "utf8");
  const promptHash = sha256(system);

  const cache = new Map<string, EnrichedGame>();
  for (const prev of previous) {
    if (
      prev.enrichment &&
      prev.enrichment.model === client.model &&
      prev.enrichment.promptHash === promptHash
    ) {
      cache.set(`${prev.id}:${prev.enrichment.inputHash}`, prev);
    }
  }

  const enrichOne = async (g: CatalogueGame): Promise<EnrichedGame> => {
    if (!needsEnrichment(g)) {
      return fallbackEnriched(g);
    }

    const inputHash = computeInputHash(g);
    const cached = cache.get(`${g.id}:${inputHash}`);
    if (cached) {
      return EnrichedGame.parse({
        ...cached,
        canonicalId: g.canonicalId,
        provider: g.provider,
        rtp: g.rtp,
        brands: g.brands,
        status: g.status,
        releaseDate: g.releaseDate,
      });
    }

    const user = JSON.stringify({
      title: g.title,
      category: g.category,
      description: g.description,
      existingThemes: g.themes,
      existingMechanics: g.mechanics,
      existingVolatility: g.volatility,
      allowedThemes: THEMES,
      allowedMechanics: MECHANICS,
    });

    try {
      const llmOut = await client.completeStructured({
        system,
        user,
        schemaName: "enrichment_output",
        schema: EnrichmentOutput,
        temperature: 0,
      });

      const mergedThemes = g.themes.length > 0 ? g.themes : llmOut.themes;
      const mergedMechanics = g.mechanics.length > 0 ? g.mechanics : llmOut.mechanics;
      const mergedVolatility = g.volatility ?? llmOut.volatility;

      return EnrichedGame.parse({
        ...g,
        themes: mergedThemes,
        mechanics: mergedMechanics,
        volatility: mergedVolatility,
        summary: llmOut.summary,
        provenance: {
          themes: g.themes.length > 0 ? "catalogue" : "llm",
          mechanics: g.mechanics.length > 0 ? "catalogue" : "llm",
          volatility: g.volatility !== null ? "catalogue" : mergedVolatility ? "llm" : "missing",
          summary: "llm",
        },
        enrichment: {
          model: client.model,
          promptHash,
          inputHash,
        },
      });
    } catch {
      return fallbackEnriched(g);
    }
  };

  const CONCURRENCY = 8;
  const results: EnrichedGame[] = [];
  for (let i = 0; i < games.length; i += CONCURRENCY) {
    const batch = await Promise.all(games.slice(i, i + CONCURRENCY).map(enrichOne));
    results.push(...batch);
  }
  return results;
}
