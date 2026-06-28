// @superjam/sdk — the child side of the SuperJam bridge (§8/§9).
//
// A mini app calls `await SuperJam.connect()` to get a typed `sdk`. The SDK
// speaks the §8 envelope to the host via postMessage (handshake = host.hello,
// retried every 250ms; no reply in 5s ⇒ STANDALONE). In standalone mode the
// app is opened outside SuperJam (IPFS/.limo, local Bun.build preview) and the
// SDK falls back to an in-browser mock so the app still runs end-to-end:
// storage/data/counters → localStorage, payments auto-succeed, ai/files return
// canned values, messages loop back to your own inbox. `sdk.standalone` is true
// so the template can show an "Open in SuperJam" banner.
//
// The envelope zod schemas are the single source of truth — imported from
// @superjam/shared so host and child can never drift.
import {
  TJResponseSchema,
  BRIDGE_VERSION,
  type BridgeMethod,
  type TJErrorCode,
} from "@superjam/shared/bridge";

// ── Public types (mini apps import these) ─────────────────────────────────
export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export type AppContext = {
  appId: string;
  slug: string;
  name: string;
  ensName: string | null;
  category: string;
  remixOf: { slug: string; name: string } | null;
  /** UNTRUSTED payload from a share link — validate every field, render as text. */
  launch: Json | null;
  user: { id: string; username: string; walletAddress: string; worldVerified: boolean };
};

/** A shared-collection document. Identity is server-stamped; YOUR fields live
 *  under `data` (read `doc.data.text`, not `doc.text`). */
export type Doc = {
  id: string;
  userId: string;
  username: string;
  worldVerified: boolean;
  createdAt: number;
  data: Record<string, Json>;
};

export type Payment = { to: string; amountUsdc: string; memo: string | null; txHash: string; at: number };
export type Message = {
  id: string;
  from: string;
  text: string;
  data: Json | null;
  link: string | null;
  createdAt: number;
  read: boolean;
};
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatOpts = { json?: boolean; images?: string[] };

export type PotStatus = "open" | "resolved" | "void";
export type Pot = {
  question: string;
  options: string[];
  totals: Record<string, string>;
  myStake: { option: string; amount: number } | null;
  status: PotStatus;
  resolvedOption: string | null;
};

export type ListOpts = {
  where?: Record<string, Json>;
  orderBy?: { field: string; dir?: "asc" | "desc" };
  limit?: number;
  cursor?: string;
};
export type ListResult = { docs: Doc[]; cursor?: string };

export type Collection = {
  /** Insert a shared doc (your fields). Returns the server id + timestamp. */
  insert(doc: Record<string, Json>): Promise<{ id: string; createdAt: number }>;
  get(id: string): Promise<Doc | null>;
  /** OWN rows only. */
  update(id: string, patch: Record<string, Json>): Promise<void>;
  /** OWN rows only. */
  delete(id: string): Promise<void>;
  list(opts?: ListOpts): Promise<ListResult>;
};

export type Counter = {
  /** Atomic upsert; returns the new value. */
  increment(key: string, by?: number): Promise<number>;
  /** THE leaderboard primitive — highest first. */
  top(limit?: number): Promise<{ key: string; value: number }[]>;
};

