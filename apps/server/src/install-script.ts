// The `curl …/install.sh?token=… | bash` one-liner body (§MCP onboarding). The
// server serves this from `GET /install.sh` with the user's `sjat_…` PAT + the
// public MCP URL interpolated. The script (1) registers the SuperJam MCP at USER
// scope via the Claude CLI and (2) drops a usage skill at
// ~/.claude/skills/superjam/SKILL.md so the agent knows when + how to build apps.
//
// SECURITY: `token` is interpolated into the emitted bash, so the route MUST
// validate it first (PAT_RE + resolveUserFromPat). PAT_RE pins the exact shape a
// generatePat() token has, which leaves no shell-injectable characters.

/** A `sjat_` followed by 64 lowercase hex chars — exactly what `generatePat()` mints. */
export const PAT_RE = /^sjat_[0-9a-f]{64}$/;

/** Render the installer bash for a validated PAT + the public MCP endpoint URL. */
export const renderInstallScript = (token: string, mcpUrl: string): string => `#!/usr/bin/env bash
# SuperJam — connect your Claude Code to hire builder agents (pays via your wallet).
set -euo pipefail

TOKEN="${token}"
MCP_URL="${mcpUrl}"

echo "→ Connecting your Claude Code to SuperJam…"

# 1) Register the SuperJam MCP at USER scope (available in every project).
if command -v claude >/dev/null 2>&1; then
  claude mcp remove --scope user superjam >/dev/null 2>&1 || true
  claude mcp add-json --scope user superjam \\
    "{\\"type\\":\\"http\\",\\"url\\":\\"$MCP_URL\\",\\"headers\\":{\\"Authorization\\":\\"Bearer $TOKEN\\"}}"
else
  echo "  ! Claude CLI not found. Install it, then run:"
  echo "    claude mcp add-json --scope user superjam '{\\"type\\":\\"http\\",\\"url\\":\\"$MCP_URL\\",\\"headers\\":{\\"Authorization\\":\\"Bearer $TOKEN\\"}}'"
fi

# 2) Install the usage skill.
SKILL_DIR="$HOME/.claude/skills/superjam"
mkdir -p "$SKILL_DIR"
cat > "$SKILL_DIR/SKILL.md" <<'SKILL'
---
name: superjam
description: Build and deploy mini-apps or games with SuperJam. Use whenever the user asks to build, make, prototype, or deploy an app or game.
---
# SuperJam — build apps

You can build + deploy a real, live app on SuperJam. You act AS the user; builds are
free and run on the user's own SuperJam account (no key needed).

Use the \`superjam\` MCP tools, in order:
1. \`build_app({ prompt })\` — build it. \`prompt\` describes what to build
   (e.g. "a snake game"). Returns \`{ buildId }\`. If it instead returns
   \`{ status: "needs_answers", questions }\`, ask the user those questions, then
   re-call \`build_app\` with the same args plus \`answers: [{ q, a }, …]\`.
2. \`get_build({ buildId })\` — poll until \`status: "done"\`; then share the deployed
   app URL with the user. \`status: "failed"\` means the build errored — report it.

Optional: \`upload_file({ fileName, mimeType, dataBase64 })\` attaches a reference
image/PDF/CSV; pass the returned \`key\` in \`build_app({ …, attachmentKeys: [key] })\`.
SKILL

echo ""
echo "✅ SuperJam connected."
echo "   Restart Claude Code, then try:  \\"build me a snake game with SuperJam\\""
`;
