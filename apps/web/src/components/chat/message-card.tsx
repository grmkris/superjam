"use client";

// MessageCard — renders a chat `card` message (DESIGN_BRIEF §3e): an app/host
// render-spec {title, body?, icon?, cta?} with a CTA that opens the deeplink.
// Plain text only (never HTML) — the host owns the layout, not the sender.
import { EmojiToken } from "../ui/sticker";
import type { DmCard } from "@superjam/shared";

export function MessageCard({
  card,
  via,
  onCta,
  mine,
}: {
  card: DmCard;
  via?: { name: string; iconEmoji: string } | null;
  onCta?: () => void;
  mine?: boolean;
}) {
  return (
    <div className="w-[230px] bg-card border-2 border-ink rounded-toy shadow-sticker overflow-hidden">
      <div className="flex items-center gap-2.5 p-3">
        <EmojiToken emoji={card.icon || via?.iconEmoji || "🎮"} color="yellow" size={40} rounded="toy" />
        <div className="flex flex-col min-w-0">
          <div className="font-extrabold text-body truncate">{card.title}</div>
          {via && (
            <div className="text-tiny font-semibold text-muted truncate">
              via {via.name}
            </div>
          )}
        </div>
      </div>
      {card.body && (
        <div className="px-3 pb-2 text-small font-semibold leading-snug">
          {card.body}
        </div>
      )}
      {onCta && (
        <button
          onClick={onCta}
          className="focus-ring w-full bg-pink text-white border-t-2 border-ink py-2.5 text-small font-extrabold sticker-press"
        >
          {card.cta || (mine ? "Sent" : "Open")} ▸
        </button>
      )}
    </div>
  );
}
