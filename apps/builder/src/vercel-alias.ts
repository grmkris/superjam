// Resolve a Vercel project's REAL public production alias. The build agent reports
// a GUESSED `https://<project>.vercel.app`, but Vercel TRUNCATES long auto-aliases
// (a 39-char project → a ~35-char alias), so the guess 404s. We look up the actual
// alias post-deploy so the recorded entryUrl is the one that serves.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Vercel CLI session token (when VERCEL_TOKEN isn't set, the box's logged-in CLI). */
const cliToken = (): string | undefined => {
  try {
    const p = join(homedir(), ".local/share/com.vercel.cli/auth.json");
    return JSON.parse(readFileSync(p, "utf8")).token as string;
  } catch {
    return undefined;
  }
};

/** The clean PUBLIC production alias (no `-projects.` scope suffix), shortest first. */
export const resolveVercelProdAlias = async (
  project: string,
  token: string
): Promise<string | null> => {
  const res = await fetch(`https://api.vercel.com/v9/projects/${project}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const d = (await res.json()) as {
    targets?: { production?: { alias?: string[]; url?: string } };
  };
  const prod = d.targets?.production;
  const aliases = (prod?.alias ?? []).filter(
    (a) => a.endsWith(".vercel.app") && !a.includes("-projects.")
  );
  aliases.sort((a, b) => a.length - b.length);
  return aliases[0] ?? prod?.url ?? null;
};

/**
 * An entryUrl resolver for the build runner: given the agent-reported project +
 * its guessed URL, return the REAL `https://<alias>` — or the fallback on any
 * failure (no token, API error, no alias yet). NEVER throws; a build is never
 * blocked on alias resolution.
 */
export const makeVercelEntryUrlResolver =
  (envToken?: string) =>
  async (vercelProject: string, fallback: string): Promise<string> => {
    const token = envToken ?? cliToken();
    if (!token || !vercelProject) return fallback;
    try {
      const alias = await resolveVercelProdAlias(vercelProject, token);
      return alias ? `https://${alias}` : fallback;
    } catch {
      return fallback;
    }
  };
