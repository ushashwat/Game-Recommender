/** Evaluation runner (`npm run eval`) that executes both AI stages and writes docs/REPORT.md. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { GameIndex } from "../src/pipeline/build-index.js";
import { CatalogueGame } from "../src/schema.js";
import { type EnrichmentEvalReport, evaluateEnrichment } from "./enrichment.eval.js";
import {
  buildReferenceJudgements,
  evaluateMatching,
  MatchingJudgement,
  type MatchingEvalReport,
  toRawBaselineIndex,
} from "./matching.eval.js";

export function formatEvalMarkdown(
  enrichment: EnrichmentEvalReport,
  matching: MatchingEvalReport,
): string {
  const pass = (ok: boolean) => (ok ? "PASS" : "FAIL");
  const lines = [
    "# AI Evaluation Report",
    "",
    `Overall evaluation checks: **${enrichment.gatesPassed && matching.gatesPassed ? "PASSED" : "FAILED"}**`,
    "",
    "## 1. Stage 1 - LLM Metadata Enrichment (vs Ground Truth)",
    "",
    "| Metric | Value | Pass Criteria | Status |",
    "|---|---|---|---|",
    `| Total records | ${enrichment.totalRecords} (LLM: ${enrichment.enrichedByLlmCount}, fallbacks: ${enrichment.fallbackCount}) | - | - |`,
    `| Schema & vocabulary validity | ${(enrichment.schemaValidityRate * 100).toFixed(1)}% | 100.0% | ${pass(enrichment.schemaValidityRate === 1)} |`,
    `| Factual field fabrications (RTP, provider, brands, releaseDate, status) | ${enrichment.factualFabrications} | 0 | ${pass(enrichment.factualFabrications === 0)} |`,
    `| Summary compliance violations (invented RTP% or promo hype) | ${enrichment.summaryComplianceViolations} | 0 | ${pass(enrichment.summaryComplianceViolations === 0)} |`,
    `| Recovered Themes (n=${enrichment.themes.evaluatedCount}) | P=${enrichment.themes.precision} / R=${enrichment.themes.recall} / **F1=${enrichment.themes.f1}** / **Hit@1=${(enrichment.themes.primaryHitRate * 100).toFixed(1)}%** | Regression baseline: F1 >= 0.70 & Hit@1 >= 85%; F1 > no-LLM baseline | ${pass(enrichment.themes.f1 > enrichment.baselineF1.themes && enrichment.themes.f1 >= 0.7 && enrichment.themes.primaryHitRate >= 0.85)} |`,
    `| Recovered Mechanics (n=${enrichment.mechanics.evaluatedCount}) | P=${enrichment.mechanics.precision} / R=${enrichment.mechanics.recall} / **F1=${enrichment.mechanics.f1}** / **Hit@1=${(enrichment.mechanics.primaryHitRate * 100).toFixed(1)}%** | Regression baseline: F1 >= 0.70 & Hit@1 >= 85%; F1 > no-LLM baseline | ${pass(enrichment.mechanics.f1 > enrichment.baselineF1.mechanics && enrichment.mechanics.f1 >= 0.7 && enrichment.mechanics.primaryHitRate >= 0.85)} |`,
    `| No-LLM baseline F1 (predict 2 most frequent tags for every record) | Themes ${enrichment.baselineF1.themes} / Mechanics ${enrichment.baselineF1.mechanics} | LLM F1 must exceed | - |`,
    `| Volatility Abstention Rate | ${(enrichment.volatilityAbstentionRate * 100).toFixed(1)}% | Informational (return null when unstated) | - |`,
    "",
    "> The F1 and Hit@1 numbers are regression baselines taken from the first measured run on this small fictional dataset (n is shown per row). They are not claims of absolute quality: a production system must not degrade below them, and real targets need human labels or live click data.",
    "",
    "### Enrichment Error & Fallback Cases",
    ...enrichment.failureCases.map(
      (c) =>
        `- **${c.title}** (\`${c.gameId}\`, \`${c.field}\`): expected \`${JSON.stringify(c.expected)}\`, got \`${JSON.stringify(c.actual)}\``,
    ),
    "",
    "## 2. Stage 2 - Embedding Similarity Matching (Enriched vs Raw Baseline)",
    "",
    `Operating threshold: **${matching.minScoreThreshold}**`,
    "",
    "| Metric | Raw Index (No LLM) | Enriched Index (With LLM) | Pass Criteria | Status |",
    "|---|---|---|---|---|",
    `| Hard-constraint violations | ${matching.rawMetrics.hardConstraintViolations} | ${matching.enrichedMetrics.hardConstraintViolations} | 0 | ${pass(matching.enrichedMetrics.hardConstraintViolations === 0)} |`,
    `| Reference \`mustNot\` violations | ${matching.rawMetrics.mustNotViolations} | ${matching.enrichedMetrics.mustNotViolations} | 0 | ${pass(matching.enrichedMetrics.mustNotViolations === 0)} |`,
    `| Precision@5 | ${matching.rawMetrics.precisionAt5} | **${matching.enrichedMetrics.precisionAt5}** | >= Raw | ${pass(matching.enrichedMetrics.precisionAt5 >= matching.rawMetrics.precisionAt5)} |`,
    `| Recall@5 | ${matching.rawMetrics.recallAt5} | **${matching.enrichedMetrics.recallAt5}** | Informational | - |`,
    `| Active coverage | ${(matching.rawMetrics.coverageRate * 100).toFixed(1)}% | ${(matching.enrichedMetrics.coverageRate * 100).toFixed(1)}% (${matching.enrichedMetrics.declineCount} declines) | Informational | - |`,
    "",
    "### Threshold Calibration Sweep",
    "",
    "| Threshold (`minScore`) | Precision@5 | Coverage % | `mustNot` Violations |",
    "|---|---|---|---|",
    ...matching.thresholdCalibration.map(
      (r) =>
        `| ${r.minScore.toFixed(2)} | ${r.precisionAt5} | ${(r.coverageRate * 100).toFixed(1)}% | ${r.mustNotViolations} |`,
    ),
    "",
    "### Concrete Matching & Decline Cases",
    ...matching.examples.map((ex) => {
      const fmt = (items: typeof ex.enrichedTop3) =>
        items.map((r) => `${r.title} (\`${r.gameId}\`, ${r.score})`).join(", ") || "*(declined)*";
      return `- **[${ex.kind}] ${ex.seedTitle}** (\`${ex.seedId}\`, \`${ex.brand}\`)\n  - Enriched: ${fmt(ex.enrichedTop3)}\n  - Raw: ${fmt(ex.rawTop3)}`;
    }),
  ];
  return `${lines.join("\n")}\n`;
}

function main(): void {
  const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
  const truth = z.array(CatalogueGame).parse(readJson("data/catalogue.truth.json"));
  const raw = z.array(CatalogueGame).parse(readJson("data/catalogue.raw.json"));
  const enrichedIndex = GameIndex.parse(readJson("data/index.json"));
  const enriched = enrichedIndex.entries.map((e) => e.game);
  const rawIndex = toRawBaselineIndex(enrichedIndex);

  mkdirSync("eval/reference", { recursive: true });
  const judgementsPath = "eval/reference/matching-judgements.json";
  const judgements = existsSync(judgementsPath)
    ? z.array(MatchingJudgement).parse(readJson(judgementsPath))
    : buildReferenceJudgements(truth, enrichedIndex);

  if (!existsSync(judgementsPath)) {
    writeFileSync(judgementsPath, `${JSON.stringify(judgements, null, 2)}\n`);
  }

  const enrichmentReport = evaluateEnrichment(truth, raw, enriched);
  const matchingReport = evaluateMatching(enrichedIndex, rawIndex, judgements);
  const markdown = formatEvalMarkdown(enrichmentReport, matchingReport);

  mkdirSync("docs", { recursive: true });
  writeFileSync("docs/REPORT.md", markdown);
  console.log(markdown);

  if (!enrichmentReport.gatesPassed || !matchingReport.gatesPassed) {
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
