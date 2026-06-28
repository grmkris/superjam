// Onchain game CONTRACT TEMPLATES — the vetted, parameterized Game.sol the builder
// seeds + fills from the spec, so the agent NEVER hand-writes Solidity (the #1
// onchain build failure). Each template is a complete, compile-tested contract
// (operator-gated, dependency-free, `fn(address player, …)` first-arg convention —
// the bridge stamps the player + relays gaslessly) plus a near-complete Studio
// `app/page.tsx` that drives it through `sdk.onchain`. The agent only extends the
// PAGE; the contract is fixed. selectOnchainTemplate() picks one from the spec.
import type { AppSpec } from "@superjam/shared";

export type OnchainTemplateId = "chance" | "pvp" | "collectible";

export interface OnchainTemplate {
  id: OnchainTemplateId;
  title: string;
  /** Keyword test over the spec text (first match wins; `chance` is the default). */
  match(hay: string): boolean;
  /** The filled, compile-ready contracts/src/Game.sol. */
  contract(spec: AppSpec): string;
  /** A near-complete Studio app/page.tsx that plays the contract via sdk.onchain. */
  page(spec: AppSpec): string;
}

const hayOf = (spec: AppSpec): string =>
  `${spec.name} ${spec.description} ${spec.features.join(" ")}`.toLowerCase();

// ── chance — guess 1..N, win if it matches a pseudo-random roll (flip/dice/wheel) ──
const outcomesFor = (hay: string): number =>
  /\bdice\b|\broll\b|\bd6\b|\bsix\b/.test(hay) ? 6 : /\bwheel\b|\bspin\b|roulette/.test(hay) ? 8 : 2;
const labelsFor = (n: number): string[] =>
  n === 2 ? ["Heads", "Tails"] : Array.from({ length: n }, (_, i) => String(i + 1));

