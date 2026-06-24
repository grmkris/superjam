// ai-roast — the "roast / rate my ___" viral kit. The player submits something
// (a fit, a setup, a take, a username) → the AI returns a witty score + one-liner →
// a shareable verdict card. Highly viral: AI-generated burns beg to be shared.
// Uses sdk.ai.chat (capability "ai") with the judge.md rules (artifacts not people,
// show the reason, clamp 0–10) + a LOCAL fallback so it works even when AI is slow,
// over quota, or the capability isn't granted. Seeds the shared result-card.
import type { AppSpec } from "@superjam/shared";
import { resultCardComponent } from "./_share.ts";
import type { GateResult, Kit, KitContext } from "./types.ts";

const RE = /roast|rate my|rate your|judge|score my|how (?:good|bad|cool) (?:is|am)|review my|grade my|critique/i;
const match = (spec: AppSpec): boolean =>
  RE.test(`${spec.name} ${spec.description} ${spec.features.join(" ")}`);

const questions: Kit["questions"] = [
  { q: "What do people submit?", options: ["Type some text", "Upload a photo", "Either text or a photo"] },
  { q: "How harsh is the AI?", options: ["Playful + wholesome", "Brutal but fair", "Hype-man (mostly nice)"] },
  { q: "Show a number score?", options: ["Yes — score out of 10", "No — just the verdict"] },
];

const plan = (spec: AppSpec): string => `# Build plan — ${spec.iconEmoji} ${spec.name} (AI roast / rate)

A working starter is seeded (input → AI verdict with a LOCAL fallback → shareable card).

1. Take the user's input (text box; optionally a photo via \`sdk.files.upload\` → pass its
   url in \`ai.chat(..., { images:[url] })\`). On submit, show a spinner — \`sdk.ai.chat\`
   is slow + quota'd; call it ONCE, never in a loop.
2. Ask for JSON: \`{"score":0-10,"roast":string}\`, pass \`{ json: true }\`, then PARSE
   DEFENSIVELY (clamp the score 0–10, require a non-empty string). On ANY failure fall
   back to the seeded local roasts — never block on AI.
3. RULES (keep it shippable): roast the ARTIFACT, never the person (no looks/identity/
   age); always show the one-line reason; keep it wholesome.
4. End on the seeded \`<ResultCard>\` — the score (a .tj-bar) + the roast — and a "Share"
   button: \`shareResult(sdk, { text, data:{ score, roast } })\`. \`readChallenge\` shows a
   friend's verdict when opened from a share.
5. Theme it (Toybox). Wire the spec's specifics:
${spec.features.length ? spec.features.map((f) => `   - ${f}`).join("\n") : "   - (pick a fun thing to roast on-theme)"}
6. Acceptance: submitting gives a scored verdict (AI or fallback), and the share button
   produces a link. The build must compile with the local fallback even if AI is off.`;

