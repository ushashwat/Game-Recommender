/** Deterministically degrades the clean catalogue into uneven raw records plus duplicate editions. */
import { BRANDS, CatalogueGame } from "../schema.js";
import { createPrng, makeCanonicalId } from "./hash.js";

const VARIANT_SUFFIXES = ["Deluxe", "Remastered", "HD", "Edition"] as const;
const DUPLICATE_SEED_INDICES = [0, 3, 7, 11, 15, 19, 23, 28, 34, 41, 48, 55] as const;

export function degradeCatalogue(truth: CatalogueGame[], seed = 42): CatalogueGame[] {
  const rand = createPrng(seed);

  const raw: CatalogueGame[] = truth.map((g, idx) => {
    const bucket = idx % 20;
    const status = idx % 17 === 16 ? "inactive" : g.status;
    const baseDesc = g.description ?? g.title;
    const firstSentence = baseDesc.match(/^[^.!?]+[.!?]/)?.[0] ?? baseDesc.slice(0, 65);

    if (bucket < 10) {
      return CatalogueGame.parse({ ...g, status });
    }

    if (bucket < 16) {
      return CatalogueGame.parse({
        ...g,
        status,
        provider: rand() < 0.15 ? null : g.provider,
        description: firstSentence,
        themes: bucket % 2 === 0 ? [] : g.themes,
        mechanics: bucket % 2 === 1 ? [] : g.mechanics,
        volatility: bucket % 3 === 0 ? null : g.volatility,
        rtp: rand() < 0.25 ? null : g.rtp,
      });
    }

    const stubHint =
      bucket === 16
        ? null
        : `${g.category} game featuring ${g.themes.join(" and ").replace(/-/g, " ")} with ${g.mechanics.join(", ").replace(/-/g, " ")}.`;

    return CatalogueGame.parse({
      ...g,
      status,
      description: stubHint ? stubHint.slice(0, 78) : null,
      themes: [],
      mechanics: [],
      volatility: null,
      rtp: null,
      releaseDate: null,
    });
  });

  for (const [i, seedIdx] of DUPLICATE_SEED_INDICES.entries()) {
    const base = truth[seedIdx];
    if (!base) continue;
    const title = `${base.title} ${VARIANT_SUFFIXES[i % VARIANT_SUFFIXES.length]!}`;
    raw.push(
      CatalogueGame.parse({
        ...base,
        id: `g_${String(truth.length + i + 1).padStart(4, "0")}`,
        canonicalId: makeCanonicalId(title, base.provider),
        title,
        brands: [...BRANDS],
        status: "active",
      }),
    );
  }

  return raw;
}
