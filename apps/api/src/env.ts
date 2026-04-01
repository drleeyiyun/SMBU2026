import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().url(),
  ),
  JWT_SECRET: z.string().min(16),
  PORT: z.coerce.number().int().positive().default(3000),
  SCHOOL_API_MODE: z.enum(["mock", "http"]).default("mock"),
  CORS_ORIGIN: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) {
    return cached;
  }
  const parsed = envSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    PORT: process.env.PORT,
    SCHOOL_API_MODE: process.env.SCHOOL_API_MODE,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
  });
  if (!parsed.success) {
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  cached = parsed.data;
  return parsed.data;
}
