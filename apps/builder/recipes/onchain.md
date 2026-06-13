# Recipe onchain — games whose state/rewards live on Arc (you deploy a contract)

The jam plays against its OWN smart contract on **Arc**. You write + deploy the contract;
the frontend reads/writes it through `sdk.onchain` — **gasless** (the platform server wallet
is the contract operator and pays gas) and **player-stamped** (the platform injects the real
player; the app never passes "who"). Manifest capability: **"onchain"** (skill `onchain`).

Use this when the point is "it's really on-chain": provable results, on-chain leaderboards,
mintable tokens/NFTs. For escrowed USDC bets use `market.md` (sdk.pot) instead; for plain
leaderboards use `game.md` (sdk.data.counter) — cheaper and simpler than a contract.

## THE FLOW
1. Edit `contracts/src/Game.sol` (keep the name `Game`). Deploy: `bash contracts/deploy.sh`
   → prints `{"address","abi"}`. Write `lib/contract.ts` with them. Report `contractAddress`
   + `contractAbi` in the `done` payload.
2. Frontend: `await sdk.onchain.write({ fn, args })` → `{hash}` and
   `await sdk.onchain.read({ fn, args })` → decoded value.

## HARD RULES (the contract)
- `constructor(address operator_)` sets `operator`. Every state-changing fn is `onlyOperator`
  AND takes `address player` as its **first** arg — the platform stamps it; the app passes only
  the trailing args. Reads are open `view` fns.
- **Dependency-free**: no OpenZeppelin, no imports, no `forge install`. Write minimal ERC-20/721
  logic inline (examples below). Solidity `^0.8.24`.
- On-chain randomness is `keccak256(block.prevrandao, player, nonce)` — fine for a toy, never
  for real money.

## HARD RULES (the frontend)
- `sdk.onchain.write` is gasless + async (server relays). Show a pending state; on resolve,
  re-`read` the new state. Wrap in try/catch.
- Never pass the player address as the first `args` element — it's auto-stamped. `read` args you
  pass yourself (e.g. your own `ctx.user.walletAddress`).
- Big integers come back from `read` as **decimal strings** — `BigInt(x)` / `Number(x)`.
- Gate value-ish/mint actions on `ctx.user.worldVerified`. Degrade when `sdk.standalone`.

---

## Template A — Coinflip / dice (the seeded base)

