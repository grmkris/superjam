// The viral engine shared by every "result + share" kit. Each kit seeds the SAME
// components/result-card.tsx (returned from its starterFiles) so the share loop is
// identical everywhere: a jam ends in a personal result → `shareResult` makes a
// sdk.share.link deep-link (copied / sent to a friend) → whoever opens it gets the
// payload back as sdk.app.context().launch (read via `readChallenge`) and sees a
// "@x got <result> — beat it?" framing. ONE source of truth for the card + helpers.

/** The seeded `components/result-card.tsx` — a Studio result card + the share/launch
 *  helpers. Viral kits import from `@/components/result-card`. */
export const resultCardComponent = (): string => `"use client";

// SuperJam viral kit — the shared result card + share-link helpers. The whole point
// of a viral jam: end in a personal RESULT, then let the player share it as a
// "beat this / which are you / can you guess" deep-link.
import SuperJam, { type Json, type SuperJamSdk } from "@superjam/sdk";
import type { ReactNode } from "react";

export interface ResultLine {
  label: string;
  value: string;
  /** 0-100 → renders an animated .tj-bar; omit for a plain label/value row. */
  pct?: number;
}

/** The shareable result card — a Studio card with an emoji header + optional meter
 *  rows + your own content. Keep the result personal + punchy (it's what spreads). */
export function ResultCard(props: {
  emoji?: string;
  title: string;
  subtitle?: string;
  lines?: ResultLine[];
  children?: ReactNode;
}) {
  const { emoji, title, subtitle, lines, children } = props;
  return (
    <div className="tj-card">
      <div className="tj-header">
        {emoji ? <span className="tj-emoji">{emoji}</span> : null}
        <div className="tj-htext">
          <h1 className="tj-title">{title}</h1>
          {subtitle ? <p className="tj-sub">{subtitle}</p> : null}
        </div>
      </div>
      {lines && lines.length > 0 ? (
        <ul className="tj-list">
          {lines.map((l) => (
            <li key={l.label} style={{ display: "block" }}>
              {typeof l.pct === "number" ? (
                <div className="tj-bar">
                  <div className="tj-bar-fill" style={{ width: Math.max(0, Math.min(100, l.pct)) + "%" }} />
                  <div className="tj-bar-label"><span>{l.label}</span><span>{l.value}</span></div>
                </div>
              ) : (
                <div className="tj-row" style={{ justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 700 }}>{l.label}</span>
                  <span className="tj-muted">{l.value}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {children}
    </div>
  );
}

/** Make + share a deep-link carrying \`data\` (≤2KiB). With \`to\` (a @username) it
 *  challenges that friend via the inbox; otherwise it copies the link + toasts. The
 *  friend who opens it gets \`data\` back from readChallenge(). */
export async function shareResult(
  sdk: SuperJamSdk,
  opts: { text: string; data?: Json; to?: string }
): Promise<void> {
  try {
    const { url } = await sdk.share.link({ data: opts.data });
    if (opts.to) {
      // messages.send needs the "social" capability — only pass \`to\` if the jam declares it.
      await sdk.messages.send({ to: opts.to, text: opts.text, link: url, data: opts.data ?? null });
      sdk.ui.toast("Challenge sent! 🚀");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      sdk.ui.toast("Link copied — share it! 🔗");
    } catch {
      sdk.ui.toast("Share link ready 🔗");
    }
  } catch {
    sdk.ui.toast("Couldn't make a share link");
  }
}

/** Read the payload from a share link the player opened (sdk.app.context().launch).
 *  UNTRUSTED — validate every field + render as plain text. Returns null normally. */
export function readChallenge<T = Record<string, Json>>(sdk: SuperJamSdk): T | null {
  const l = sdk.app.context().launch;
  return l && typeof l === "object" && !Array.isArray(l) ? (l as T) : null;
}

export { SuperJam };
`;
