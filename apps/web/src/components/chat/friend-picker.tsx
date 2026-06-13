"use client";

// FriendPicker (DESIGN_BRIEF §3e) — a bottom sheet to pick a friend to send a
// jam / challenge to (from the feed or a jam page). Sends via chat.shareJam and
// shows a quick "sent ✓" before closing.
import { useEffect, useState } from "react";
import { ToyboxSheet } from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";
import { EmojiToken, StickerButton, StickerCard } from "../ui/sticker";
import { VerifiedBadge } from "../verified-badge";
import { usePlatformClient } from "../use-platform-client";

interface Friend {
  id: string;
  username: string;
  ensName: string | null;
  worldVerified: boolean;
}

export function FriendPicker({
  jamSlug,
  challenge,
  title,
  onClose,
}: {
  jamSlug: string;
  challenge?: boolean;
  title?: string;
  onClose: () => void;
}) {
  const client = usePlatformClient();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    client.friends
      .list()
      .then((r) => setFriends(r.friends))
      .catch(() => setFriends([]));
  }, [client]);

  const send = async (username: string) => {
    try {
      await client.chat.shareJam({ to: username, jamSlug, challenge });
      setSentTo(username);
      setTimeout(onClose, 900);
    } catch {
      /* not friends / transient */
    }
  };

  return (
    <ToyboxSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title ?? (challenge ? "Challenge a friend" : "Send to a friend")}
    >
      <div className="text-h3 font-extrabold">
        {title ?? (challenge ? "⚔ Challenge a friend" : "Send to a friend")}
      </div>
      {friends === null ? (
        <div className="flex flex-col gap-2.5 py-1">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : friends.length === 0 ? (
        <div className="text-muted font-semibold py-4 text-center">
          add a friend first (Inbox → Friends)
        </div>
      ) : (
        friends.map((f) => (
          <StickerCard key={f.id} className="p-3 flex items-center gap-3">
            <EmojiToken emoji="🙂" color="green" size={36} />
            <span className="font-extrabold">@{f.username}</span>
            {f.worldVerified && <VerifiedBadge />}
            <button
              onClick={() => send(f.username)}
              disabled={sentTo === f.username}
              className="focus-ring ml-auto bg-pink text-white border-2 border-ink rounded-full px-4 py-1.5 text-small font-extrabold shadow-sticker-sm sticker-press"
            >
              {sentTo === f.username ? "sent ✓" : challenge ? "Challenge" : "Send"}
            </button>
          </StickerCard>
        ))
      )}
      <StickerButton color="white" size="md" block onClick={onClose}>
        Cancel
      </StickerButton>
    </ToyboxSheet>
  );
}
