"use client";

// JamPicker (DESIGN_BRIEF §3e) — a bottom sheet to pick one of YOUR jams to send
// into a chat, as a Share (playable card) or a Challenge (card + deeplink).
import { useEffect, useState } from "react";
import { ToyboxSheet } from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";
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
    <ToyboxSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Send a jam"
    >
      <div className="text-h3 font-extrabold tracking-tight">Send a jam</div>
      {jams === null ? (
        <div className="flex flex-col gap-2.5 py-1">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : playable.length === 0 ? (
        <div className="prose-body text-muted py-4 text-center">
          no live jams yet — make one first.
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 stagger">
          {playable.map((j) => (
            <StickerCard key={j.id} className="p-3 flex items-center gap-3">
              <EmojiToken emoji={j.iconEmoji} color="blue" size={40} rounded="toy" />
              <div className="font-extrabold text-body tracking-tight truncate min-w-0 flex-1">
                {j.name}
              </div>
              <button
                onClick={() => onPick(j.slug, false)}
                className="focus-ring bg-green text-ink border-[1.5px] border-ink rounded-full px-3 py-1.5 text-small font-extrabold shadow-sticker-sm sticker-press"
              >
                Share
              </button>
              <button
                onClick={() => onPick(j.slug, true)}
                className="focus-ring bg-pink text-white border-[1.5px] border-ink rounded-full px-3 py-1.5 text-small font-extrabold shadow-sticker-sm sticker-press"
              >
                ⚔ Challenge
              </button>
            </StickerCard>
          ))}
        </div>
      )}
      <StickerButton color="white" size="md" block onClick={onClose}>
        Cancel
      </StickerButton>
    </ToyboxSheet>
  );
}
