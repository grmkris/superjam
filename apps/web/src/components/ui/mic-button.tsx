"use client";

// Toybox dictate button — drops in beside any prose field as a sibling adornment
// (like the 💸/🎮 chat buttons). Talks to the Web Speech API via
// `useSpeechRecognition` and appends finalized words to the field's value. When
// the API is unavailable it renders nothing, so typing is never affected.
import { useRef } from "react";
import { useSpeechRecognition } from "../../lib/use-speech-recognition";
import { cx } from "./cx";

export function MicButton({
  value,
  onChange,
  size = 44,
  className,
  label = "Dictate",
}: {
  /** Current field text — dictated words are appended to it. */
  value: string;
  onChange: (next: string) => void;
  /** Diameter in px (match the neighboring round buttons). */
  size?: number;
  className?: string;
  label?: string;
}) {
  // Read the latest value/onChange inside the recognizer callback without
  // re-binding it every keystroke.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const { supported, listening, interim, denied, toggle } = useSpeechRecognition({
    onResult: (chunk) => {
      const prev = valueRef.current;
      const next = prev.trim() ? `${prev.replace(/\s+$/, "")} ${chunk}` : chunk;
      onChangeRef.current(next);
    },
  });

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={listening}
      aria-label={listening ? "Stop dictating" : label}
      title={denied ? "Mic blocked — check browser permissions" : label}
      className={cx(
        "focus-ring relative grid place-items-center shrink-0 border border-line rounded-full shadow-sticker-sm sticker-press transition-colors",
        listening ? "bg-pink text-white" : "bg-card text-ink",
        className
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {/* Pulse ring while listening. */}
      {listening && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full border border-pink animate-ping motion-reduce:animate-none"
        />
      )}
      {/* Live preview of in-progress words, floated above the button. */}
      {listening && interim && (
        <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 max-w-[60vw] truncate rounded-full border border-line bg-ink px-2.5 py-1 text-tiny font-semibold text-cream shadow-sticker-sm">
          {interim}
        </span>
      )}
      {/* Permission denied — phones never show the title tooltip, so surface it. */}
      {denied && !listening && (
        <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 whitespace-nowrap rounded-full border border-line bg-pink px-2.5 py-1 text-tiny font-semibold text-white shadow-sticker-sm">
          allow mic access
        </span>
      )}
      <span aria-hidden className="relative leading-none">
        🎤
      </span>
    </button>
  );
}
