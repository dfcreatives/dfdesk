import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");
const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => new URL(value).searchParams.get("schema") === "desk", {
      message: "DATABASE_URL must include ?schema=desk (or &schema=desk).",
    }),
  FRONTEND_ORIGINS: z.string().default("http://localhost:3000"),
  COOKIE_NAME: z.string().min(1).default("desk_session"),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: booleanFromString.optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(14),
  DF_INTEGRATION_SECRET: z.string().min(32),
  FRAMES41_API_URL: z.string().url().optional(),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type Environment = z.infer<typeof environmentSchema> & {
  frontendOrigins: string[];
};
let cached: Environment | undefined;

export function env(): Environment {
  if (cached) return cached;
  const parsed = environmentSchema.parse(process.env);
  const frontendOrigins = parsed.FRONTEND_ORIGINS.split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (!frontendOrigins.length)
    throw new Error("FRONTEND_ORIGINS must contain at least one origin.");
  cached = { ...parsed, frontendOrigins };
  return cached;
}
