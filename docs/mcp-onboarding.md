# SuperJam MCP — onboarding + the World/AgentKit human-backed lane

How a user connects their **own Claude Code** to SuperJam so it can hire builder agents
(and pay) **as them**, plus the optional World-verified "human-backed agent" lane.

## Phase A — the one-line install

A user with a SuperJam account mints a **Personal Access Token** (PAT) and runs one command.

```
curl https://dev.superjam.fun/install.sh?token=sjat_<their-token> | bash
```

What the script does (served by `GET /install.sh`, `apps/server/src/install-script.ts`):

1. **Registers the SuperJam MCP** at USER scope via the Claude CLI:
   `claude mcp add-json --scope user superjam '{"type":"http","url":"https://dev.superjam.fun/mcp","headers":{"Authorization":"Bearer sjat_…"}}'`
2. **Installs the usage skill** at `~/.claude/skills/superjam/SKILL.md` so the agent knows
   when + how to use the tools.

The server validates the token (exact `sjat_` shape + a live, non-expired PAT) before
emitting anything, so the token is never interpolated into bash unless it's real.

### Minting a PAT
- **UI:** the "Connect agent" surface calls `auth.issueToken({ name })` (worldVerified-gated),
  shows the raw `sjat_…` ONCE, and renders the `curl … | bash` one-liner.
- **CLI (demo):** `DATABASE_URL=… bun run apps/server/scripts/mint-pat.ts <email> [name]`.

### MCP tools (run AS the user, via the PAT)
- `discover_builders` — list builders (id, name, capabilities, price, endpointUrl).
- `upload_file({ fileName, mimeType, dataBase64 })` — attach a reference file → `{ key, url }`.
- `build_app({ builderId, prompt, answers?, attachmentKeys? })` — hire + pay via the user's
  Dynamic-delegated wallet (Circle x402). Returns `{ buildId }` (or `needs_answers`).
- `get_build({ buildId })` — poll to the deployed app URL.
- `verify_human_agent({ builderId })` — the World/AgentKit lane (below).

## Phase B — the World-verified "human-backed agent" lane

Goal: prove the user's agent is backed by a **real human** so it can use a builder's
**AgentKit-protected** x402 endpoint (`POST /world`) — a registered human gets a FREE build.

### The pieces
1. **World-verify the user** — in the SuperJam app (World ID 4.0). Sets `worldVerified`.
2. **Register the delegated wallet in AgentBook** — see the out-of-band step below.
3. **The builder `/world` resource** — a SEPARATE x402 route from the Circle `/` (so the
   AgentKit extension never breaks plain payers). Enabled on a builder by setting
   `AGENT_FREE_TRIAL_USES` (alongside `AGENT_WALLET_ADDRESS` + `AGENT_PRICE_USDC`).
   See `apps/builder/src/server.ts` (`hireWorld`) + `createX402HireResource({ freeTrialUses,
   routePattern: "POST /world" })`.
4. **The MCP attests AS the human** — `verify_human_agent` builds an AgentKit client whose
   eip191 signer is the user's **delegated wallet** (the AgentBook-registered address),
   then calls the builder's `/world` endpoint (`hireViaAgentkit`,
   `@superjam/onchain/agentkit-client`). A 2xx with no settlement header ⇒ free trial granted.

### Out-of-band: register the delegated wallet in AgentBook
AgentBook (World Chain, `0xA23aB2712eA7BBa896930544C7d6636a96b944dA`) exposes only a
read-only `lookupHuman` — there is **no in-app registration path**. The user registers their
wallet once, out-of-band:

1. Find the delegated wallet address: it's the user's Dynamic embedded-wallet address
   (`userDelegation.address`, = the `wallet`/`unlinkAddress` shown by `verify_human_agent`).
2. Use the **`agentkit` CLI + the World App** to register that address as a human-backed
   agent in AgentBook (the standard Worldcoin AgentKit registration flow — proof of personhood
   via World ID, signed from the World App).
3. Once registered, `verify_human_agent({ builderId })` returns `granted: true` and the
   builder's `/world` endpoint grants the free build.

Until the wallet is registered, `/world` answers **402** (the attestation is signed + sent,
but the caller isn't recognized as a registered human) — that's the expected pre-registration
state, and proof the attestation round-trip works.

### Known limitation (scoped)
The AgentKit **paid** fallback is incompatible with the hand-rolled `x402HTTPResourceServer`
on paid calls (`extension_echo_mismatch`). So `/world` is **free-trial-only**; paid builds use
the working Circle `/` path (`build_app` → `payBuildFee`). This is why AgentKit lives on a
separate route from Circle.
