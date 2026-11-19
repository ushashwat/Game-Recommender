# AI Evaluation Report

Overall evaluation checks: **PASSED**

## 1. Stage 1 - LLM Metadata Enrichment (vs Ground Truth)

| Metric | Value | Pass Criteria | Status |
|---|---|---|---|
| Total records | 100 (LLM: 40, fallbacks: 0) | - | - |
| Schema & vocabulary validity | 100.0% | 100.0% | PASS |
| Factual field fabrications (RTP, provider, brands, releaseDate, status) | 0 | 0 | PASS |
| Summary compliance violations (invented RTP% or promo hype) | 0 | 0 | PASS |
| Recovered Themes (n=28) | P=0.7358 / R=0.75 / **F1=0.7429** / **Hit@1=92.9%** | Regression baseline: F1 >= 0.70 & Hit@1 >= 85%; F1 > no-LLM baseline | PASS |
| Recovered Mechanics (n=28) | P=0.7778 / R=0.6364 / **F1=0.7** / **Hit@1=85.7%** | Regression baseline: F1 >= 0.70 & Hit@1 >= 85%; F1 > no-LLM baseline | PASS |
| No-LLM baseline F1 (predict 2 most frequent tags for every record) | Themes 0.2037 / Mechanics 0.3308 | LLM F1 must exceed | - |
| Volatility Abstention Rate (% of missing-volatility games left as `null` instead of guessed) | 79.2% | Informational (avoid guessing unstated risk) | - |

> The F1 and Hit@1 numbers are regression baselines taken from the first measured run on this small fictional dataset (n is shown per row). They are not claims of absolute quality: a production system must not degrade below them, and real targets need human labels or live click data.

### Enrichment Error & Fallback Cases
*(Expected values come from `data/catalogue.truth.json` before degradation stripped descriptions or mechanic clues.)*
- **Labyrinth of the Minotaur** (`g_0014`, `mechanics`): expected `["cluster-pays","cascading-reels","multipliers"]`, got `["paylines","free-spins"]`
- **The Oracle's Star Map** (`g_0017`, `mechanics`): expected `["ways-to-win","cascading-reels","multipliers"]`, got `["paylines","free-spins"]`
- **Moonlit Howl** (`g_0032`, `mechanics`): expected `["cluster-pays","cascading-reels","multipliers"]`, got `["paylines","free-spins"]`
- **Coral Crown Reef** (`g_0036`, `mechanics`): expected `["cluster-pays","cascading-reels","multipliers"]`, got `["ways-to-win","free-spins"]`
- **Peppermint Pantry Hold & Win** (`g_0057`, `volatility`): expected `"high"`, got `"medium"`

## 2. Stage 2 - Embedding Similarity Matching (Enriched vs Raw Baseline)

Operating threshold: **0.55**

| Metric | Raw Index (No LLM) | Enriched Index (With LLM) | Pass Criteria | Status |
|---|---|---|---|---|
| Hard-constraint violations | 0 | 0 | 0 | PASS |
| Reference `mustNot` violations (forbidden unrelated/invalid matches or failed declines) | 1 | 0 | 0 | PASS |
| Precision@5 | 0.6273 | **0.6909** | >= Raw | PASS |
| Recall@5 | 0.2264 | **0.2496** | Informational | - |
| Active coverage (% of 169 active game/brand queries returning >=1 match) | 98.8% (2 declines) | 98.2% (3 declines - adds bingo outlier decline) | Informational | - |

### Threshold Calibration Sweep

| Threshold (`minScore`) | Precision@5 | Coverage % | `mustNot` Violations |
|---|---|---|---|
| 0.45 | 0.6909 | 99.4% | 5 |
| 0.50 | 0.6909 | 99.4% | 2 |
| 0.55 | 0.6909 | 98.2% | 0 |
| 0.60 | 0.6909 | 98.2% | 0 |
| 0.65 | 0.6909 | 98.2% | 0 |
| 0.70 | 0.6803 | 98.2% | 0 |
| 0.75 | 0.7553 | 84.0% | 0 |

### Concrete Matching & Decline Cases
- **[decline] Moonlit Marquee Bingo** (`g_0088`, `lucky-harbour`)
  - Enriched: *(declined)*
  - Raw: Moon Gate Mahjong Reels (`g_0053`, 0.5508)
- **[imperfect-neighbour] Pharaoh's Curse: Sands of Judgment** (`g_0005`, `redcrest`)
  - Enriched: Tomb of Anubis (`g_0001`, 0.8027), Osiris and the Green Kingdom (`g_0012`, 0.8016), Scarab Caravan (`g_0010`, 0.8011)
  - Raw: Osiris and the Green Kingdom (`g_0012`, 0.8098), Tomb of Anubis (`g_0001`, 0.8043), Scarab Caravan (`g_0010`, 0.802)
- **[thin-record-lift] Osiris and the Green Kingdom** (`g_0012`, `redcrest`)
  - Enriched: Pharaoh's Curse: Sands of Judgment (`g_0005`, 0.8016), Tomb of Anubis (`g_0001`, 0.7948), Pegasus Over the Aegean Deluxe (`g_0093`, 0.7944)
  - Raw: Labyrinth of the Minotaur (`g_0014`, 0.8206), Pharaoh's Curse: Sands of Judgment (`g_0005`, 0.8098), Tomb of Anubis (`g_0001`, 0.8002)
- **[unavailable] Pegasus Over the Aegean** (`g_0016`, `northstar`)
  - Enriched: *(declined)*
  - Raw: *(declined)*
