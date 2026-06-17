// EmptyState — the repeated "emoji + headline + line + optional CTA" block,
// consolidated (Discover/Inbox/Me/Build/Agents all hand-rolled their own).
import type { ReactNode } from "react";
import { cx } from "./cx";
import { EmojiToken, type StickerColor } from "./sticker";

export function EmptyState({
  emoji,
  title,
  emojiColor = "yellow",
  action,
  className,
  children,
}: {
  emoji: string;
  title: ReactNode;
  emojiColor?: StickerColor;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center gap-3 px-8 py-10 text-center",
        className
      )}
    >
      <EmojiToken emoji={emoji} color={emojiColor} size={56} className="animate-pop" />
      <div className="text-h3 font-extrabold">{title}</div>
      {children && (
        <div className="text-small font-semibold text-muted">{children}</div>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
