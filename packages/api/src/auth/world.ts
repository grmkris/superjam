// World ID backend-verification seam (§14, M8). IDKit v4 produces a proof in
// the browser; the HARD track requirement is that OUR backend forwards that
// proof AS-IS to World's verify endpoint — the client is never trusted to
// assert personhood. This is the only file that talks to developer.world.org;
// the rest of the API sees the `WorldVerifier` interface (mirrors verifier.ts /
// app-token.ts: an injectable seam with a keyless null default + a live impl,
// stubbed in tests at this seam, never module-mocked).

/**
 * The proof fields IDKit's `onSuccess` hands back (ISuccessResult). Forwarded
 * verbatim to World; the server only ADDS `action` (+ optional signal) so a
 * client can't verify against a different action than the one we gate on.
 */
export interface WorldProof {
  merkle_root: string;
  nullifier_hash: string;
  proof: string;
  /** "orb" | "device" — World's verification level; we accept either (§14). */
  verification_level: string;
}

export interface WorldVerifyOk {
  ok: true;
  /** One human = one nullifier per (app, action). The sybil anchor. */
  nullifierHash: string;
  verificationLevel: string;
}
export interface WorldVerifyFail {
  ok: false;
  code: string;
  detail: string;
}
export type WorldVerifyResult = WorldVerifyOk | WorldVerifyFail;

export interface WorldVerifier {
  /** The World app id (rp_id) — handed to the IDKit widget via `world.rpContext`. */
  appId(): string;
  /** The action the widget + backend verify against (one per gated surface). */
  action(): string;
  /** Forward an IDKit proof to `POST /api/v4/verify/{rp_id}`, as-is. */
  verifyProof(input: {
    proof: WorldProof;
    signal?: string;
  }): Promise<WorldVerifyResult>;
}

export class WorldNotConfiguredError extends Error {
  constructor() {
    super("World ID verification is not configured (WORLD_APP_ID unset).");
    this.name = "WorldNotConfiguredError";
  }
}

/**
 * The keyless verifier — `verifyProof` rejects, identifiers are empty. The
 * default so a World-less environment still boots/typechecks (same "optional in
 * schema, assert at use" doctrine as the Dynamic + app-token blocks).
 */
export const nullWorldVerifier: WorldVerifier = {
  appId: () => "",
  action: () => "",
  verifyProof() {
    return Promise.reject(new WorldNotConfiguredError());
  },
};

export interface WorldVerifierOpts {
  /** `WORLD_APP_ID`. Absent ⇒ degrades to the keyless null verifier. */
  appId?: string;
  /** `WORLD_ACTION` — the gated action (default "publish-app", §1). */
  action?: string;
  /** Override World's API origin (default https://developer.world.org). */
  apiBase?: string;
  /** Injected in tests so the verify endpoint is stubbed at the seam. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_API_BASE = "https://developer.world.org";
const DEFAULT_ACTION = "publish-app";

/**
 * Live verifier against World's v4 backend. Dev runs against the "staging"
 * World app + simulator.worldcoin.org widget; the verify URL is the same shape.
 */
export const createWorldVerifier = (opts: WorldVerifierOpts): WorldVerifier => {
  if (!opts.appId) {
    return nullWorldVerifier;
  }
  const appId = opts.appId;
  const action = opts.action ?? DEFAULT_ACTION;
  const apiBase = opts.apiBase ?? DEFAULT_API_BASE;
  const doFetch = opts.fetchImpl ?? fetch;

  return {
    appId: () => appId,
    action: () => action,
    async verifyProof({ proof, signal }) {
      const res = await doFetch(`${apiBase}/api/v4/verify/${appId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // AS-IS: spread the whole proof (forwards any extra IDKit fields too);
        // only `action` (+ optional signal) is added server-side.
        body: JSON.stringify({
          ...proof,
          action,
          ...(signal === undefined ? {} : { signal }),
        }),
      });
      let body: Record<string, unknown> = {};
      try {
        body = (await res.json()) as Record<string, unknown>;
      } catch {
        // non-JSON / empty error body — fall through to the !res.ok branch.
      }
      if (!res.ok || body.success === false) {
        return {
          ok: false,
          code: typeof body.code === "string" ? body.code : `http_${res.status}`,
          detail:
            typeof body.detail === "string"
              ? body.detail
              : "World verification failed",
        };
      }
      return {
        ok: true,
        nullifierHash: proof.nullifier_hash,
        verificationLevel: proof.verification_level,
      };
    },
  };
};