const starterFiles = (spec: AppSpec, _ctx: KitContext): Record<string, string> => {
  const emoji = spec.iconEmoji;
  const title = spec.name.replace(/`/g, "");
  const page = `"use client";

import SuperJam, { type SuperJamSdk } from "@superjam/sdk";
import { useRef, useState } from "react";
import { ResultCard, shareResult } from "@/components/result-card";

// ${title} — submit something, the AI roasts + scores it. Defensive: a LOCAL fallback
// runs whenever AI is slow / over-quota / ungranted, so the jam ALWAYS works.
type Verdict = { score: number; roast: string };

// TODO: rewrite these on-theme (still wholesome — roast the THING, never the person).
const FALLBACK: Verdict[] = [
  { score: 4, roast: "A bold choice that absolutely nobody asked for." },
  { score: 7, roast: "Not bad! Carried entirely by confidence and vibes." },
  { score: 2, roast: "This has the energy of a Monday morning alarm." },
  { score: 9, roast: "Okay, showing off now. Save some for the rest of us." },
  { score: 6, roast: "Solid. The participation trophy of greatness." },
];
function localVerdict(input: string): Verdict {
  let h = 0; for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return FALLBACK[Math.abs(h) % FALLBACK.length] ?? FALLBACK[0]!;
}

async function getVerdict(s: SuperJamSdk, input: string): Promise<Verdict> {
  try {
    const { text } = await s.ai.chat(
      [{ role: "user", content:
        'Roast this in ONE witty, WHOLESOME sentence (never attack looks/identity/age — roast the thing) and score it 0-10. Subject: "' + input + '". Reply ONLY JSON {"score":number,"roast":string}.' }],
      { json: true },
    );
    const o = JSON.parse(text) as Record<string, unknown>;
    const score = typeof o.score === "number" ? Math.max(0, Math.min(10, Math.round(o.score))) : NaN;
    const roast = typeof o.roast === "string" ? o.roast.slice(0, 200) : "";
    if (!Number.isNaN(score) && roast) return { score, roast };
  } catch { /* fall through */ }
  return localVerdict(input);
}

export default function Page() {
  const sdkRef = useRef<SuperJamSdk | null>(null);
  const [input, setInput] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [busy, setBusy] = useState(false);

  async function roast() {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const s = sdkRef.current ?? (await SuperJam.connect());
      sdkRef.current = s;
      setVerdict(await getVerdict(s, text));
    } finally { setBusy(false); }
  }

  if (verdict) {
    const s = sdkRef.current;
    return (
      <main className="tj-app">
        <ResultCard
          emoji="${emoji}"
          title={verdict.score + "/10"}
          subtitle={verdict.roast}
          lines={[{ label: "Score", value: verdict.score + "/10", pct: verdict.score * 10 }]}
        >
          <div className="tj-row" style={{ gap: 8, marginTop: 14 }}>
            <button className="tj-btn tj-btn-block" onClick={() => { if (s) shareResult(s, { text: "I got roasted " + verdict.score + "/10 😅 — your turn", data: { score: verdict.score, roast: verdict.roast } }); }}>Share the burn 🔥</button>
            <button className="tj-btn tj-btn-ghost" onClick={() => { setVerdict(null); setInput(""); }}>Again</button>
          </div>
        </ResultCard>
      </main>
    );
  }

  return (
    <main className="tj-app">
      <div className="tj-card">
        <div className="tj-header">
          <span className="tj-emoji">${emoji}</span>
          <div className="tj-htext"><h1 className="tj-title">${title}</h1><p className="tj-sub">Submit it. Brace yourself.</p></div>
        </div>
        {/* TODO: optionally accept a photo via sdk.files.upload → ai.chat({ images:[url] }). */}
        <textarea className="tj-input" rows={3} value={input} maxLength={200} placeholder="Paste it here…" onChange={(e) => setInput(e.target.value)} />
        <button className="tj-btn tj-btn-block" style={{ marginTop: 10 }} disabled={busy || !input.trim()} onClick={roast}>
          {busy ? "Cooking… 🔥" : "Roast me"}
        </button>
      </div>
    </main>
  );
}
`;
  return { "components/result-card.tsx": resultCardComponent(), "app/page.tsx": page };
};

const gate = (files: Record<string, string>): GateResult => {
  const page = files["app/page.tsx"] ?? "";
  const missing: string[] = [];
  if (!/\.ai\.chat\(/.test(page)) {
    missing.push("get the verdict from sdk.ai.chat (with { json: true }) — don't fake the AI");
  }
  // judge.md: AI returns junk / is quota'd — there MUST be a local fallback so it never blocks.
  if (!/fallback|FALLBACK|catch\s*\{/i.test(page)) {
    missing.push("add a defensive try/catch + a LOCAL fallback so the jam works when AI is slow/over-quota");
  }
  if (!/shareResult\(|\.share\.link\(/.test(page)) {
    missing.push("end on a shareable verdict — call shareResult(sdk, { text, data })");
  }
  return { ok: missing.length === 0, missing };
};

export const aiRoastKit: Kit = {
  id: "ai-roast",
  title: "AI roast / rate",
  match,
  questions,
  plan,
  starterFiles,
  gate,
};
