/** OpenAI-compatible HTTP client using Node built-in `fetch` with timeouts, retries, JSON schema, and zod validation. */
import type { z } from "zod";
import type { PipelineConfig } from "./config.js";

export interface ChatStructuredRequest<T extends z.ZodType> {
  system: string;
  user: string;
  schemaName: string;
  schema: T;
  temperature?: number;
  seed?: number;
}

export interface LlmClient {
  readonly model: string;
  readonly embeddingModel: string;
  completeStructured<T extends z.ZodType>(req: ChatStructuredRequest<T>): Promise<z.infer<T>>;
  embed(texts: string[]): Promise<number[][]>;
}

const TIMEOUT_MS = 45_000;
const MAX_RETRIES = 3;

export function createLlmClient(cfg: PipelineConfig, fetchImpl: typeof fetch = fetch): LlmClient {
  const baseUrl = cfg.LLM_BASE_URL.replace(/\/+$/, "");

  async function post<R>(path: string, body: unknown): Promise<R> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await fetchImpl(`${baseUrl}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cfg.LLM_API_KEY}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (res.ok) {
          return (await res.json()) as R;
        }

        const status = res.status;
        const detail = (await res.text()).slice(0, 200);
        if (status === 429 || status >= 500) {
          lastError = new Error(`LLM HTTP ${status}: ${detail}`);
        } else {
          throw new Error(`LLM HTTP ${status}: ${detail}`);
        }
      } catch (err) {
        if (err instanceof Error && /^LLM HTTP 4(?!29)\d\d/.test(err.message)) {
          throw err;
        }
        lastError = err;
      }

      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("LLM request failed");
  }

  return {
    model: cfg.LLM_MODEL,
    embeddingModel: cfg.EMBEDDING_MODEL,

    async completeStructured<T extends z.ZodType>(req: ChatStructuredRequest<T>): Promise<z.infer<T>> {
      const jsonSchema = req.schema.toJSONSchema();
      const data = await post<{
        choices?: Array<{ message?: { content?: string | null } }>;
      }>("/chat/completions", {
        model: cfg.LLM_MODEL,
        temperature: req.temperature ?? 0,
        seed: req.seed ?? 42,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: req.schemaName,
            strict: true,
            schema: jsonSchema,
          },
        },
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      });

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Empty LLM completion response");
      }
      const parsedJson: unknown = JSON.parse(content);
      return req.schema.parse(parsedJson);
    },

    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const data = await post<{
        data?: Array<{ index: number; embedding: number[] }>;
      }>("/embeddings", {
        model: cfg.EMBEDDING_MODEL,
        input: texts,
      });

      if (!data.data || data.data.length !== texts.length) {
        throw new Error(`Expected ${texts.length} embeddings, received ${data.data?.length ?? 0}`);
      }
      return [...data.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    },
  };
}
