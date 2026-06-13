// The AI oracle seam for pot resolution (§9/§11). A pot with no
// creator-supplied outcome is swept by the platform: the oracle reads live data
// (Gemini search-grounding) and picks the winning option. Defined as an
// interface so the Gemini impl lives in the composition root (apps/server, with
// @ai-sdk/google) and tests inject a deterministic stub — onchain/api stay
// model-free.
export interface PotOracleResult {
  /** Must be one of the pot's options. */
  option: string;
  /** Optional one-line rationale (shown in the pot event log). */
  rationale?: string;
}

export interface PotOracle {
  resolve(input: {
    question: string;
    options: string[];
  }): Promise<PotOracleResult>;
}

/** No oracle configured ⇒ AI-resolve is unavailable; creators must pass an
 *  explicit outcome. Keeps boot/tests green without a model key. */
export const nullOracle: PotOracle = {
  resolve() {
    return Promise.reject(new Error("AI oracle not configured"));
  },
};
