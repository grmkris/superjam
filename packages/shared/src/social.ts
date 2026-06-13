// Friends + chat social primitives (§3e). The user↔user direct-message stream
// carries three kinds; a `card` is an app/host-supplied render-spec (PLAIN TEXT
// only — the host renders it, never as HTML) with a deeplink CTA.
import { z } from "zod";

export const DM_KINDS = ["text", "card", "tip"] as const;
export type DmKind = (typeof DM_KINDS)[number];

// A render-spec card an app (via sdk.social.send) or the host (share/challenge)
// attaches to a message. Bounded plain-text fields; the CTA opens message.link.
export const DmCardSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().max(500).optional(),
  /** a single emoji */
  icon: z.string().max(16).optional(),
  /** CTA label, e.g. "Play" / "Accept challenge" */
  cta: z.string().max(40).optional(),
});
export type DmCard = z.infer<typeof DmCardSchema>;