const chance: OnchainTemplate = {
  id: "chance",
  title: "Chance game",
  match: (hay) => /coin\s?flip|\bflip\b|\bdice\b|\broll\b|wheel|\bspin\b|gamble|lucky|guess|heads|tails|random/.test(hay),
  contract: (spec) => {
    const n = outcomesFor(hayOf(spec));
    return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// SuperJam chance game — guess 1..OUTCOMES, win if it matches a pseudo-random roll.
// Operator-gated + player-stamped (the platform passes the real player as arg 0).
contract Game {
    uint8 public constant OUTCOMES = ${n};
    address public operator;
    mapping(address => uint8) public lastRoll;
    mapping(address => uint256) public wins;
    mapping(address => uint256) public plays;
    uint256 public total;
    event Played(address indexed player, uint8 guess, uint8 result, bool won);

    constructor(address operator_) { operator = operator_; }
    modifier onlyOperator() { require(msg.sender == operator, "not operator"); _; }

    // Block-based pseudo-randomness — fine for a toy, never for real money.
    function play(address player, uint8 guess) external onlyOperator {
        uint8 result = uint8(uint256(keccak256(abi.encodePacked(block.prevrandao, player, total))) % OUTCOMES) + 1;
        bool won = guess == result;
        lastRoll[player] = result;
        plays[player] += 1;
        if (won) wins[player] += 1;
        total += 1;
        emit Played(player, guess, result, won);
    }

    function statsOf(address player) external view returns (uint8 last, uint256 won, uint256 played) {
        return (lastRoll[player], wins[player], plays[player]);
    }
}
`;
  },
  page: (spec) => {
    const n = outcomesFor(hayOf(spec));
    const labels = JSON.stringify(labelsFor(n));
    const cols = n <= 2 ? " tj-cols-2" : "";
    const title = spec.name.replace(/`/g, "");
    return `"use client";

import SuperJam, { type SuperJamSdk, type AppContext } from "@superjam/sdk";
import { useEffect, useRef, useState } from "react";

// ${title} — an onchain chance game on Arc. The contract is already deployed; we
// play it GASLESSLY via sdk.onchain (the platform stamps the player + pays gas).
const LABELS: string[] = ${labels};

export default function Page() {
  const sdkRef = useRef<SuperJamSdk | null>(null);
  const [ctx, setCtx] = useState<AppContext | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [wins, setWins] = useState(0);
  const [plays, setPlays] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("Make your guess 👇");
  const [loading, setLoading] = useState(true);

  async function refresh(s: SuperJamSdk, addr: string) {
    try {
      const r = await s.onchain.read<[string, string, string]>({ fn: "statsOf", args: [addr] });
      setWins(Number(r[1])); setPlays(Number(r[2]));
    } catch { /* fresh player — no stats yet */ }
  }

  useEffect(() => {
    (async () => {
      const s = await SuperJam.connect();
      sdkRef.current = s;
      setStandalone(s.standalone);
      const c = s.app.context(); setCtx(c);
      if (!s.standalone) await refresh(s, c.user.walletAddress);
      setLoading(false);
    })();
  }, []);

  async function guess(g: number) {
    const s = sdkRef.current; const addr = ctx?.user.walletAddress;
    if (!s || !addr || busy) return;
    setBusy(true); setPicked(g);
    try {
      await s.onchain.write({ fn: "play", args: [g] }); // player auto-stamped
      const r = await s.onchain.read<[string, string, string]>({ fn: "statsOf", args: [addr] });
      const rolled = Number(r[0]);
      setMsg(rolled === g ? "You won! 🎉" : "Rolled " + (LABELS[rolled - 1] ?? rolled) + " — try again");
      await refresh(s, addr);
    } catch { s.ui.toast("Play failed — try again"); }
    finally { setBusy(false); }
  }

  if (loading) {
    return (<main className="tj-app tj-center"><div className="tj-card"><div className="tj-spin" /><p className="tj-sub">Loading…</p></div></main>);
  }
  if (standalone) {
    return (<main className="tj-app tj-center"><div className="tj-card"><div className="tj-header"><span className="tj-emoji">${spec.iconEmoji}</span><div className="tj-htext"><h1 className="tj-title">${title}</h1></div></div><p className="tj-sub">Open inside SuperJam to play onchain.</p></div></main>);
  }

  return (
    <main className="tj-app">
      <div className="tj-card">
        <div className="tj-header">
          <span className="tj-emoji">${spec.iconEmoji}</span>
          <div className="tj-htext"><h1 className="tj-title">${title}</h1><p className="tj-sub">{msg}</p></div>
        </div>
        <div className="tj-choices${cols}">
          {LABELS.map((lab, i) => (
            <button key={lab} className="tj-choice" disabled={busy} onClick={() => guess(i + 1)} aria-pressed={picked === i + 1}>{lab}</button>
          ))}
        </div>
        {/* TODO: add a flip/roll animation + a celebratory tj-pop on a win. */}
        <div className="tj-row" style={{ justifyContent: "space-between", marginTop: 14 }}>
          <div><div className="tj-stat">{wins}</div><p className="tj-muted">wins</p></div>
          <div style={{ textAlign: "right" }}><div className="tj-stat">{plays}</div><p className="tj-muted">plays</p></div>
        </div>
      </div>
    </main>
  );
}
`;
  },
};

