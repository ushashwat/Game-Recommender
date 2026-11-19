/** Local CLI demo harness (`npm run demo`) for querying recommendations by game title or ID. */
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { loadDotEnv, loadServiceConfig } from "../src/config.js";
import { GameIndex } from "../src/pipeline/build-index.js";
import { createRecommender } from "../src/recommender.js";
import { BRANDS, type Brand } from "../src/schema.js";
import { createApp } from "../src/server.js";

async function queryOne(
  baseUrl: string,
  apiKey: string,
  gameId: string,
  title: string,
  brand?: string,
  limit = 5,
): Promise<void> {
  const brandParam = brand ? `&brand=${encodeURIComponent(brand)}` : "";
  const res = await fetch(
    `${baseUrl}/v1/recommendations?gameId=${encodeURIComponent(gameId)}${brandParam}&limit=${limit}`,
    { headers: { "x-api-key": apiKey } },
  );
  const body = (await res.json()) as {
    recommendations?: Array<{ gameId: string; title: string; score: number }>;
    error?: string;
    message?: string;
    availableBrands?: string[];
  };

  if (!res.ok) {
    if (body.error === "GAME_INACTIVE") {
      console.log(`Game "${title}" is currently inactive in the catalogue.`);
    } else if (body.error === "GAME_NOT_ON_BRAND") {
      console.log(`Game "${title}" is not available on brand "${brand}" (available on: ${body.availableBrands?.join(", ") ?? "other brands"}).`);
    } else if (body.error === "GAME_NOT_FOUND") {
      console.log(`Game "${title}" was not found in the catalogue.`);
    } else {
      console.log(`Request failed (${res.status} ${body.error ?? "ERROR"}): ${body.message ?? "check server configuration"}`);
    }
    return;
  }

  if (!body.recommendations || body.recommendations.length === 0) {
    console.log(`No similar games meet the confidence threshold for "${title}".`);
    return;
  }

  console.log(`\nBecause you played ${title}, you might like...`);
  for (const [i, rec] of body.recommendations.entries()) {
    console.log(`  ${i + 1}. ${rec.title}`);
  }
}

async function runQuery(baseUrl: string, apiKey: string, index: GameIndex, args: string[]): Promise<void> {
  const q = args[0]!.toLowerCase().trim();
  const match =
    index.entries.find((e) => e.game.id.toLowerCase() === q) ??
    index.entries.find((e) => e.game.title.toLowerCase() === q) ??
    index.entries.find((e) => e.game.title.toLowerCase().includes(q));

  if (!match) {
    console.log(`Game "${args[0]!.trim()}" was not found in the catalogue.`);
    return;
  }

  const requestedBrand = args[1]?.toLowerCase().trim() as Brand | undefined;
  if (requestedBrand && !BRANDS.includes(requestedBrand)) {
    console.log(`Unknown brand "${args[1]}". Allowed brands: ${BRANDS.join(", ")}.`);
    return;
  }

  let limit = 5;
  if (args[2] !== undefined) {
    const parsed = Number(args[2]);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
      console.log(`Invalid limit "${args[2]}". Expected an integer between 1 and 10.`);
      return;
    }
    limit = parsed;
  }

  await queryOne(baseUrl, apiKey, match.game.id, match.game.title, requestedBrand, limit);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(`Available brands: ${BRANDS.join(", ")}`);
    console.log('Usage: npm run demo -- "<game title or id>" [brand] [limit]');
    return;
  }

  loadDotEnv();
  const cfg = loadServiceConfig();
  const index = GameIndex.parse(JSON.parse(readFileSync("data/index.json", "utf8")));
  const configuredUrl = `http://127.0.0.1:${cfg.PORT}`;

  try {
    const probe = await fetch(`${configuredUrl}/health`, { signal: AbortSignal.timeout(800) });
    if (probe.ok) {
      await runQuery(configuredUrl, cfg.SERVICE_API_KEY, index, args);
      return;
    }
  } catch {
    // Ephemeral server fallback
  }

  const server = createApp({ recommender: createRecommender(index), apiKey: cfg.SERVICE_API_KEY, logger: () => {} });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  try {
    const { port } = server.address() as AddressInfo;
    await runQuery(`http://127.0.0.1:${port}`, cfg.SERVICE_API_KEY, index, args);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
