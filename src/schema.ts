/** Zod schemas and controlled vocabularies for catalogue records, LLM enrichment output, and provenance. */
import { z } from "zod";

export const CATEGORIES = ["slot", "table", "live", "instant", "bingo"] as const;
export const VOLATILITIES = ["low", "medium", "high"] as const;
export const BRANDS = ["northstar", "lucky-harbour", "redcrest"] as const;

export const THEMES = [
  "ancient-egypt",
  "mythology",
  "adventure",
  "fantasy",
  "fruit-classic",
  "animals",
  "horror",
  "space",
  "asian",
  "irish-luck",
  "pirates",
  "gems",
  "underwater",
  "western",
  "food-candy",
  "music",
  "sports",
  "vegas-luxury",
  "festive",
  "game-show",
  "classic-casino",
] as const;

export const MECHANICS = [
  "paylines",
  "ways-to-win",
  "megaways",
  "cluster-pays",
  "cascading-reels",
  "free-spins",
  "multipliers",
  "expanding-wilds",
  "sticky-wilds",
  "hold-and-win",
  "pick-bonus",
  "progressive-jackpot",
  "live-dealer",
  "side-bets",
  "multi-hand",
  "crash",
  "scratch",
] as const;

export const Category = z.enum(CATEGORIES);
export type Category = z.infer<typeof Category>;
export const Volatility = z.enum(VOLATILITIES);
export type Volatility = z.infer<typeof Volatility>;
export const Brand = z.enum(BRANDS);
export type Brand = z.infer<typeof Brand>;
export const Theme = z.enum(THEMES);
export type Theme = z.infer<typeof Theme>;
export const Mechanic = z.enum(MECHANICS);
export type Mechanic = z.infer<typeof Mechanic>;

const GameId = z.string().regex(/^g_\d{4}$/, "expected id like g_0001");

export const CatalogueGame = z.object({
  id: GameId,
  canonicalId: z.string().min(1),
  title: z.string().min(1),
  provider: z.string().min(1).nullable(),
  category: Category,
  description: z.string().nullable(),
  themes: z.array(Theme),
  mechanics: z.array(Mechanic),
  volatility: Volatility.nullable(),
  rtp: z.number().min(80).max(100).nullable(),
  brands: z.array(Brand),
  status: z.enum(["active", "inactive"]),
  releaseDate: z.iso.date().nullable(),
});
export type CatalogueGame = z.infer<typeof CatalogueGame>;

export const EnrichmentOutput = z.object({
  themes: z.array(Theme).min(1).max(4),
  mechanics: z.array(Mechanic).min(1).max(5),
  volatility: Volatility.nullable(),
  summary: z.string().min(20).max(400),
});
export type EnrichmentOutput = z.infer<typeof EnrichmentOutput>;

export const Provenance = z.enum(["catalogue", "llm", "missing"]);

export const EnrichedGame = CatalogueGame.extend({
  summary: z.string().nullable(),
  provenance: z.object({
    themes: Provenance,
    mechanics: Provenance,
    volatility: Provenance,
    summary: Provenance,
  }),
  enrichment: z
    .object({
      model: z.string(),
      promptHash: z.string(),
      inputHash: z.string(),
    })
    .nullable(),
});
export type EnrichedGame = z.infer<typeof EnrichedGame>;
