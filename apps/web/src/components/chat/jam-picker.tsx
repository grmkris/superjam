"use client";

// JamPicker (DESIGN_BRIEF §3e) — a bottom sheet to pick one of YOUR jams to send
// into a chat, as a Share (playable card) or a Challenge (card + deeplink).
import { useEffect, useState } from "react";
import { EmojiToken, StickerButton, StickerCard } from "../ui/sticker";
import { usePlatformClient } from "../use-platform-client";

interface MyJam {
  id: string;
  slug: string;
  name: string;
  iconEmoji: string;
  status: string;
}

export function JamPicker({
  onPick,
  onClose,
}: {
  onPick: (jamSlug: string, challenge: boolean) => void;
  onClose: () => void;
}) {
  const client = usePlatformClient();
  const [jams, setJams] = useState<MyJam[] | null>(null);

  useEffect(() => {
    client.apps
      .mine()
      .then((r) => setJams(r.jams as MyJam[]))
      .catch(() => setJams([]));
  }, [client]);

  const playable = (jams ?? []).filter(
    (j) => j.status === "listed" || j.status === "deployed"
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button aria-label="Dismiss" onClick={onClose} className="absolute inset-0 bg-ink/40" />
      <div className="relative w-full max-w-[460px] bg-cream border-t-2 border-ink rounded-t-toy-lg px-5 pt-4 pb-8 flex flex-col gap-3 max-h-[70dvh] overflow-y-auto">
        <div className="text-lg font-extrabold">🎮 Send a jam</div>
        {jams === null ? (
          <div className="text-muted font-semibold py-4">loading…</div>
        ) : playable.length === 0 ? (
          <div className="text-muted font-semibold py-4 text-center">
            no live jams yet — make one first ✨
          </div>
        ) : (
          playable.map((j) => (
            <StickerCard key={j.id} className="p-3 flex items-center gap-3">
              <EmojiToken emoji={j.iconEmoji} color="blue" size={40} rounded="toy" />
              <div className="font-extrabold text-[15px] truncate min-w-0 flex-1">
                {j.name}
              </div>
              <button
                onClick={() => onPick(j.slug, false)}
                className="bg-green text-ink border-2 border-ink rounded-full px-3 py-1.5 text-xs font-extrabold shadow-sticker-sm sticker-press"
              >
                Share
              </button>
              <button
                onClick={() => onPick(j.slug, true)}
                className="bg-pink text-white border-2 border-ink rounded-full px-3 py-1.5 text-xs font-extrabold shadow-sticker-sm sticker-press"
              >
                ⚔ Challenge
              </button>
            </StickerCard>
          ))
        )}
        <StickerButton color="white" size="md" block onClick={onClose}>
          Cancel
        </StickerButton>
      </div>
    </div>
  );
}
