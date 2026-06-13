// Thin pino wrapper (sonara shape). One factory → a pino logger; pretty in dev,
// single-line JSON in prod. `child({...})` keeps working unchanged.
import { pino, type Logger as PinoLogger } from "pino";

export type LogLevel =
  | "fatal"
  | "error"
  | "warn"
  | "info"
  | "debug"
  | "trace"
  | "silent";

export type Logger = PinoLogger;

export interface CreateLoggerConfig {
  /** Identifying tag attached to every event (pino's `name`). */
  name?: string;
  /** Minimum severity. */
  level?: LogLevel;
  /** Pretty (human) output vs single-line JSON. */
  pretty?: boolean;
  /** Extra fields merged into every event. */
  base?: Record<string, unknown>;
}

export const createLogger = (config: CreateLoggerConfig = {}): Logger => {
  const { name, level = "info", pretty = false, base } = config;
  return pino({
    name,
    level,
    base: base ?? undefined,
    ...(pretty
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:HH:MM:ss.l" },
          },
        }
      : {}),
  });
};
