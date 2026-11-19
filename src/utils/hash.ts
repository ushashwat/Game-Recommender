/** Hashing, seeded random generator, and canonical game ID helpers. */
import { createHash } from "node:crypto";

/** Deterministic SHA-256 hex digest (truncated to 16 chars) for cache keys and index versions. */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/** Deterministic PRNG (Mulberry32) so dataset degradation is 100% repeatable. */
export function createPrng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EDITION_QUALIFIERS_RE =
  /\b(deluxe|remastered|edition|hd|ultimate|premium|classic|original|vip|plus|special|platinum)\b/g;

/** Canonical identifier shared by re-listed duplicates/editions of the same game. */
export function makeCanonicalId(title: string, provider: string | null | undefined): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(EDITION_QUALIFIERS_RE, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const p = provider?.trim();
  return `${slug(title)}|${p ? slug(p) : "unknown"}`;
}
