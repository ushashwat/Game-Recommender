/** Stage 2 AI evaluation: compares enriched vs raw matching on hard rules, Precision@5, Recall@5, and thresholds. */
import { z } from "zod";
import { GameIndex } from "../src/pipeline/build-index.js";
import { createRecommender, DEFAULT_MIN_SCORE, type RecommendationItem } from "../src/recommender.js";
import { Brand, BRANDS, type CatalogueGame } from "../src/schema.js";

export const MatchingJudgement = z.object({
  seedId: z.string(),
  brand: Brand,
  relevant: z.array(z.string()),
  mustNot: z.array(z.string()),
  expectDecline: z.boolean().default(false),
});
export type MatchingJudgement = z.infer<typeof MatchingJudgement>;

export interface IndexMatchingMetrics {
  indexVersion: string;
  precisionAt5: number;
  recallAt5: number;
  mustNotViolations: number;
  hardConstraintViolations: number;
  coverageRate: number;
  declineCount: number;
}

export interface ThresholdCalibrationRow {
  minScore: number;
  precisionAt5: number;
  coverageRate: number;
  mustNotViolations: number;
}

export interface MatchingCaseExample {
  seedId: string;
  seedTitle: string;
  brand: Brand;
  kind: "decline" | "thin-record-lift" | "imperfect-neighbour" | "unavailable";
  enrichedTop3: RecommendationItem[];
  rawTop3: RecommendationItem[];
}

export interface MatchingEvalReport {
  minScoreThreshold: number;
  enrichedMetrics: IndexMatchingMetrics;
  rawMetrics: IndexMatchingMetrics;
  thresholdCalibration: ThresholdCalibrationRow[];
  gatesPassed: boolean;
  examples: MatchingCaseExample[];
}

const round = (n: number) => Number(n.toFixed(4));

export function toRawBaselineIndex(index: GameIndex): GameIndex {
  return GameIndex.parse({
    ...index,
    indexVersion: `raw_${index.indexVersion}`,
    enrichmentModel: null,
    entries: index.entries.map((e) => ({ game: e.game, neighbors: e.rawNeighbors ?? e.neighbors })),
  });
}

export function buildReferenceJudgements(truth: CatalogueGame[], index: GameIndex): MatchingJudgement[] {
  const truthById = new Map(truth.map((g) => [g.id, g]));
  const judgements: MatchingJudgement[] = [];
  let cleanSeeds = 0;
  let enrichedSeeds = 0;

  for (const { game } of index.entries) {
    const seed = truthById.get(game.id);
    const brand = game.brands[0];
    if (!seed || game.status !== "active" || !brand) continue;

    const isOutlier = seed.category === "bingo";
    const isEnriched = Boolean(game.enrichment);
    if (!isOutlier && ((isEnriched && enrichedSeeds >= 12) || (!isEnriched && cleanSeeds >= 10))) continue;

    const seedTags = new Set<string>([...seed.themes, ...seed.mechanics]);
    const relevant: string[] = [];
    const mustNot: string[] = [];

    for (const { game: cg } of index.entries) {
      if (cg.id === seed.id) continue;
      if (cg.canonicalId === seed.canonicalId || cg.status !== "active" || !cg.brands.includes(brand)) {
        mustNot.push(cg.id);
        continue;
      }
      const ct = truthById.get(cg.id);
      if (!ct) continue;
      const overlap = [...ct.themes, ...ct.mechanics].filter((tag) => seedTags.has(tag)).length;
      if (ct.category === seed.category && overlap >= 2) relevant.push(cg.id);
      else if (ct.category !== seed.category && overlap === 0) mustNot.push(cg.id);
    }

    if (isOutlier || relevant.length >= 2) {
      if (!isOutlier) isEnriched ? enrichedSeeds++ : cleanSeeds++;
      judgements.push({ seedId: seed.id, brand, relevant, mustNot, expectDecline: isOutlier });
    }
  }
  return judgements;
}

