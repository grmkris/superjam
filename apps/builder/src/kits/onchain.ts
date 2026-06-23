// onchain — the use-case kit for onchain games (skill "onchain"). Instead of the
// agent hand-writing Solidity (the #1 onchain build failure), the kit seeds a
// VETTED, parameterized contract template (contracts/src/Game.sol) filled from the
// spec + a near-complete Toybox app/page.tsx that drives it via sdk.onchain. The
// agent extends the PAGE only; it never authors the contract. The harness still
// `forge build`s + deploys the (known-good) template to Arc, and the bridge wires
// sdk.onchain.read/write to the deployed address (gasless, player-stamped).
import type { AppSpec } from "@superjam/shared";
import { selectOnchainTemplate } from "../contracts/templates.ts";
import type { GateResult, Kit, KitContext } from "./types.ts";

const match = (spec: AppSpec): boolean => spec.skills?.includes("onchain") ?? false;

const questions: Kit["questions"] = [
  {
    q: "What kind of onchain game is it?",
    options: [
      "A chance game (flip / dice / wheel — guess and win)",
      "A turn-based duel (tic-tac-toe / connect)",
      "A mint — claim an onchain collectible / badge",
    ],
  },
  {
    q: "What lives on-chain?",
    options: ["The result + a win counter", "The full game state (a shared board)", "An owned token / NFT"],
  },
];

const plan = (spec: AppSpec): string => {
  const t = selectOnchainTemplate(spec);
  return `# Build plan — ${spec.iconEmoji} ${spec.name} (onchain — ${t.title})

A VETTED contract is ALREADY seeded + filled at contracts/src/Game.sol (template:
${t.id}) and a working starter app/page.tsx is in place. DO NOT rewrite the Solidity
— the harness compiles + deploys it to Arc and wires sdk.onchain to its address.

1. Connect on mount: \`const sdk = await SuperJam.connect()\`, then
   \`sdk.app.context()\`. Gate the onchain actions on \`!sdk.standalone\` (show an
   "open inside SuperJam" state otherwise) — the starter already does this.
2. Play GASLESSLY via the SDK — the platform stamps the player + pays gas:
   - write a move: \`await sdk.onchain.write({ fn, args })\` (NEVER pass the player
     address — it's auto-stamped as arg 0; pass only the trailing args).
   - read state: \`await sdk.onchain.read({ fn, args })\` (big ints come back as
     DECIMAL STRINGS — wrap in \`Number(x)\` / \`BigInt(x)\`). Wrap reads/writes in
     try/catch and show a pending state on write.
3. Make it FEEL good: the starter is functional but plain. Add the juice — a roll/
   flip animation, a \`tj-pop\` on a win, the board polish, the minted-badge art —
   using the Toybox classes (.tj-card/.tj-btn/.tj-choice/.tj-stat/.tj-bar). Keep the
   cream theme; never a dark page.
4. Wire the spec's specifics:
${spec.features.length ? spec.features.map((f) => `   - ${f}`).join("\n") : "   - (keep it a tight, instantly-playable onchain loop)"}
5. Acceptance: a move calls sdk.onchain.write and the result shows; the on-chain
   state survives a reload (read it back); the agent wrote ZERO Solidity.`;
};

// Seed the FILLED contract template + its starter page. These overlay the generic
// skeleton (generate.ts already seeds foundry.toml + deploy.sh + .vercelignore).
const starterFiles = (spec: AppSpec, _ctx: KitContext): Record<string, string> => {
  const t = selectOnchainTemplate(spec);
  return {
    "contracts/src/Game.sol": t.contract(spec),
    "app/page.tsx": t.page(spec),
  };
};

// Kit gate — runs ALONGSIDE the generic gate (not-stub + sdk import + interactivity
// + on-theme). Here: the page must actually DRIVE the contract via sdk.onchain, and
// must NOT have rewritten the Solidity into something the bridge can't relay.
const gate = (files: Record<string, string>): GateResult => {
  const page = files["app/page.tsx"] ?? "";
  const missing: string[] = [];
  // The essential onchain action is the WRITE (the move actually happens on-chain,
  // gasless + player-stamped). Reading state back is encouraged (the starter + prompt
  // do it) but NOT gated — requiring it just traps cheap models that drop the read
  // when they rewrite the page, which defeats the whole point of templating (reliability).
  if (!/\.onchain\.write\(/.test(page)) {
    missing.push("make the move on-chain with sdk.onchain.write({ fn, args }) (gasless, player auto-stamped) — don't fake it with local state");
  }
  return { ok: missing.length === 0, missing };
};

export const onchainKit: Kit = {
  id: "onchain",
  title: "Onchain game",
  skills: ["onchain"],
  match,
  questions,
  plan,
  starterFiles,
  gate,
};
