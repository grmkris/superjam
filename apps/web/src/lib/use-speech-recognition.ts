"use client";

// Client-side dictation over the browser-native Web Speech API
// (`SpeechRecognition` / `webkitSpeechRecognition`). No upload, no server STT —
// the recognizer hands us text and we feed it straight into a field's value.
// Unsupported browsers/webviews report `supported: false`, so callers (MicButton)
// can render nothing and typing is unaffected.
import { useCallback, useEffect, useRef, useState } from "react";

// ── Minimal Web Speech typings ──────────────────────────────────────────────
// Not reliably present in lib.dom, so we declare the slice we use.
interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechAlternative;
}
interface SpeechResultList {
  readonly length: number;
  [index: number]: SpeechResult;
}
interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechResultList;
}
interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

const getCtor = (): SpeechRecognitionCtor | null => {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
};

export interface UseSpeechRecognition {
  /** Web Speech API is available in this browser/webview. */
  supported: boolean;
  /** Mic is open and listening. */
  listening: boolean;
  /** Live, not-yet-finalized words for an on-screen preview. */
  interim: string;
  /** The user denied mic permission (or it's blocked). */
  denied: boolean;
  start(): void;
  stop(): void;
  toggle(): void;
}

/**
 * Tap-to-talk dictation. `onResult` fires with each *finalized* chunk so the
 * caller appends it; `interim` streams the in-progress words for preview.
 * `continuous` keeps the mic open across pauses (good for rambling an idea) —
 * the user taps again to stop.
 */
export function useSpeechRecognition({
  onResult,
  lang = "en-US",
  continuous = true,
}: {
  onResult: (finalText: string) => void;
  lang?: string;
  continuous?: boolean;
}): UseSpeechRecognition {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [denied, setDenied] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  // Keep the latest callback without re-binding the recognizer each render.
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  // Resolve support after mount so SSR and first client render agree (both
  // render nothing), avoiding a hydration mismatch.
  useEffect(() => {
    setSupported(getCtor() !== null);
  }, []);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor || recRef.current) return; // unsupported, or already listening

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = continuous;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let final = "";
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res) continue;
        const chunk = res[0]?.transcript ?? "";
        if (res.isFinal) final += chunk;
        else pending += chunk;
      }
      if (final.trim()) onResultRef.current(final.trim());
      setInterim(pending);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setDenied(true);
      }
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      setInterim("");
    };

    recRef.current = rec;
    setDenied(false);
    setInterim("");
    setListening(true);
    try {
      rec.start();
    } catch {
      // start() throws if the recognizer is already running — reset cleanly.
      recRef.current = null;
      setListening(false);
    }
  }, [lang, continuous]);

  const toggle = useCallback(() => {
    if (recRef.current) stop();
    else start();
  }, [start, stop]);

  // Abort any in-flight session on unmount.
  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, interim, denied, start, stop, toggle };
}