function scoreIndex(
  index: GameIndex,
  judgements: MatchingJudgement[],
  minScore: number,
  checkHardConstraints = true,
): IndexMatchingMetrics {
  const rec = createRecommender(index, minScore);
  const byId = new Map(index.entries.map((e) => [e.game.id, e.game]));
  let hardConstraintViolations = 0;
  let activeQueries = 0;
  let declineCount = 0;

  for (const { game: seed } of index.entries) {
    for (const brand of BRANDS) {
      const res = rec.recommend(seed.id, brand, 5);
      if (seed.status !== "active" || !seed.brands.includes(brand)) {
        if (checkHardConstraints && res !== null) hardConstraintViolations++;
        continue;
      }
      activeQueries++;
      if (!res || res.recommendations.length === 0) {
        declineCount++;
        continue;
      }
      if (!checkHardConstraints) continue;
      const seenCanonical = new Set<string>();
      for (const item of res.recommendations) {
        const cand = byId.get(item.gameId);
        if (
          !cand ||
          cand.id === seed.id ||
          cand.canonicalId === seed.canonicalId ||
          cand.status !== "active" ||
          !cand.brands.includes(brand) ||
          item.score < minScore ||
          seenCanonical.has(cand.canonicalId)
        ) {
          hardConstraintViolations++;
        }
        if (cand) seenCanonical.add(cand.canonicalId);
      }
    }
  }

  let precisionSum = 0;
  let recallSum = 0;
  let scored = 0;
  let mustNotViolations = 0;

  for (const j of judgements) {
    const items = rec.recommend(j.seedId, j.brand, 5)?.recommendations ?? [];
    if (j.expectDecline) {
      mustNotViolations += items.length;
      continue;
    }
    for (const item of items) if (j.mustNot.includes(item.gameId)) mustNotViolations++;
    if (j.relevant.length === 0) continue;

    scored++;
    const hits = items.filter((i) => j.relevant.includes(i.gameId)).length;
    precisionSum += items.length === 0 ? 0 : hits / items.length;
    recallSum += hits / j.relevant.length;
  }

  return {
    indexVersion: index.indexVersion,
    precisionAt5: scored === 0 ? 0 : round(precisionSum / scored),
    recallAt5: scored === 0 ? 0 : round(recallSum / scored),
    mustNotViolations,
    hardConstraintViolations,
    coverageRate: activeQueries === 0 ? 0 : round((activeQueries - declineCount) / activeQueries),
    declineCount,
  };
}

export function evaluateMatching(
  enrichedIndex: GameIndex,
  rawIndex: GameIndex,
  judgements: MatchingJudgement[],
  minScore = DEFAULT_MIN_SCORE,
): MatchingEvalReport {
  const enrichedMetrics = scoreIndex(enrichedIndex, judgements, minScore);
  const rawMetrics = scoreIndex(rawIndex, judgements, minScore);
  const thresholdCalibration = [0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75].map((t) => {
    const m = scoreIndex(enrichedIndex, judgements, t, false);
    return { minScore: t, precisionAt5: m.precisionAt5, coverageRate: m.coverageRate, mustNotViolations: m.mustNotViolations };
  });

  const eRec = createRecommender(enrichedIndex, minScore);
  const rRec = createRecommender(rawIndex, minScore);
  const byId = new Map(enrichedIndex.entries.map((e) => [e.game.id, e.game]));
  const examples: MatchingCaseExample[] = [];
  const top3 = (rec: ReturnType<typeof createRecommender>, id: string, b: Brand) =>
    rec.recommend(id, b, 3)?.recommendations ?? [];

  const bingo = enrichedIndex.entries.find((e) => e.game.category === "bingo" && e.game.brands[0]);
  if (bingo?.game.brands[0]) {
    const b = bingo.game.brands[0];
    examples.push({ seedId: bingo.game.id, seedTitle: bingo.game.title, brand: b, kind: "decline", enrichedTop3: top3(eRec, bingo.game.id, b), rawTop3: top3(rRec, bingo.game.id, b) });
  }

  for (const j of judgements) {
    const g = byId.get(j.seedId);
    if (!g || j.expectDecline) continue;
    const eTop = top3(eRec, j.seedId, j.brand);
    const rTop = top3(rRec, j.seedId, j.brand);
    if (g.enrichment && !examples.some((x) => x.kind === "thin-record-lift") && eTop[0]?.gameId !== rTop[0]?.gameId) {
      examples.push({ seedId: g.id, seedTitle: g.title, brand: j.brand, kind: "thin-record-lift", enrichedTop3: eTop, rawTop3: rTop });
    } else if (!examples.some((x) => x.kind === "imperfect-neighbour") && eTop.some((x) => !j.relevant.includes(x.gameId))) {
      examples.push({ seedId: g.id, seedTitle: g.title, brand: j.brand, kind: "imperfect-neighbour", enrichedTop3: eTop, rawTop3: rTop });
    }
  }

  const inactive = enrichedIndex.entries.find((e) => e.game.status === "inactive");
  if (inactive) {
    examples.push({ seedId: inactive.game.id, seedTitle: inactive.game.title, brand: "northstar", kind: "unavailable", enrichedTop3: [], rawTop3: [] });
  }

  return {
    minScoreThreshold: minScore,
    enrichedMetrics,
    rawMetrics,
    thresholdCalibration,
    gatesPassed:
      enrichedMetrics.hardConstraintViolations === 0 &&
      enrichedMetrics.mustNotViolations === 0 &&
      enrichedMetrics.precisionAt5 >= rawMetrics.precisionAt5,
    examples,
  };
}