export type SuperJamSdk = {
  /** true when running outside the host (mock fallback active). */
  standalone: boolean;
  app: { context(): AppContext };
  wallet: {
    getAddress(): Promise<string>;
    sendTransaction(tx: { to: string; value?: string; data?: string; chainId?: number }): Promise<{ hash: string }>;
  };
  payments: {
    /** PRIVATE by default. `to` is a @username (defaults to app treasury). */
    payUSDC(args: { amount: string; to?: string }): Promise<{ hash: string }>;
    usdcBalance(): Promise<{ formatted: string; raw: string }>;
    /** Server-verified list of THIS user's payments in THIS app — the ONLY trustworthy paywall check. */
    mine(): Promise<{ payments: Payment[] }>;
    payX402(args: { url: string; maxAmount?: string }): Promise<{ paid: boolean; result?: Json }>;
  };
  storage: {
    get<T = Json>(key: string): Promise<T | null>;
    getMany(keys: string[]): Promise<Record<string, Json | null>>;
    set(key: string, value: Json): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
    list(opts?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: string[]; cursor?: string }>;
  };
  data: {
    collection(name: string): Collection;
    counter(name: string): Counter;
  };
  ai: {
    chat(messages: ChatMessage[], opts?: ChatOpts): Promise<{ text: string }>;
  };
  messages: {
    send(msg: { to: string; text: string; data?: Json; link?: string }): Promise<{ id: string }>;
    list(opts?: { limit?: number }): Promise<{ messages: Message[] }>;
  };
  /** Push a render-spec CARD into one of the player's FRIENDS' chats (a
   *  challenge/invite). The host renders {title,body,icon,cta} safely + a CTA
   *  that opens THIS app at /app/<slug>?d=<base64(params)> (read via
   *  app.context().launch). Requires the "social" capability + friendship. */
  social: {
    send(args: {
      to: string;
      card: { title: string; body?: string; icon?: string; cta?: string };
      params?: Json;
    }): Promise<{ id: string }>;
  };
  share: { link(args?: { data?: Json }): Promise<{ url: string }> };
  files: { upload(dataUrl: string): Promise<{ id: string; url: string }> };
  /** Identity for YOUR backend: a short-lived ({exp} epoch-seconds) platform
   *  token. Send it `Authorization: Bearer` to your own API and verify it
   *  against `${SUPERJAM_JWKS_URL}` (aud = your appId). Re-fetch on 401. In
   *  standalone mode the token is empty — gate on `sdk.standalone`. */
  auth: { getToken(): Promise<{ token: string; exp: number }> };
  pot: {
    create(args: { question: string; options: string[]; deadline?: number; resolver?: "creator" | "ai" }): Promise<{ id: string }>;
    stake(args: { id: string; option: string; amount: number }): Promise<{ txHash: string }>;
    get(args: { id: string }): Promise<Pot>;
    resolve(args: { id: string; option: string }): Promise<void>;
  };
  /** Read/write YOUR game's own on-chain contract on Arc (the builder deployed
   *  it and the platform resolves its address — you never pass an address).
   *  `read` is a free view call; `write` is GASLESS — the platform server wallet
   *  (the contract's operator) signs + pays gas and STAMPS the caller as the
   *  first contract arg, so your mutator is `fn(address player, ...yourArgs)`
   *  and you pass only `...yourArgs`. Requires the "onchain" capability. Numbers
   *  too big for JS pass/return as decimal strings. */
  onchain: {
    read<T = Json>(args: { fn: string; args?: Json[] }): Promise<T>;
    write(args: { fn: string; args?: Json[]; value?: string }): Promise<{ hash: string }>;
  };
  ui: { toast(message: string): void };
};

/** Bridge rejection carrying the §8 error code. */
export class SuperJamError extends Error {
  code: TJErrorCode;
  constructor(code: TJErrorCode, message: string) {
    super(message);
    this.name = "SuperJamError";
    this.code = code;
  }
}

// ── Transport ─────────────────────────────────────────────────────────────
type CallFn = <T>(method: BridgeMethod, params?: unknown) => Promise<T>;
type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
let idSeq = 0;
const genId = (): string => "r" + (++idSeq).toString(36) + Math.random().toString(36).slice(2, 8);

/** Resolves `{ call, ctx }` once the host answers host.hello, or `null` after
 *  5s of silence (standalone). */
