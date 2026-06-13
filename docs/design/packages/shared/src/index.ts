import { z } from "zod";

export const ENVIRONMENTS = ["local", "dev", "prod"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export type ServiceUrls = { web: string; apiInternal: string };

export const SERVICE_URLS: Record<Environment, ServiceUrls> = {
  local: { web: "http://localhost:4700", apiInternal: "http://localhost:4701" },
  dev: {
    web: "https://dev.turbojam-poc.up.railway.app",
    apiInternal: "http://server.railway.internal:4701",
  },
  prod: {
    web: "https://turbojam-poc.up.railway.app",
    apiInternal: "http://server.railway.internal:4701",
  },
};

// The refined spec the builder agent receives.
export const AppSpecSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .regex(/^[a-z0-9-]{3,32}$/)
    .describe("kebab-case, 3-32 chars"),
  description: z.string(),
  iconEmoji: z.string(),
  features: z.array(z.string()).describe("concrete feature bullets the app must implement"),
});
export type AppSpec = z.infer<typeof AppSpecSchema>;

export const BuildStatus = z.enum([
  "queued",
  "generating",
  "bundling",
  "done",
  "failed",
]);
export type BuildStatus = z.infer<typeof BuildStatus>;

export type BuildRecord = {
  id: string;
  spec: AppSpec;
  status: BuildStatus;
  events: { t: number; kind: "tool" | "text" | "error" | "status"; label: string }[];
  error?: string;
  durationMs?: number;
};
