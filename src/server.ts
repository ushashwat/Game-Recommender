/** HTTP recommendation service (`npm start`) using Node's built-in `node:http` with auth, validation, and redacted logs. */
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { loadDotEnv, loadServiceConfig } from "./config.js";
import { GameIndex } from "./pipeline/build-index.js";
import { createRecommender, type Recommender } from "./recommender.js";
import { BRANDS, Brand } from "./schema.js";

const QuerySchema = z.object({
  gameId: z.string().regex(/^g_\d{4}$/, "expected id like g_0001"),
  brand: Brand.optional(),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

export interface ServerOptions {
  recommender: Recommender;
  apiKey: string;
  logger?: (entry: Record<string, unknown>) => void;
}

function safeKeyMatch(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

export function createApp({ recommender, apiKey, logger }: ServerOptions): Server {
  const log = logger ?? ((entry) => console.log(JSON.stringify(entry)));

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const start = performance.now();
    const requestId = randomUUID();
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    const finish = (status: number, extra: Record<string, unknown> = {}) => {
      log({
        requestId,
        method: req.method,
        path: url.pathname,
        status,
        latencyMs: Number((performance.now() - start).toFixed(2)),
        headers: {
          "x-api-key": req.headers["x-api-key"] ? "[REDACTED]" : undefined,
          authorization: req.headers.authorization ? "[REDACTED]" : undefined,
        },
        ...extra,
      });
    };

    try {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" }, { Allow: "GET" });
        finish(405);
        return;
      }

      if (url.pathname === "/health") {
        sendJson(res, 200, {
          status: "ok",
          indexVersion: recommender.indexVersion,
          catalogueSize: recommender.catalogueSize,
          brands: BRANDS,
        });
        finish(200);
        return;
      }

      if (url.pathname === "/v1/recommendations") {
        const headerKey = Array.isArray(req.headers["x-api-key"])
          ? req.headers["x-api-key"][0]
          : req.headers["x-api-key"];

        if (!safeKeyMatch(headerKey, apiKey)) {
          sendJson(res, 401, { error: "UNAUTHORIZED" });
          finish(401);
          return;
        }

        const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams));
        if (!parsed.success) {
          const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
          sendJson(res, 400, { error: "INVALID_QUERY", message });
          finish(400);
          return;
        }

        const { gameId, brand, limit } = parsed.data;
        const outcome = recommender.lookup(gameId, brand, limit);
        if (!outcome.ok) {
          const { ok: _, ...detail } = outcome;
          sendJson(res, 404, detail);
          finish(404, { gameId, brand, error: outcome.error });
          return;
        }

        const { result } = outcome;
        sendJson(res, 200, result);
        finish(200, {
          gameId,
          brand: result.brand,
          resultCount: result.recommendations.length,
          declineReason: result.reason,
        });
        return;
      }

      sendJson(res, 404, { error: "NOT_FOUND" });
      finish(404);
    } catch {
      sendJson(res, 500, { error: "INTERNAL_ERROR" });
      finish(500);
    }
  });
}

async function main(): Promise<void> {
  loadDotEnv();
  const cfg = loadServiceConfig();
  const index = GameIndex.parse(JSON.parse(readFileSync("data/index.json", "utf8")));
  const recommender = createRecommender(index);
  const server = createApp({ recommender, apiKey: cfg.SERVICE_API_KEY });

  server.listen(cfg.PORT, cfg.HOST, () => {
    console.log(
      JSON.stringify({
        event: "server_started",
        url: `http://${cfg.HOST}:${cfg.PORT}`,
        indexVersion: recommender.indexVersion,
        catalogueSize: recommender.catalogueSize,
        brands: BRANDS,
      }),
    );
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