function connectBridge(): Promise<{ call: CallFn; ctx: AppContext } | null> {
  return new Promise((resolve) => {
    const parent = window.parent;
    if (!parent || parent === window) {
      resolve(null); // opened top-level — no host to talk to
      return;
    }

    const pending = new Map<string, Pending>();
    let settled = false;

    const onMessage = (e: MessageEvent) => {
      const parsed = TJResponseSchema.safeParse(e.data);
      if (!parsed.success) return; // ignore foreign/garbage messages
      const m = parsed.data;
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result);
      else p.reject(new SuperJamError(m.error.code, m.error.message));
    };
    window.addEventListener("message", onMessage);

    const call: CallFn = (method, params = {}) =>
      new Promise((res, rej) => {
        const id = genId();
        pending.set(id, { resolve: res as (v: unknown) => void, reject: rej });
        parent.postMessage({ tj: BRIDGE_VERSION, id, method, params }, "*");
        // long timeout: sendTransaction/stake wait for the human confirm sheet
        setTimeout(() => {
          if (pending.delete(id)) rej(new SuperJamError("INTERNAL", "BRIDGE_TIMEOUT"));
        }, 60_000);
      });

    const finishStandalone = () => {
      if (settled) return;
      settled = true;
      clearInterval(retry);
      window.removeEventListener("message", onMessage);
      resolve(null);
    };

    const sendHello = () => {
      const id = genId();
      pending.set(id, {
        resolve: (result) => {
          if (settled) return;
          settled = true;
          clearInterval(retry);
          clearTimeout(bail);
          resolve({ call, ctx: result as AppContext }); // keep onMessage live for real calls
        },
        reject: () => {}, // a rejected hello just means retry / eventually bail
      });
      parent.postMessage({ tj: BRIDGE_VERSION, id, method: "host.hello", params: {} }, "*");
    };

    sendHello();
    const retry = setInterval(() => { if (!settled) sendHello(); }, 250);
    const bail = setTimeout(finishStandalone, 5000);
  });
}

// ── Real (bridged) SDK ─────────────────────────────────────────────────────
const MAX_UPLOAD = 2 * 1024 * 1024;

// Result normalization at the bridge boundary (see SDK.md "Bridge result
// contract"). postMessage uses structured clone, which PRESERVES Date objects,
// and the platform's oRPC services currently emit Date `createdAt`/`at` and a
// wrapped `{ value }` counter result. Coerce to the §9 wire shapes here so apps
// always receive epoch-ms numbers and bare numbers — correct regardless of when
// the host adapter normalizes.
const toMs = (v: unknown): number =>
  typeof v === "number" ? v : v instanceof Date ? v.getTime() : typeof v === "string" ? +new Date(v) : Number(v);
const normDoc = (d: Doc): Doc => ({ ...d, createdAt: toMs(d.createdAt) });
const unwrapNum = (v: number | { value: number }): number => (typeof v === "number" ? v : v.value);

function bridgeUpload(call: CallFn, dataUrl: string): Promise<{ id: string; url: string }> {
  const comma = dataUrl.indexOf(",");
  const dataBase64 = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  if (dataBase64.length * 0.75 > MAX_UPLOAD) {
    return Promise.reject(new SuperJamError("BAD_REQUEST", "FILE_TOO_LARGE: max 2MB — downscale via canvas first"));
  }
  return call("files.upload", { dataBase64 });
}

