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
    <div className="w-[230px] bg-card border border-line rounded-toy shadow-sticker overflow-hidden">
      <div className="flex items-center gap-2.5 p-3">
        <EmojiToken emoji={card.icon || via?.iconEmoji || "🎮"} color="yellow" size={40} rounded="toy" />
        <div className="flex flex-col min-w-0">
          <div className="font-extrabold text-body tracking-tight truncate">{card.title}</div>
          {via && (
            <div className="text-tiny font-semibold text-muted truncate">
              via {via.name}
            </div>
          )}
        </div>
      </div>
      {card.body && (
        <div className="prose-body px-3 pb-2 text-small">
          {card.body}
        </div>
      )}
      {onCta && (
        <button
          onClick={onCta}
          className="focus-ring w-full bg-ink text-white border-t border-line py-2.5 text-small font-extrabold sticker-press"
        >
          {card.cta || (mine ? "Sent" : "Open")} ▸
        </button>
      )}
    </div>
  );
}
