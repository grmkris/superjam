// World ID 4.0 backend seam (§14, M8). The browser runs IDKit v4 against a
// MANAGED relying party; two things happen server-side here (the only file that
// talks to developer.world.org): (1) we SIGN a short-lived rp_context with the
// RP key (managed = World manages the on-chain RP registration, NOT key custody)
// — the widget can't open without it; (2) we forward the resulting proof to
// World's verify endpoint AS-IS — the client is never trusted to assert
// personhood. Mirrors verifier.ts / app-token.ts: an injectable seam with a
// keyless null default, stubbed in tests at this seam (never module-mocked).
import { signRequest } from "@worldcoin/idkit-server";

/** A single v4 credential response (IDKit `ResponseItemV4`). The RP-scoped
 *  `nullifier` is the sybil anchor; `proof` is the compressed Groth16 + root. */
export interface WorldResponseItem {
  identifier: string;
  signal_hash?: string;
  proof: string[];
  nullifier: string;
  issuer_schema_id: number;
  expires_at_min: number;
}

/** The whole IDKit v4 result the widget hands back; forwarded to verify as-is. */
export interface WorldProofV4 {
  protocol_version: string;
  nonce: string;
  action: string;
  environment: string;
  responses: WorldResponseItem[];
}

/** The backend-signed context the widget needs to open (rp_context + the public
 *  bits the IDKit config wants: app_id, action, environment, legacy toggle). */
export interface WorldRpContext {
  appId: string;
  action: string;
  environment: "staging" | "production";
  allowLegacyProofs: boolean;
  rpContext: {
    rp_id: string;
    nonce: string;
    created_at: number;
    expires_at: number;
    signature: string;
  };
}

export interface WorldVerifyOk {
  ok: true;
  /** One human = one RP-scoped nullifier. The sybil anchor. */
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
  /** The Dev-Portal app id (app_…) — handed to the IDKit widget. */
  appId(): string;
  /** The action the widget + backend verify against (one per gated surface). */
  action(): string;
  /** Freshly sign an rp_context (new nonce each call) for the widget to open. */
  rpContext(): WorldRpContext;
  /** Forward a v4 IDKit result to `POST /api/v4/verify/{rp_id}`, as-is. */
  verifyProof(input: { result: WorldProofV4 }): Promise<WorldVerifyResult>;
}

export class WorldNotConfiguredError extends Error {
  constructor() {
    super(
      "World ID is not configured (need WORLD_APP_ID + WORLD_RP_ID + WORLD_RP_SIGNING_KEY)."
    );
    this.name = "WorldNotConfiguredError";
  }
}

/**
 * The keyless verifier — `rpContext`/`verifyProof` reject, identifiers empty.
 * The default so a World-less environment still boots/typechecks (same "optional
 * in schema, assert at use" doctrine as the Dynamic + app-token blocks).
 */
export const nullWorldVerifier: WorldVerifier = {
  appId: () => "",
  action: () => "",
  rpContext() {
    throw new WorldNotConfiguredError();
  },
  verifyProof() {
    return Promise.reject(new WorldNotConfiguredError());
  },
};

export interface WorldVerifierOpts {
  /** `WORLD_APP_ID` (app_…). Absent ⇒ degrades to the keyless null verifier. */
  appId?: string;
  /** `WORLD_RP_ID` (rp_…) — proof-context/verify endpoints + rp_context.rp_id. */
  rpId?: string;
  /** `WORLD_RP_SIGNING_KEY` — the RP ECDSA key that signs rp_context. */
  signingKeyHex?: string;
  /** `WORLD_ACTION` — the gated action (default "publish-app", §1). */
  action?: string;
  /** `WORLD_ENVIRONMENT` — "staging" (simulator) for dev, "production" live. */
  environment?: "staging" | "production";
  /** Override World's API origin (default https://developer.world.org). */
  apiBase?: string;
  /** Injected in tests so the verify endpoint is stubbed at the seam. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_API_BASE = "https://developer.world.org";
const DEFAULT_ACTION = "publish-app";

/**
 * Live verifier against World's v4 managed-RP backend. The verify URL is keyed
 * by rp_id; the widget is keyed by app_id. Dev runs `environment: "staging"`
 * against the World ID Simulator (no real Orb), production for the live demo.
 */
export const createWorldVerifier = (opts: WorldVerifierOpts): WorldVerifier => {
  // v4 needs all three: an app to display, an RP to verify under, a key to sign.
  if (!opts.appId || !opts.rpId || !opts.signingKeyHex) {
    return nullWorldVerifier;
  }
  const appId = opts.appId;
  const rpId = opts.rpId;
  // @noble (under signRequest) wants bare hex; tolerate a 0x-prefixed env value.
  const signingKeyHex = opts.signingKeyHex.replace(/^0x/, "");
  const action = opts.action ?? DEFAULT_ACTION;
  const environment = opts.environment ?? "production";
  const apiBase = opts.apiBase ?? DEFAULT_API_BASE;
  const doFetch = opts.fetchImpl ?? fetch;

  return {
    appId: () => appId,
    action: () => action,
    rpContext() {
      const sig = signRequest({ signingKeyHex, action });
      return {
        appId,
        action,
        environment,
        // v4-only: verifyProof + the oRPC schema speak the v4 result shape
        // (responses[].proof is string[]). Accepting legacy v3 would need a
        // second result shape end-to-end — out of scope until a v3 user needs it.
        allowLegacyProofs: false,
        rpContext: {
          rp_id: rpId,
          nonce: sig.nonce,
          created_at: sig.createdAt,
          expires_at: sig.expiresAt,
          signature: sig.sig,
        },
      };
    },
    async verifyProof({ result }) {
      const res = await doFetch(`${apiBase}/api/v4/verify/${rpId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Forward the whole IDKit v4 result verbatim (protocol_version, nonce,
        // action, environment, responses[]) — World re-checks the proof crypto.
        body: JSON.stringify(result),
      });
      let body: Record<string, unknown> = {};
      try {
        body = (await res.json()) as Record<string, unknown>;
      } catch {
        // non-JSON / empty error body — fall through to the failure branch.
      }
      if (!res.ok || body.success !== true) {
        return {
          ok: false,
          code: typeof body.code === "string" ? body.code : `http_${res.status}`,
          detail:
            typeof body.detail === "string"
              ? body.detail
              : "World verification failed",
        };
      }
      // The nullifier rides in the (now World-verified) proof response, not the
      // verify reply — the proof cryptographically commits to it, so it's safe.
      const first = result.responses?.[0];
      if (!first?.nullifier) {
        return {
          ok: false,
          code: "no_nullifier",
          detail: "verified but no nullifier in responses",
        };
      }
      return {
        ok: true,
        nullifierHash: first.nullifier,
        verificationLevel: first.identifier,
      };
    },
  };
};
