// The layered optimistic judge (PIVOT P3, §7). Cheap happy path, economic
// backstop for the tail — Kleros-style. Four layers, each cheaper than the next
// is expensive:
//
//   (a) automated deploy gate  — deterministic checks on every delivery; a
//       failure is immediately slash-eligible (the build didn't deliver).
//   (b) AI judge               — scores the delivered app against the spec's
//       `acceptance` list when the gate passes (catches "loads but wrong").
//   (c) challenge window        — gate+AI pass ⇒ open a window: the owner or a
//       community member can stake-to-challenge (bond in StakeSlash).
//   (d) resolution             — upheld dispute ⇒ slash (+ maybe delist); a
//       frivolous challenge ⇒ release + forfeit the challenger's bond.
//
// This module is PURE decision logic + injectable seams (the AI judge, the HTTP
// probe). It maps a delivery's evidence to a StakeSlash action; the bindings
// (stake-slash.ts) execute it. Tests need no chain and no live LLM.

/** Deterministic deploy-gate evidence. The platform computes these (runtime
 *  probe + the reachability helper below); the judge only rules on them. */
export interface DeployGateInput {
  /** entryUrl returns 2xx HTML. */
  entryUrlLoads: boolean;
  /** Loads inside the sandboxed iframe (no X-Frame-Options / frame-ancestors block). */
  framesOk: boolean;
  /** The SDK `host.hello` handshake completes. */
  sdkHandshake: boolean;
  /** The app verifies our identity token against the published JWKS. */
  identityTokenVerifies: boolean;
  /** The automatable subset of the spec's acceptance items passes. */
  acceptanceAutoPass: boolean;
  /** entryOrigin is unchanged since registration (no phishing repoint, §6). */
  entryOriginUnchanged: boolean;
}

export interface DeployGateResult {
  passed: boolean;
  failures: string[];
  /** A repoint is fraud, not a flaky deploy — slash AND delist. */
  delistEligible: boolean;
}

/** Layer (a): rule on the deterministic checks. */
export const runDeployGate = (i: DeployGateInput): DeployGateResult => {
  const failures: string[] = [];
  if (!i.entryUrlLoads) failures.push("entry_url_unreachable");
  if (!i.framesOk) failures.push("frame_blocked");
  if (!i.sdkHandshake) failures.push("sdk_handshake_failed");
  if (!i.identityTokenVerifies) failures.push("identity_token_invalid");
  if (!i.acceptanceAutoPass) failures.push("acceptance_failed");
  if (!i.entryOriginUnchanged) failures.push("phishing_repoint");
  return {
    passed: failures.length === 0,
    failures,
    delistEligible: !i.entryOriginUnchanged,
  };
};

export interface AiScore {
  /** 0..1 — how well the delivered app satisfies the acceptance list. */
  score: number;
  pass: boolean;
  reasons: string[];
}

/** Layer (b) seam: an LLM scores the delivered app against the spec. C/S wire a
 *  Gemini-backed impl; the judge only consumes the score. */
export interface AiAcceptanceJudge {
  score(input: {
    acceptance: readonly string[];
    entryUrl: string;
  }): Promise<AiScore>;
}

export const DEFAULT_AI_PASS_THRESHOLD = 0.6;

/** Build an AiScore verdict from a raw score against a threshold. */
export const scoreToVerdict = (
  score: number,
  reasons: string[] = [],
  threshold = DEFAULT_AI_PASS_THRESHOLD
): AiScore => ({ score, pass: score >= threshold, reasons });

/** The judge's instruction to the StakeSlash contract for a delivery. */
export type JudgeOutcome =
  | { action: "slash"; reason: string; delist: boolean }
  /** Gate + AI passed — open the challenge window; finalize if it closes clean. */
  | { action: "open_challenge" };

/**
 * Layers (a)+(b): decide a fresh delivery. A failed gate slashes immediately
 * (deterministic); otherwise a failing AI score slashes for quality; otherwise
 * the build is provisionally good and enters the challenge window.
 */
export const decideDelivery = (
  gate: DeployGateResult,
  ai?: AiScore
): JudgeOutcome => {
  if (!gate.passed) {
    return {
      action: "slash",
      reason: gate.failures.join(","),
      delist: gate.delistEligible,
    };
  }
  if (ai && !ai.pass) {
    return {
      action: "slash",
      reason: `ai_acceptance_failed(${ai.score.toFixed(2)})`,
      delist: false,
    };
  }
  return { action: "open_challenge" };
};

/**
 * Layer (d): resolve a community/owner challenge. `upheld` = the challenge was
 * correct (the build is bad) ⇒ slash + reward the challenger. A frivolous
 * challenge ⇒ release the builder; the contract forfeits the challenger's bond.
 */
export const resolveChallenge = (
  upheld: boolean,
  opts: { delist?: boolean } = {}
): JudgeOutcome =>
  upheld
    ? { action: "slash", reason: "challenge_upheld", delist: opts.delist ?? false }
    : { action: "open_challenge" };

/** No-op AI judge — always passes (the gate still governs). Default seam value
 *  so a delivery is judged on the deterministic gate alone when no LLM is wired. */
export const nullAiJudge: AiAcceptanceJudge = {
  score: () => Promise.resolve(scoreToVerdict(1, ["ai judge not configured"])),
};

// --- the deterministic reachability probe (layer (a), HTTP-only subset) ---

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/** Headers that forbid framing — a delivery that sets these can't load in the host. */
const blocksFraming = (headers: Headers): boolean => {
  const xfo = headers.get("x-frame-options");
  if (xfo && /deny|sameorigin/i.test(xfo)) return true;
  const csp = headers.get("content-security-policy");
  // a frame-ancestors that names neither * nor the host blocks us (heuristic).
  return !!csp && /frame-ancestors\s+'none'/i.test(csp);
};

/**
 * Probe the HTTP-observable slice of the deploy gate: reachability, framing,
 * and the phishing-repoint check. The runtime (browser) supplies the rest
 * (sdkHandshake / identityTokenVerifies / acceptanceAutoPass). fetch is injected
 * so tests stub it at the seam.
 */
export const probeReachability = async (
  entryUrl: string,
  registeredOrigin: string,
  fetchImpl: typeof fetch = fetch
): Promise<Pick<DeployGateInput, "entryUrlLoads" | "framesOk" | "entryOriginUnchanged">> => {
  const entryOriginUnchanged = originOf(entryUrl) === registeredOrigin;
  try {
    const res = await fetchImpl(entryUrl, { method: "GET", redirect: "follow" });
    const ct = res.headers.get("content-type") ?? "";
    return {
      entryUrlLoads: res.ok && ct.includes("html"),
      framesOk: !blocksFraming(res.headers),
      entryOriginUnchanged,
    };
  } catch {
    return { entryUrlLoads: false, framesOk: false, entryOriginUnchanged };
  }
};