function makeBridgeSdk(call: CallFn, ctx: AppContext): SuperJamSdk {
  const collection = (name: string): Collection => ({
    insert: (doc) =>
      call<{ id: string; createdAt: number }>("data.insert", { collection: name, doc })
        .then((r) => ({ ...r, createdAt: toMs(r.createdAt) })),
    get: (id) => call<Doc | null>("data.get", { collection: name, id }).then((d) => (d ? normDoc(d) : null)),
    update: (id, patch) => call("data.update", { collection: name, id, patch }),
    delete: (id) => call("data.delete", { collection: name, id }),
    list: (opts) =>
      call<ListResult>("data.list", { collection: name, ...opts })
        .then((r) => ({ ...r, docs: r.docs.map(normDoc) })),
  });
  const counter = (name: string): Counter => ({
    increment: (key, by = 1) => call<number | { value: number }>("counter.increment", { counter: name, key, by }).then(unwrapNum),
    top: (limit = 10) => call("counter.top", { counter: name, limit }),
  });
  return {
    standalone: false,
    app: { context: () => ctx },
    wallet: {
      getAddress: () => call("wallet.getAddress"),
      sendTransaction: (tx) => call("wallet.sendTransaction", tx),
    },
    payments: {
      payUSDC: (a) => call("payments.payUSDC", a),
      usdcBalance: () => call("payments.usdcBalance"),
      mine: () => call<{ payments: Payment[] }>("payments.mine").then((r) => ({ payments: r.payments.map((p) => ({ ...p, at: toMs(p.at) })) })),
      payX402: (a) => call("payments.payX402", a),
    },
    storage: {
      get: (key) => call("storage.get", { key }),
      getMany: (keys) => call("storage.getMany", { keys }),
      set: (key, value) => call("storage.set", { key, value }),
      delete: (key) => call("storage.delete", { key }),
      clear: () => call("storage.clear"),
      list: (opts) => call("storage.list", opts ?? {}),
    },
    data: { collection, counter },
    ai: { chat: (messages, opts) => call("ai.chat", { messages, ...opts }) },
    social: { send: (a) => call("social.send", a) },
    messages: {
      send: (msg) => call("messages.send", msg),
      list: (opts) => call<{ messages: Message[] }>("messages.list", opts ?? {}).then((r) => ({ messages: r.messages.map((m) => ({ ...m, createdAt: toMs(m.createdAt) })) })),
    },
    share: { link: (a) => call("share.link", a ?? {}) },
    files: { upload: (dataUrl) => bridgeUpload(call, dataUrl) },
    auth: { getToken: () => call("auth.getToken") },
    pot: {
      create: (a) => call("pot.create", a),
      stake: (a) => call("pot.stake", a),
      get: (a) => call("pot.get", a),
      resolve: (a) => call("pot.resolve", a),
    },
    onchain: {
      read: (a) => call("onchain.read", { fn: a.fn, args: a.args ?? [] }),
      write: (a) => call("onchain.write", { fn: a.fn, args: a.args ?? [], value: a.value }),
    },
    ui: { toast: (message) => { void call("ui.toast", { message }).catch(() => {}); } },
  };
}