// ── pvp — onchain tic-tac-toe (two-player turn state lives in the contract) ──
const pvp: OnchainTemplate = {
  id: "pvp",
  title: "Onchain tic-tac-toe",
  match: (hay) => /tic.?tac.?toe|noughts|connect|versus|\bvs\b|\bpvp\b|turn.based|\bduel\b|\bboard\b|1v1/.test(hay),
  contract: () => `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// SuperJam onchain tic-tac-toe — the board + turn live on-chain; moves are
// operator-relayed + player-stamped.
contract Game {
    address public operator;
    uint8[9] public board;   // 0 empty, 1 X, 2 O
    uint8 public turn = 1;   // whose mark is next
    uint8 public winner;     // 0 none, 1 X, 2 O, 3 draw
    uint256 public moves;
    event Moved(address indexed player, uint8 cell, uint8 mark);

    constructor(address operator_) { operator = operator_; }
    modifier onlyOperator() { require(msg.sender == operator, "not operator"); _; }

    function move(address player, uint8 cell) external onlyOperator {
        require(winner == 0 && cell < 9 && board[cell] == 0, "bad move");
        board[cell] = turn; emit Moved(player, cell, turn); moves++;
        winner = _check();
        if (winner == 0) turn = turn == 1 ? 2 : 1;
        if (winner == 0 && moves == 9) winner = 3;
    }

    function reset(address) external onlyOperator {
        for (uint8 i; i < 9; i++) board[i] = 0;
        turn = 1; winner = 0; moves = 0;
    }

    function state() external view returns (uint8[9] memory b, uint8 t, uint8 w) {
        return (board, turn, winner);
    }

    function _check() internal view returns (uint8) {
        uint8[3][8] memory L = [
            [uint8(0), 1, 2], [uint8(3), 4, 5], [uint8(6), 7, 8],
            [uint8(0), 3, 6], [uint8(1), 4, 7], [uint8(2), 5, 8],
            [uint8(0), 4, 8], [uint8(2), 4, 6]
        ];
        for (uint8 i; i < 8; i++) {
            uint8 a = board[L[i][0]];
            if (a != 0 && a == board[L[i][1]] && a == board[L[i][2]]) return a;
        }
        return 0;
    }
}
`,
  page: (spec) => {
    const title = spec.name.replace(/`/g, "");
    return `"use client";

import SuperJam, { type SuperJamSdk } from "@superjam/sdk";
import { useEffect, useRef, useState } from "react";

// ${title} — onchain tic-tac-toe on Arc. The board lives in the contract; moves are
// gasless via sdk.onchain. We poll state every ~2s.
export default function Page() {
  const sdkRef = useRef<SuperJamSdk | null>(null);
  const [board, setBoard] = useState<number[]>(Array(9).fill(0));
  const [turn, setTurn] = useState(1);
  const [winner, setWinner] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function readState(s: SuperJamSdk) {
    try {
      const r = await s.onchain.read<[string[], string, string]>({ fn: "state", args: [] });
      setBoard(r[0].map(Number)); setTurn(Number(r[1])); setWinner(Number(r[2]));
    } catch { /* not deployed yet / standalone */ }
  }

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      const s = await SuperJam.connect();
      sdkRef.current = s;
      await readState(s); setLoading(false);
      if (!s.standalone) timer = setInterval(() => readState(s), 2000);
    })();
    return () => { if (timer) clearInterval(timer); };
  }, []);

  async function play(cell: number) {
    const s = sdkRef.current;
    if (!s || busy || board[cell] !== 0 || winner !== 0) return;
    setBusy(true);
    try { await s.onchain.write({ fn: "move", args: [cell] }); await readState(s); }
    catch { s.ui.toast("Move failed"); }
    finally { setBusy(false); }
  }
  async function reset() {
    const s = sdkRef.current; if (!s) return;
    setBusy(true);
    try { await s.onchain.write({ fn: "reset", args: [] }); await readState(s); }
    catch { s.ui.toast("Reset failed"); }
    finally { setBusy(false); }
  }

  const mark = (v: number) => (v === 1 ? "✕" : v === 2 ? "◯" : "");
  const status = winner === 0 ? "Turn: " + (turn === 1 ? "✕" : "◯")
    : winner === 3 ? "Draw!" : (winner === 1 ? "✕" : "◯") + " wins! 🎉";

  if (loading) {
    return (<main className="tj-app tj-center"><div className="tj-card"><div className="tj-spin" /></div></main>);
  }
  return (
    <main className="tj-app">
      <div className="tj-card">
        <div className="tj-header">
          <span className="tj-emoji">${spec.iconEmoji}</span>
          <div className="tj-htext"><h1 className="tj-title">${title}</h1><p className="tj-sub">{status}</p></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {board.map((v, i) => (
            <button key={i} className="tj-choice" style={{ aspectRatio: "1 / 1", fontSize: 32 }} disabled={busy || v !== 0 || winner !== 0} onClick={() => play(i)}>{mark(v)}</button>
          ))}
        </div>
        <button className="tj-btn tj-btn-ghost tj-btn-block" style={{ marginTop: 12 }} onClick={reset}>New game</button>
      </div>
    </main>
  );
}
`;
  },
};

// ── collectible — mint an onchain badge (minimal ERC-721, inline, no deps) ──
const collectible: OnchainTemplate = {
  id: "collectible",
  title: "Onchain collectible",
  match: (hay) => /\bmint\b|\bnft\b|\bbadge\b|collectible|\btoken\b|\breward\b|trophy|\bclaim\b/.test(hay),
  contract: (spec) => {
    const name = spec.name.replace(/[^\w -]/g, "").trim().slice(0, 28) || "SuperJam Badge";
    const symbol = (name.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase()) || "SJB";
    return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// SuperJam onchain collectible — a minimal inline ERC-721. Operator-gated mint,
// player-stamped. \`uri\` is app-supplied metadata (a data: URI is fine).
contract Game {
    address public operator;
    string public name = ${JSON.stringify(name)};
    string public symbol = ${JSON.stringify(symbol)};
    uint256 public nextId;
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => string) public tokenURI;
    mapping(address => uint256) public balanceOf;
    event Transfer(address indexed from, address indexed to, uint256 indexed id);

    constructor(address operator_) { operator = operator_; }
    modifier onlyOperator() { require(msg.sender == operator, "not operator"); _; }

    function mint(address player, string calldata uri) external onlyOperator returns (uint256 id) {
        id = ++nextId; ownerOf[id] = player; tokenURI[id] = uri; balanceOf[player] += 1;
        emit Transfer(address(0), player, id);
    }
}
`;
  },
  page: (spec) => {
    const title = spec.name.replace(/`/g, "");
    return `"use client";

import SuperJam, { type SuperJamSdk, type AppContext } from "@superjam/sdk";
import { useEffect, useRef, useState } from "react";

// ${title} — mint an onchain collectible badge on Arc (gasless). Gated on a verified
// human; the player owns the token after mint.
export default function Page() {
  const sdkRef = useRef<SuperJamSdk | null>(null);
  const [ctx, setCtx] = useState<AppContext | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [owned, setOwned] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh(s: SuperJamSdk, addr: string) {
    try { const r = await s.onchain.read<string>({ fn: "balanceOf", args: [addr] }); setOwned(Number(r)); }
    catch { /* none yet */ }
  }

  useEffect(() => {
    (async () => {
      const s = await SuperJam.connect();
      sdkRef.current = s;
      setStandalone(s.standalone);
      const c = s.app.context(); setCtx(c);
      if (!s.standalone) await refresh(s, c.user.walletAddress);
      setLoading(false);
    })();
  }, []);

  async function mint() {
    const s = sdkRef.current; const addr = ctx?.user.walletAddress;
    if (!s || !addr || busy) return;
    setBusy(true);
    try {
      const uri = "data:application/json," + encodeURIComponent(JSON.stringify({ name: ${JSON.stringify(title)} }));
      await s.onchain.write({ fn: "mint", args: [uri] });
      await refresh(s, addr); s.ui.toast("Minted! 🎉");
    } catch { s.ui.toast("Mint failed"); }
    finally { setBusy(false); }
  }

  if (loading) {
    return (<main className="tj-app tj-center"><div className="tj-card"><div className="tj-spin" /></div></main>);
  }
  const canMint = !standalone && (ctx?.user.worldVerified ?? false);
  return (
    <main className="tj-app">
      <div className="tj-card tj-center">
        <div className="tj-header">
          <span className="tj-emoji">${spec.iconEmoji}</span>
          <div className="tj-htext"><h1 className="tj-title">${title}</h1></div>
        </div>
        <div className="tj-stat">{owned}</div>
        <p className="tj-muted">badges owned</p>
        {/* TODO: render the minted badge as inline SVG art keyed to the player. */}
        <button className="tj-btn tj-btn-block" disabled={busy || !canMint} onClick={mint} style={{ marginTop: 14 }}>
          {busy ? "Minting…" : "Mint your badge"}
        </button>
        {!canMint && <p className="tj-sub" style={{ marginTop: 8 }}>{standalone ? "Open inside SuperJam to mint." : "Verify you're human to mint."}</p>}
      </div>
    </main>
  );
}
`;
  },
};

const TEMPLATES: OnchainTemplate[] = [pvp, collectible, chance]; // chance is the fallback

/** Pick the onchain template that best fits the spec (chance = default). */
export const selectOnchainTemplate = (spec: AppSpec): OnchainTemplate => {
  const hay = hayOf(spec);
  return TEMPLATES.find((t) => t.match(hay)) ?? chance;
};
