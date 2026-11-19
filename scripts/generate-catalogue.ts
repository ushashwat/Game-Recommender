/** Generates the fictional base catalogue via LLM and writes clean truth and degraded raw JSON files. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { loadDotEnv, loadPipelineConfig } from "../src/config.js";
import { createLlmClient, type LlmClient } from "../src/llm.js";
import {
  Brand,
  BRANDS,
  CatalogueGame,
  Category,
  Mechanic,
  MECHANICS,
  Theme,
  THEMES,
  Volatility,
} from "../src/schema.js";
import { degradeCatalogue } from "../src/utils/degrade.js";
import { makeCanonicalId } from "../src/utils/hash.js";

const PROVIDERS = [
  "Sunforge Studios",
  "Northwind Gaming",
  "Velvet Reel",
  "Ironclad Interactive",
  "Starlight Works",
  "Cobalt Play",
  "Emerald Harbor",
  "Mythic Spin",
] as const;

const GeneratedBatch = z.object({
  games: z.array(
    z.object({
      title: z.string().min(2),
      provider: z.string().min(2),
      category: Category,
      description: z.string().min(30),
      themes: z.array(Theme).min(1).max(3),
      mechanics: z.array(Mechanic).min(1).max(4),
      volatility: Volatility,
      rtp: z.number().min(80).max(100),
      brands: z.array(Brand).min(1).max(3),
      releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  ),
});

const BATCHES = [
  {
    count: 22,
    focus:
      "Core slot clusters & franchise sequels (category='slot'): ancient-egypt, mythology, adventure, and pirates. Include 3 sequel pairs/trios (e.g. 'Tomb of Anubis', 'Tomb of Anubis 2', 'Tomb of Anubis Megaways') and make titles clearly reflect their primary theme and mechanic.",
  },
  {
    count: 22,
    focus:
      "Core slot clusters & franchise sequels (category='slot'): fruit-classic, gems, space, horror, irish-luck, animals, and underwater. Include 2 sequel pairs (e.g. 'Emerald Clover', 'Emerald Clover Hold and Win') and 2 ambiguous-title slots whose titles mention another game type ('Cleopatra Roulette Quest' and 'Dragon Crash Kingdom', both category='slot').",
  },
  {
    count: 22,
    focus:
      "Core slot clusters (category='slot'): western, asian, food-candy, music, vegas-luxury, and festive. Do NOT use 'sports' or 'bingo' here. Make titles clearly reflect the theme and core mechanic (e.g. cluster-pays, cascading-reels, hold-and-win, free-spins).",
  },
  {
    count: 22,
    focus:
      "Non-slot clusters + 2 isolated outliers: 8 'table' games (blackjack, roulette, baccarat variants with multi-hand or side-bets), 7 'live' games (live-dealer tables and game-show wheels), 5 'instant' games (crash and scratch cards, non-sports), plus EXACTLY 1 'bingo' game (sole bingo title in catalogue) and EXACTLY 1 'sports'-themed instant/slot outlier (sole sports title in catalogue).",
  },
] as const;

export async function generateTruthCatalogue(client: LlmClient): Promise<CatalogueGame[]> {
  const system = readFileSync("prompts/generate-catalogue.md", "utf8");
  const seen = new Set<string>();
  const truth: CatalogueGame[] = [];

  for (const [b, brief] of BATCHES.entries()) {
    const user = [
      `Generate ${brief.count} distinct fictional casino games. Focus: ${brief.focus}`,
      `Providers: ${PROVIDERS.join(", ")}`,
      `Themes: ${THEMES.join(", ")} | Mechanics: ${MECHANICS.join(", ")} | Brands: ${BRANDS.join(", ")}`,
      seen.size > 0 ? `Do not reuse titles: ${[...seen].join(", ")}` : "",
    ].join("\n");

    const batch = await client.completeStructured({
      system,
      user,
      schemaName: "generated_catalogue_batch",
      schema: GeneratedBatch,
      temperature: 0.3,
      seed: 100 + b,
    });

    for (const item of batch.games) {
      if (truth.length >= 88) break;
      const key = item.title.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);

      const id = `g_${String(truth.length + 1).padStart(4, "0")}`;
      truth.push(
        CatalogueGame.parse({
          ...item,
          id,
          canonicalId: makeCanonicalId(item.title, item.provider),
          title: item.title.trim(),
          provider: item.provider.trim(),
          description: item.description.trim(),
          rtp: Number(item.rtp.toFixed(2)),
          status: truth.length % 17 === 15 ? "inactive" : "active",
        }),
      );
    }
  }
  return truth;
}

async function main(): Promise<void> {
  loadDotEnv();
  const client = createLlmClient(loadPipelineConfig());
  console.log(`Generating catalogue with ${client.model}...`);
  const truth = await generateTruthCatalogue(client);
  const raw = degradeCatalogue(truth);

  mkdirSync("data", { recursive: true });
  writeFileSync("data/catalogue.truth.json", `${JSON.stringify(truth, null, 2)}\n`);
  writeFileSync("data/catalogue.raw.json", `${JSON.stringify(raw, null, 2)}\n`);
  console.log(`Wrote ${truth.length} truth and ${raw.length} raw records to data/.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