// ── Standalone mock (localStorage-backed; app runs end-to-end offline) ──────
function makeStandalone(): SuperJamSdk {
  const ns = `sj:${location.pathname}`;
  const mem = new Map<string, unknown>();
  const read = <T,>(k: string): T | null => {
    try {
      const raw = localStorage.getItem(`${ns}:${k}`);
      if (raw != null) return JSON.parse(raw) as T;
    } catch { /* sandboxed iframe blocks LS — use memory */ }
    return (mem.get(k) as T) ?? null;
  };
  const write = (k: string, v: unknown) => {
    mem.set(k, v);
    try { localStorage.setItem(`${ns}:${k}`, JSON.stringify(v)); } catch { /* memory only */ }
  };
  const now = () => Date.now();
  const rid = (p: string) => p + now().toString(36) + Math.random().toString(36).slice(2, 6);

  const parseLaunch = (): Json | null => {
    try {
      const d = new URLSearchParams(location.search).get("d");
      return d ? (JSON.parse(decodeURIComponent(escape(atob(d)))) as Json) : null;
    } catch { return null; }
  };

  const ctx: AppContext = {
    appId: "standalone",
    slug: "standalone",
    name: "SuperJam (standalone)",
    ensName: null,
    category: "other",
    remixOf: null,
    launch: parseLaunch(),
    user: { id: "guest", username: "guest", walletAddress: ZERO_ADDR, worldVerified: false },
  };

  const stamp = (data: Record<string, Json>): Doc => ({
    id: rid("d"),
    userId: "guest",
    username: "guest",
    worldVerified: false,
    createdAt: now(),
    data,
  });

  const sortDocs = (docs: Doc[], opts?: ListOpts): Doc[] => {
    let out = docs;
    if (opts?.where) {
      const w = opts.where;
      out = out.filter((d) => Object.keys(w).every((k) => d.data[k] === w[k]));
    }
    if (opts?.orderBy) {
      const { field, dir = "desc" } = opts.orderBy;
      const val = (d: Doc): number => (field === "createdAt" ? d.createdAt : Number(d.data[field] ?? Number.NaN));
      out = [...out].sort((a, b) => {
        const av = val(a), bv = val(b);
        if (Number.isNaN(av)) return 1;
        if (Number.isNaN(bv)) return -1;
        return dir === "asc" ? av - bv : bv - av;
      });
    } else {
      out = [...out].sort((a, b) => b.createdAt - a.createdAt);
    }
    return opts?.limit ? out.slice(0, opts.limit) : out;
  };

  const collection = (name: string): Collection => {
    const key = `col:${name}`;
    const all = (): Doc[] => read<Doc[]>(key) ?? [];
    return {
      insert: async (doc) => {
        const d = stamp(doc);
        write(key, [d, ...all()].slice(0, 500));
        return { id: d.id, createdAt: d.createdAt };
      },
      get: async (id) => all().find((d) => d.id === id) ?? null,
      update: async (id, patch) => {
        write(key, all().map((d) => (d.id === id ? { ...d, data: { ...d.data, ...patch } } : d)));
      },
      delete: async (id) => { write(key, all().filter((d) => d.id !== id)); },
      list: async (opts) => ({ docs: sortDocs(all(), opts) }),
    };
  };

  const counter = (name: string): Counter => {
    const key = `cnt:${name}`;
    return {
      increment: async (k, by = 1) => {
        const map = read<Record<string, number>>(key) ?? {};
        const v = (map[k] ?? 0) + by;
        map[k] = v;
        write(key, map);
        return v;
      },
      top: async (limit = 10) => {
        const map = read<Record<string, number>>(key) ?? {};
        return Object.entries(map)
          .map(([k, value]) => ({ key: k, value }))
          .toSorted((a, b) => b.value - a.value)
          .slice(0, limit);
      },
    };
  };

  type StoredPot = Pot & { id: string };
  const potKey = (id: string) => `pot:${id}`;

  return {
    standalone: true,
    app: { context: () => ctx },
    wallet: {
      getAddress: async () => ZERO_ADDR,
      sendTransaction: async () => ({ hash: rid("0xmock") }),
    },
    payments: {
      payUSDC: async ({ amount, to }) => {
        const hash = rid("0xmock");
        const list = read<Payment[]>("pay") ?? [];
        write("pay", [{ to: to ?? "appTreasury", amountUsdc: amount, memo: null, txHash: hash, at: now() }, ...list]);
        return { hash };
      },
      usdcBalance: async () => ({ formatted: "100.00", raw: "100000000" }),
      mine: async () => ({ payments: read<Payment[]>("pay") ?? [] }),
      payX402: async () => ({ paid: true, result: null }),
    },
    storage: {
      get: async (k) => read(`kv:${k}`),
      getMany: async (keys) => Object.fromEntries(keys.map((k) => [k, read(`kv:${k}`)])),
      set: async (k, v) => {
        const idx = read<string[]>("kv:index") ?? [];
        if (!idx.includes(k)) write("kv:index", [...idx, k]);
        write(`kv:${k}`, v);
      },
      delete: async (k) => {
        write("kv:index", (read<string[]>("kv:index") ?? []).filter((x) => x !== k));
        write(`kv:${k}`, null);
      },
      clear: async () => {
        const idx = read<string[]>("kv:index") ?? [];
        idx.forEach((k) => write(`kv:${k}`, null));
        write("kv:index", []);
      },
      list: async (opts) => {
        const idx = read<string[]>("kv:index") ?? [];
        const keys = opts?.prefix ? idx.filter((k) => k.startsWith(opts.prefix!)) : idx;
        return { keys: opts?.limit ? keys.slice(0, opts.limit) : keys };
      },
    },
    data: { collection, counter },
    ai: {
      chat: async (messages, opts) => {
        const last = messages[messages.length - 1]?.content ?? "";
        if (opts?.images) return { text: `7 — (standalone mock) a charming take on "${last.slice(0, 40)}".` };
        if (opts?.json) return { text: '{"note":"standalone mock — wire ai.chat in the host for real output"}' };
        return { text: `(standalone mock) AI would answer: "${last.slice(0, 80)}…"` };
      },
    },
    messages: {
      send: async ({ text, data, link }) => {
        // loopback: standalone has no other users, so sends land in your own inbox
        const id = rid("m");
        const msg: Message = { id, from: "guest", text, data: data ?? null, link: link ?? null, createdAt: now(), read: false };
        write("inbox", [msg, ...(read<Message[]>("inbox") ?? [])].slice(0, 200));
        return { id };
      },
      list: async (opts) => ({ messages: (read<Message[]>("inbox") ?? []).slice(0, opts?.limit ?? 50) }),
    },
    social: {
      // standalone has no friends graph — the card is a no-op that returns an id
      send: async () => ({ id: rid("dm") }),
    },
    share: {
      link: async ({ data } = {}) => {
        const base = location.href.split("?")[0]!;
        if (data === undefined) return { url: base };
        const d = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
        return { url: `${base}?d=${d}` };
      },
    },
    files: { upload: async (dataUrl) => ({ id: "local", url: dataUrl }) },
    // No host ⇒ no real identity token. The app must gate on `sdk.standalone`.
    auth: { getToken: async () => ({ token: "", exp: 0 }) },
    pot: {
      create: async ({ question, options }) => {
        const id = rid("pot");
        const p: StoredPot = {
          id, question, options,
          totals: Object.fromEntries(options.map((o) => [o, "0"])),
          myStake: null, status: "open", resolvedOption: null,
        };
        write(potKey(id), p);
        return { id };
      },
      stake: async ({ id, option, amount }) => {
        const p = read<StoredPot>(potKey(id));
        if (p) {
          p.totals[option] = String((Number(p.totals[option] ?? "0") + amount));
          p.myStake = { option, amount: (p.myStake?.amount ?? 0) + amount };
          write(potKey(id), p);
        }
        return { txHash: rid("0xmock") };
      },
      get: async ({ id }) => {
        const p = read<StoredPot>(potKey(id));
        if (!p) return { question: "?", options: [], totals: {}, myStake: null, status: "void", resolvedOption: null };
        const { id: _omit, ...rest } = p;
        return rest;
      },
      resolve: async ({ id, option }) => {
        const p = read<StoredPot>(potKey(id));
        if (p) { p.status = "resolved"; p.resolvedOption = option; write(potKey(id), p); }
      },
    },
    onchain: {
      // No chain in standalone — back reads/writes with localStorage so the game
      // still plays. `read` returns the last value written for a fn name; `write`
      // records it and returns a mock hash.
      read: async ({ fn, args }) => read(`chain:${fn}:${JSON.stringify(args ?? [])}`) as never,
      write: async ({ fn, args }) => {
        const hash = rid("0xmock");
        write(`chain:${fn}:${JSON.stringify(args ?? [])}`, { hash, at: now() });
        return { hash };
      },
    },
    ui: { toast: (message) => { try { console.log("[toast]", message); } catch { /* noop */ } } },
  };
}

// ── Entry point ─────────────────────────────────────────────────────────────
export const SuperJam = {
  /** Connect to the host (or fall back to the standalone mock after 5s). */
  async connect(): Promise<SuperJamSdk> {
    const bridge = await connectBridge();
    return bridge ? makeBridgeSdk(bridge.call, bridge.ctx) : makeStandalone();
  },
};

export default SuperJam;
