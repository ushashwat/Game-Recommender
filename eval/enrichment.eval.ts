/** Stage 1 AI evaluation: scores LLM enrichment against ground truth, invariants, and a no-LLM baseline. */
import { type CatalogueGame, EnrichedGame } from "../src/schema.js";

export interface SetScores {
  evaluatedCount: number;
  precision: number;
  recall: number;
  f1: number;
  primaryHitRate: number;
}

export interface EnrichmentFailureCase {
  gameId: string;
  title: string;
  field: "themes" | "mechanics" | "volatility" | "summary" | "fallback";
  expected: unknown;
  actual: unknown;
}

export interface EnrichmentEvalReport {
  totalRecords: number;
  enrichedByLlmCount: number;
  fallbackCount: number;
  schemaValidityRate: number;
  factualFabrications: number;
  summaryComplianceViolations: number;
  themes: SetScores;
  mechanics: SetScores;
  volatilityAbstentionRate: number;
  baselineF1: { themes: number; mechanics: number };
  gatesPassed: boolean;
  failureCases: EnrichmentFailureCase[];
}

const round = (n: number) => Number(n.toFixed(4));
const SUMMARY_VIOLATION_RE = /\b(\d{2}(\.\d+)?%\s*rtp|rtp\s*\d{2}|win big|guaranteed|best odds|play now)\b/i;

function scoreTagLists(pairs: Array<{ truth: string[]; pred: string[] }>): SetScores {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let primaryHits = 0;

  for (const { truth, pred } of pairs) {
    const tSet = new Set(truth);
    const pSet = new Set(pred);
    let hits = 0;
    for (const tag of pSet) {
      if (tSet.has(tag)) hits++;
      else fp++;
    }
    tp += hits;
    fn += tSet.size - hits;
    if (hits > 0) primaryHits++;
  }

  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    evaluatedCount: pairs.length,
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    primaryHitRate: round(pairs.length === 0 ? 1 : primaryHits / pairs.length),
  };
}

function mostFrequentTags(lists: string[][], k: number): string[] {
  const counts = new Map<string, number>();
  for (const tag of lists.flat()) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, k).map(([tag]) => tag);
}

export function evaluateEnrichment(
  truth: CatalogueGame[],
  raw: CatalogueGame[],
  enriched: EnrichedGame[],
): EnrichmentEvalReport {
  const truthById = new Map(truth.map((g) => [g.id, g]));
  const rawById = new Map(raw.map((r) => [r.id, r]));

  let validSchema = 0;
  let factualFabrications = 0;
  let summaryComplianceViolations = 0;
  let enrichedByLlmCount = 0;
  let fallbackCount = 0;
  let volAbstained = 0;
  let volCount = 0;

  const themePairs: Array<{ truth: string[]; pred: string[] }> = [];
  const mechPairs: Array<{ truth: string[]; pred: string[] }> = [];
  const failureCases: EnrichmentFailureCase[] = [];
  const recordFailure = (c: EnrichmentFailureCase) => {
    if (failureCases.length < 5) failureCases.push(c);
  };

  for (const e of enriched) {
    if (EnrichedGame.safeParse(e).success) validSchema++;
    if (e.enrichment) enrichedByLlmCount++;

    if (e.provenance.summary === "llm" && e.summary && SUMMARY_VIOLATION_RE.test(e.summary)) {
      summaryComplianceViolations++;
      recordFailure({ gameId: e.id, title: e.title, field: "summary", expected: "neutral summary", actual: e.summary });
    }

    const r = rawById.get(e.id);
    if (!r) continue;
    if (
      e.rtp !== r.rtp ||
      e.provider !== r.provider ||
      e.releaseDate !== r.releaseDate ||
      e.status !== r.status ||
      e.brands.join(",") !== r.brands.join(",")
    ) {
      factualFabrications++;
    }

    const t = truthById.get(e.id);
    if (!t) continue;

    if (
      !e.enrichment &&
      (!r.description || r.description.length < 80 || r.themes.length === 0 || r.mechanics.length === 0 || !r.volatility)
    ) {
      fallbackCount++;
      recordFailure({ gameId: e.id, title: e.title, field: "fallback", expected: t.themes, actual: e.themes });
    }

    for (const [field, pairs] of [
      ["themes", themePairs],
      ["mechanics", mechPairs],
    ] as const) {
      if (r[field].length === 0) {
        pairs.push({ truth: t[field], pred: e[field] });
        if (!e[field].some((tag) => (t[field] as string[]).includes(tag))) {
          recordFailure({ gameId: e.id, title: e.title, field, expected: t[field], actual: e[field] });
        }
      }
    }

    if (r.volatility === null && t.volatility !== null) {
      volCount++;
      if (e.volatility === null) volAbstained++;
      else if (e.volatility !== t.volatility) {
        recordFailure({ gameId: e.id, title: e.title, field: "volatility", expected: t.volatility, actual: e.volatility });
      }
    }
  }

  const schemaValidityRate = enriched.length === 0 ? 1 : round(validSchema / enriched.length);
  const themes = scoreTagLists(themePairs);
  const mechanics = scoreTagLists(mechPairs);
  const topThemes = mostFrequentTags(truth.map((g) => g.themes), 2);
  const topMechanics = mostFrequentTags(truth.map((g) => g.mechanics), 2);
  const baselineF1 = {
    themes: scoreTagLists(themePairs.map((p) => ({ truth: p.truth, pred: topThemes }))).f1,
    mechanics: scoreTagLists(mechPairs.map((p) => ({ truth: p.truth, pred: topMechanics }))).f1,
  };
  const volatilityAbstentionRate = volCount === 0 ? 1 : round(volAbstained / volCount);

  return {
    totalRecords: enriched.length,
    enrichedByLlmCount,
    fallbackCount,
    schemaValidityRate,
    factualFabrications,
    summaryComplianceViolations,
    themes,
    mechanics,
    volatilityAbstentionRate,
    baselineF1,
    gatesPassed:
      schemaValidityRate === 1 &&
      factualFabrications === 0 &&
      summaryComplianceViolations === 0 &&
      themes.f1 > baselineF1.themes &&
      mechanics.f1 > baselineF1.mechanics &&
      themes.f1 >= 0.7 &&
      themes.primaryHitRate >= 0.85 &&
      mechanics.f1 >= 0.7 &&
      mechanics.primaryHitRate >= 0.85,
    failureCases,
  };
}