`contracts/src/Game.sol` (this is what's already seeded; adapt for dice = `% 6 + 1`):
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Game {
    address public operator;
    mapping(address => uint8) public lastFlip;   // 1 heads, 2 tails
    mapping(address => uint256) public wins;
    uint256 public totalFlips;
    event Flipped(address indexed player, uint8 guess, uint8 result, bool won);
    constructor(address operator_) { operator = operator_; }
    modifier onlyOperator() { require(msg.sender == operator, "not operator"); _; }
    function flip(address player, uint8 guess) external onlyOperator {
        uint8 result = uint8(uint256(keccak256(abi.encodePacked(block.prevrandao, player, totalFlips))) % 2) + 1;
        bool won = guess == result;
        lastFlip[player] = result; if (won) wins[player] += 1; totalFlips += 1;
        emit Flipped(player, guess, result, won);
    }
    function statsOf(address player) external view returns (uint8 last, uint256 won) {
        return (lastFlip[player], wins[player]);
    }
}
```
`app/page.tsx`:
```tsx
"use client";
import SuperJam, { type SuperJamSdk } from "@superjam/sdk";
import { useEffect, useRef, useState } from "react";
export default function Page() {
  const sdk = useRef<SuperJamSdk | null>(null);
  const [addr, setAddr] = useState("");
  const [wins, setWins] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("Heads or tails?");
  useEffect(() => { (async () => {
    const s = await SuperJam.connect(); sdk.current = s;
    setAddr(s.app.context().user.walletAddress); void refresh(s);
  })(); }, []);
  async function refresh(s: SuperJamSdk) {
    const [, won] = (await s.onchain.read<[string, string]>({ fn: "statsOf", args: [s.app.context().user.walletAddress] })) ?? ["0", "0"];
    setWins(Number(won));
  }
  async function flip(guess: 1 | 2) {
    const s = sdk.current!; setBusy(true);
    try {
      await s.onchain.write({ fn: "flip", args: [guess] });   // player auto-stamped
      const [last] = await s.onchain.read<[string, string]>({ fn: "statsOf", args: [addr] });
      setMsg(Number(last) === guess ? "You won! 🎉" : "Missed — try again");
      await refresh(s);
    } catch { s.ui.toast("Flip failed"); } finally { setBusy(false); }
  }
  return (
    <main style={{ fontFamily: "system-ui", padding: 24, textAlign: "center" }}>
      <h1>🪙 Coinflip</h1><p>{msg}</p>
      <button disabled={busy} onClick={() => flip(1)}>Heads</button>{" "}
      <button disabled={busy} onClick={() => flip(2)}>Tails</button>
      <p>Wins: {wins}</p>
    </main>
  );
}
```

## Template B — On-chain tic-tac-toe (two-player turn state)
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Game {
    address public operator;
    uint8[9] public board;        // 0 empty, 1 X, 2 O
    uint8 public turn = 1;        // whose mark is next
    uint8 public winner;          // 0 none, 1 X, 2 O, 3 draw
    uint256 public moves;
    event Moved(address indexed player, uint8 cell, uint8 mark);
    constructor(address operator_) { operator = operator_; }
    modifier onlyOperator() { require(msg.sender == operator, "not operator"); _; }
    function move(address player, uint8 cell) external onlyOperator {
        require(winner == 0 && cell < 9 && board[cell] == 0, "bad move");
        board[cell] = turn; emit Moved(player, cell, turn); moves++;
        winner = _check(); if (winner == 0) turn = turn == 1 ? 2 : 1;
        if (winner == 0 && moves == 9) winner = 3;
    }
    function reset(address) external onlyOperator {
        for (uint8 i; i < 9; i++) board[i] = 0; turn = 1; winner = 0; moves = 0;
    }
    function state() external view returns (uint8[9] memory b, uint8 t, uint8 w) { return (board, turn, winner); }
    function _check() internal view returns (uint8) {
        uint8[3][8] memory L = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
        for (uint8 i; i < 8; i++) { uint8 a = board[L[i][0]];
            if (a != 0 && a == board[L[i][1]] && a == board[L[i][2]]) return a; }
        return 0;
    }
}
```
Frontend: `sdk.onchain.write({ fn: "move", args: [cell] })`, poll `sdk.onchain.read({ fn: "state" })`
(returns `[board[9], turn, winner]`) every ~2s; render the 3×3 grid; "New game" → `reset`.

## Template C — Clicker with a mintable ERC-20 reward (inline, no OZ)
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Game {
    address public operator;
    string public name = "Click Coin"; string public symbol = "CLICK"; uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    event Transfer(address indexed from, address indexed to, uint256 value);
    constructor(address operator_) { operator = operator_; }
    modifier onlyOperator() { require(msg.sender == operator, "not operator"); _; }
    /// One click → mint 1 CLICK to the player.
    function click(address player) external onlyOperator {
        uint256 amt = 1e18; balanceOf[player] += amt; totalSupply += amt;
        emit Transfer(address(0), player, amt);
    }
}
```
Frontend: `sdk.onchain.write({ fn: "click", args: [] })` then
`sdk.onchain.read({ fn: "balanceOf", args: [addr] })` → `BigInt(x) / 10n**18n` for the count.

## Template D — Mint an on-chain collectible (minimal ERC-721, inline)
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract Game {
    address public operator;
    string public name = "SuperJam Badge"; string public symbol = "SJB";
    uint256 public nextId;
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => string) public tokenURI;
    mapping(address => uint256) public balanceOf;
    event Transfer(address indexed from, address indexed to, uint256 indexed id);
    constructor(address operator_) { operator = operator_; }
    modifier onlyOperator() { require(msg.sender == operator, "not operator"); _; }
    /// Mint the next badge to the player. `uri` is app-supplied metadata (a data: URI is fine).
    function mint(address player, string calldata uri) external onlyOperator returns (uint256 id) {
        id = ++nextId; ownerOf[id] = player; tokenURI[id] = uri; balanceOf[player] += 1;
        emit Transfer(address(0), player, id);
    }
}
```
Frontend: gate on `worldVerified`, `sdk.onchain.write({ fn: "mint", args: [uri] })`, then read
`balanceOf(addr)` / `ownerOf(id)` to show the collection.

---
Compose freely (e.g. tic-tac-toe that mints a badge to the winner) — but keep ONE `Game`
contract, operator-gated, with the player stamped as arg 0.
