# Leverage: Making the Next R&D Prototype Cheaper to Productionise

## The Artifact
[`.agents/skills/prototype-to-production/SKILL.md`](../.agents/skills/prototype-to-production/SKILL.md) - a reusable agent skill encoding the productionisation rules and evaluation checks for taking an R&D AI capability onto a live, regulated player surface.

## Why This Shape
R&D prototypes fail or stall on the way to production in predictable ways: LLM calls left on the live request path, factual fields hallucinated alongside descriptive ones, no decline threshold when confidence is low, and unit tests presented in place of AI quality evaluation.

Packaging those guardrails as a workspace **skill** (`SKILL.md`) gives a small team high leverage with near-zero maintenance:
1. **Tool-native:** Coding agents (Antigravity, Claude Code, Cursor, Codex) automatically discover `.agents/skills/*/SKILL.md` and apply its rules during planning, implementation, and final review.
2. **Stack-agnostic:** Unlike a framework-specific template repo that drifts out of date, the checklist constrains *architecture and evaluation shape* (offline/online split, structural exclusion of regulated fields, provenance tagging, baseline comparison, automated pass checks) whether the next service is written in TypeScript or Python.

## How It Applies to the Next Prototype
Examples of upcoming R&D prototypes this skill directly accelerates:
- **Semantic Lobby Search / Natural-Language Game Finder:** Enforces offline catalogue query-expansion/embedding, maps user queries to controlled vocabulary tags without live LLM latency, declines onto standard keyword search below threshold, and blocks release on `mustNot` jurisdiction/brand checks.
- **Automated Game Tagging for Responsible Gambling / Compliance Review:** Reuses the exact `EnrichmentOutput` pattern (strict vocabulary, per-field provenance, zero factual fabrication check, hash-cached batch runs) while routing low-confidence records to human review.
- **Promo / Bonus Eligibility Matcher:** Separates deterministic terms/wagering parsing from semantic matching and requires a baseline comparison before shipping.
