import { describe, expect, test } from "bun:test";
import {
  decideDelivery,
  DEFAULT_AI_PASS_THRESHOLD,
  type DeployGateInput,
  nullAiJudge,
  probeReachability,
  resolveChallenge,
  runDeployGate,
  scoreToVerdict,
} from "./judge.ts";

const PASSING: DeployGateInput = {
  entryUrlLoads: true,
  framesOk: true,
  sdkHandshake: true,
  identityTokenVerifies: true,
  acceptanceAutoPass: true,
  entryOriginUnchanged: true,
};

describe("runDeployGate", () => {
  test("a clean delivery passes with no failures", () => {
    const r = runDeployGate(PASSING);
    expect(r.passed).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.delistEligible).toBe(false);
  });

  test("collects every failed check", () => {
    const r = runDeployGate({
      ...PASSING,
      entryUrlLoads: false,
      sdkHandshake: false,
    });
    expect(r.passed).toBe(false);
    expect(r.failures).toEqual(["entry_url_unreachable", "sdk_handshake_failed"]);
  });

  test("a phishing repoint is delist-eligible", () => {
    const r = runDeployGate({ ...PASSING, entryOriginUnchanged: false });
    expect(r.failures).toContain("phishing_repoint");
    expect(r.delistEligible).toBe(true);
  });
});

describe("decideDelivery", () => {
  test("a failed gate slashes immediately with the failure reasons", () => {
    const gate = runDeployGate({ ...PASSING, acceptanceAutoPass: false });
    const out = decideDelivery(gate);
    expect(out.action).toBe("slash");
    if (out.action === "slash") {
      expect(out.reason).toContain("acceptance_failed");
      expect(out.delist).toBe(false);
    }
  });

  test("a phishing repoint slashes AND delists", () => {
    const gate = runDeployGate({ ...PASSING, entryOriginUnchanged: false });
    const out = decideDelivery(gate);
    expect(out).toEqual({ action: "slash", reason: "phishing_repoint", delist: true });
  });

  test("gate passes but AI fails ⇒ slash for quality (no delist)", () => {
    const gate = runDeployGate(PASSING);
    const out = decideDelivery(gate, scoreToVerdict(0.3));
    expect(out.action).toBe("slash");
    if (out.action === "slash") {
      expect(out.reason).toContain("ai_acceptance_failed");
      expect(out.delist).toBe(false);
    }
  });

  test("gate + AI pass ⇒ open the challenge window", () => {
    const gate = runDeployGate(PASSING);
    expect(decideDelivery(gate, scoreToVerdict(0.9))).toEqual({ action: "open_challenge" });
    // and with no AI score, the gate alone governs.
    expect(decideDelivery(gate)).toEqual({ action: "open_challenge" });
  });
});

describe("scoreToVerdict / thresholds", () => {
  test("passes at/above the threshold, fails below", () => {
    expect(scoreToVerdict(DEFAULT_AI_PASS_THRESHOLD).pass).toBe(true);
    expect(scoreToVerdict(DEFAULT_AI_PASS_THRESHOLD - 0.01).pass).toBe(false);
  });

  test("nullAiJudge always passes", async () => {
    const s = await nullAiJudge.score({ acceptance: ["x"], entryUrl: "https://e.x" });
    expect(s.pass).toBe(true);
  });
});

describe("resolveChallenge", () => {
  test("upheld ⇒ slash; frivolous ⇒ release (re-open to finalize)", () => {
    expect(resolveChallenge(true)).toEqual({
      action: "slash",
      reason: "challenge_upheld",
      delist: false,
    });
    expect(resolveChallenge(true, { delist: true }).action).toBe("slash");
    expect(resolveChallenge(false)).toEqual({ action: "open_challenge" });
  });
});

const html = (headers: Record<string, string> = {}) =>
  new Response("<!doctype html><title>jam</title>", {
    status: 200,
    headers: { "content-type": "text/html", ...headers },
  });

describe("probeReachability", () => {
  test("a reachable, frameable, same-origin deploy passes all three checks", async () => {
    const fetchImpl = (async () => html()) as unknown as typeof fetch;
    const r = await probeReachability(
      "https://my-jam.vercel.app/",
      "https://my-jam.vercel.app",
      fetchImpl
    );
    expect(r).toEqual({ entryUrlLoads: true, framesOk: true, entryOriginUnchanged: true });
  });

  test("X-Frame-Options DENY trips framesOk", async () => {
    const fetchImpl = (async () => html({ "x-frame-options": "DENY" })) as unknown as typeof fetch;
    const r = await probeReachability("https://a.x/", "https://a.x", fetchImpl);
    expect(r.framesOk).toBe(false);
  });

  test("a repoint to a different origin is detected", async () => {
    const fetchImpl = (async () => html()) as unknown as typeof fetch;
    const r = await probeReachability("https://evil.x/", "https://my-jam.vercel.app", fetchImpl);
    expect(r.entryOriginUnchanged).toBe(false);
  });

  test("a network error / non-HTML fails reachability gracefully", async () => {
    const boom = (async () => {
      throw new Error("dns");
    }) as unknown as typeof fetch;
    const r = await probeReachability("https://down.x/", "https://down.x", boom);
    expect(r).toEqual({ entryUrlLoads: false, framesOk: false, entryOriginUnchanged: true });
  });
});
