/** Isolated environment config loaders for the HTTP service (`SERVICE_API_KEY`) and offline pipeline (`LLM_*`). */
import { existsSync } from "node:fs";
import { z } from "zod";

const ServiceEnv = z.object({
  SERVICE_API_KEY: z.string().min(32, "must be at least 32 characters (e.g. openssl rand -hex 32)"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

const PipelineEnv = z.object({
  LLM_API_KEY: z.string().min(1, "is required for LLM calls"),
  LLM_BASE_URL: z.url().default("https://openrouter.ai/api/v1"),
  LLM_MODEL: z.string().min(1).default("openai/gpt-6-luna"),
  EMBEDDING_MODEL: z.string().min(1).default("openai/text-embedding-3-small"),
});

export type ServiceConfig = z.infer<typeof ServiceEnv>;
export type PipelineConfig = z.infer<typeof PipelineEnv>;

type Env = Record<string, string | undefined>;

/** Loads `.env` into process.env if present. Variables already set in the shell win. */
export function loadDotEnv(path = ".env"): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

function parse<T extends z.ZodType>(schema: T, env: Env): z.infer<T> {
  // Treat empty strings (e.g. `LLM_API_KEY=` copied from .env.example) as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ""));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    // Only variable names and rule messages; never input values.
    const problems = result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`);
    throw new ConfigError(`Invalid environment configuration: ${problems.join("; ")}`);
  }
  return result.data;
}

export function loadServiceConfig(env: Env = process.env): ServiceConfig {
  return parse(ServiceEnv, env);
}

export function loadPipelineConfig(env: Env = process.env): PipelineConfig {
  return parse(PipelineEnv, env);
}
