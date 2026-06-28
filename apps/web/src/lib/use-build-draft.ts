"use client";

// Resumable build-wizard persistence (§3c). The wizard's state is mirrored to
// localStorage (instant, offline) AND — when signed in — to a DB `build_draft`
// row (cross-device), keyed by a draftId carried in the URL (/build?d=…). So a
// reload / pay redirect / World-App round-trip RESUMES instead of resetting to
// the first step. The draftId is a client-generated typeid → the URL is stable
// from mount (resume even a half-typed idea).
import type { AppSpec, BuildDraftId, BuildStep, DraftState } from "@superjam/shared";
import { typeIdGenerator } from "@superjam/shared";
import { useCallback, useRef, useState } from "react";
import { usePlatformClient } from "../components/use-platform-client";

export interface DraftSnapshot {
  step: BuildStep;
  prompt: string;
  spec: AppSpec | null;
  state: DraftState;
  buildId: string | null;
}

const lsKey = (id: string) => `sj:draft:${id}`;
const SAVE_DEBOUNCE_MS = 600;

/** Resolve the draftId (from ?d= or a fresh typeid) + expose load()/persist().
 *  Persist writes localStorage immediately and debounces the DB save (best-effort,
 *  never blocks the wizard). load() prefers the local snapshot (freshest on the
 *  same device), falling back to the server row (cross-device / cleared cache). */
export function useBuildDraft(opts: { initialDraftId: string | null; isLoggedIn: boolean }) {
  const client = usePlatformClient();
  const [draftId] = useState<string>(
    () => opts.initialDraftId ?? typeIdGenerator("buildDraft")
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loggedIn = opts.isLoggedIn;

  const persist = useCallback(
    (snap: DraftSnapshot) => {
      try {
        localStorage.setItem(
          lsKey(draftId),
          JSON.stringify({ ...snap, _at: Date.now() })
        );
      } catch {
        /* private mode / quota — localStorage is best-effort */
      }
      if (!loggedIn) return;
      // Don't create empty draft rows. Every fresh /build mount runs the wizard's
      // auto-save once with a blank snapshot (prompt="", no spec, no build); if we
      // persisted that, each visit would spawn a new "Untitled idea" draft and they
      // pile up under "More drafts". Only save once there's real content.
      const hasContent =
        snap.prompt.trim() !== "" || snap.spec != null || snap.buildId != null;
      if (!hasContent) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        client.builds
          .saveDraft({
            draftId: draftId as BuildDraftId,
            step: snap.step,
            prompt: snap.prompt,
            spec: snap.spec ?? undefined,
            state: snap.state,
            buildId: (snap.buildId ?? undefined) as never,
          })
          .catch(() => {
            /* draft save is best-effort — localStorage already has it */
          });
      }, SAVE_DEBOUNCE_MS);
    },
    [draftId, client, loggedIn]
  );

  const load = useCallback(async (): Promise<DraftSnapshot | null> => {
    // Read BOTH sources, then prefer the NEWER (by timestamp). localStorage is
    // freshest on the same device; the server wins cross-device / after a cache
    // clear (where a stale local copy would otherwise shadow newer progress).
    let local: (DraftSnapshot & { _at?: number }) | null = null;
    try {
      const raw = localStorage.getItem(lsKey(draftId));
      if (raw) local = JSON.parse(raw) as DraftSnapshot & { _at?: number };
    } catch {
      /* ignore */
    }
    let server: (DraftSnapshot & { _at?: number }) | null = null;
    if (loggedIn) {
      try {
        const d = await client.builds.getDraft({ draftId: draftId as BuildDraftId });
        if (d) {
          server = {
            step: d.step as BuildStep,
            prompt: d.prompt,
            spec: (d.spec ?? null) as AppSpec | null,
            state: (d.state ?? {}) as DraftState,
            buildId: d.buildId ?? null,
            _at: d.updatedAt ? new Date(d.updatedAt).getTime() : 0,
          };
        }
      } catch {
        /* server unavailable — fall back to local */
      }
    }
    if (local && server) return (local._at ?? 0) >= (server._at ?? 0) ? local : server;
    return local ?? server;
  }, [draftId, client, loggedIn]);

  return { draftId, persist, load };
}
