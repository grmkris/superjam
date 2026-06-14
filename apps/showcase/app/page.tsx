import Link from "next/link";

// Dev index — lists the showcase jams. Not registered as a jam itself; each
// route below is registered separately and framed by the host.
const JAMS = [
  { href: "/roast", emoji: "🔥", name: "Roast My Bags", sub: "AI roasts your portfolio" },
  { href: "/poll", emoji: "🗳️", name: "Proof-of-Human Poll", sub: "1 human, 1 vote" },
  { href: "/academy", emoji: "🎓", name: "Stablecoin Academy", sub: "Understand USDC in 60s" },
  { href: "/wrapped", emoji: "🎁", name: "Onchain Wrapped", sub: "Your year onchain" },
];

export default function Home() {
  return (
    <div className="tj-card">
      <h1 className="tj-title">⚡ SuperJam Showcase</h1>
      <p className="tj-sub">Hand-crafted mini-apps. Open any inside SuperJam.</p>
      <ul className="tj-list">
        {JAMS.map((j) => (
          <li key={j.href}>
            <Link
              href={j.href}
              style={{ display: "flex", gap: 10, alignItems: "center", textDecoration: "none", color: "inherit", width: "100%" }}
            >
              <span style={{ fontSize: 26 }}>{j.emoji}</span>
              <span>
                <b>{j.name}</b>
                <div className="tj-muted" style={{ fontSize: 13 }}>{j.sub}</div>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
