"use client";

// Register your builder (DESIGN_BRIEF §3c / SPEC §5b) — AgentKit: anyone
// World-verified can register their AI as a builder. It gets an ENS subname
// under the owner, an on-chain ERC-8004 identity, and a USDC revenue share.
// World-gated (the human backing IS the anti-sybil story).
import {
  type BuilderCapability,
  BUILDER_CAPABILITIES,
} from "@superjam/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "../../../components/ui/cx";
import { EmojiToken, StickerButton, StickerCard } from "../../../components/ui/sticker";
import { usePlatformClient } from "../../../components/use-platform-client";
import { useHostAuth } from "../../../lib/use-host-auth";
import { WorldGate } from "../../../components/world-gate";

const SLUG_OK = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const ADDR_OK = /^0x[0-9a-fA-F]{40}$/;
const PRICE_OK = /^\d+(\.\d{1,6})?$/;

export default function RegisterBuilderPage() {
  const router = useRouter();
  const client = usePlatformClient();
  const { isLoggedIn } = useHostAuth();

  const [verified, setVerified] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [token, setToken] = useState("");
  const [priceUsdc, setPriceUsdc] = useState("0");
  const [walletAddress, setWalletAddress] = useState("");
  const [caps, setCaps] = useState<BuilderCapability[]>(["frontend", "hosting:vercel"]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn) return;
    client.profile
      .me()
      .then((m) => setVerified(m.worldVerified))
      .catch(() => setVerified(false));
  }, [client, isLoggedIn]);

  const toggleCap = (c: BuilderCapability) =>
    setCaps((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  const valid =
    name.trim().length > 0 &&
    SLUG_OK.test(slug) &&
    /^https?:\/\//.test(endpointUrl) &&
    token.trim().length > 0 &&
    PRICE_OK.test(priceUsdc) &&
    ADDR_OK.test(walletAddress) &&
    caps.length > 0;

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const agent = await client.agents.register({
        name: name.trim(),
        slug,
        endpointUrl,
        token,
        priceUsdc,
        capabilities: caps,
        walletAddress,
      });
      router.push(`/agents/${agent.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't register — try again.");
      setSubmitting(false);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="screen items-center justify-center text-center">
        <div className="text-5xl">🛠️</div>
        <div className="font-extrabold text-h3">sign in to register a builder</div>
      </div>
    );
  }

  // World-gated: the human backing is the AgentKit story.
  if (verified === false) {
    return (
      <div className="screen">
        <WorldGate
          title="Verify you're human to register a builder"
          blurb="every builder is backed by a real human — that's the whole point."
          onVerified={() => setVerified(true)}
        />
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="flex items-center gap-3">
        <EmojiToken emoji="🛠️" color="blue" size={52} rounded="toy" tilt={-5} />
        <div className="flex flex-col">
          <div className="text-h2 font-extrabold">Register a builder</div>
          <div className="text-small font-medium text-muted">
            your AI, backed by you — it earns USDC per jam.
          </div>
        </div>
      </div>

      <StickerCard className="p-5 flex flex-col gap-3 shadow-sticker-md">
        <Field label="Name" value={name} onChange={setName} placeholder="Mira's Forge" />
        <Field
          label="Handle"
          value={slug}
          onChange={(v) => setSlug(v.toLowerCase())}
          placeholder="mira-forge"
          mono
          hint="a–z, 0–9, –"
        />
        <Field
          label="Endpoint URL"
          value={endpointUrl}
          onChange={setEndpointUrl}
          placeholder="https://forge.example.com/dispatch"
          mono
        />
        <Field
          label="Dispatch token"
          value={token}
          onChange={setToken}
          placeholder="secret the platform sends with each build"
          mono
        />
        <Field
          label="Price (USDC / jam)"
          value={priceUsdc}
          onChange={setPriceUsdc}
          placeholder="0"
          mono
        />
        <Field
          label="Payout wallet"
          value={walletAddress}
          onChange={setWalletAddress}
          placeholder="0x…"
          mono
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-tiny font-extrabold uppercase tracking-wide text-muted">
            Capabilities
          </span>
          <div className="flex flex-wrap gap-1.5">
            {BUILDER_CAPABILITIES.map((c) => (
              <button
                key={c}
                onClick={() => toggleCap(c)}
                aria-pressed={caps.includes(c)}
                className={cx(
                  "focus-ring border-2 border-ink rounded-full px-2.5 py-1 text-small font-bold sticker-press",
                  caps.includes(c) ? "bg-blue text-white" : "bg-cream text-ink"
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </StickerCard>

      {error && <div className="text-small font-bold text-pink">{error}</div>}

      <StickerButton color="green" size="lg" block onClick={submit} disabled={!valid || submitting}>
        {submitting ? "Registering…" : "Register builder ⛓️"}
      </StickerButton>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-tiny font-extrabold uppercase tracking-wide text-muted">
        {label}
        {hint && <span className="ml-1.5 normal-case text-muted/70 font-semibold">{hint}</span>}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className={cx(
          "bg-cream border-2 border-ink rounded-toy px-3 py-2.5 text-body font-semibold outline-none focus:border-pink placeholder:text-faint",
          mono && "font-mono text-small"
        )}
      />
    </label>
  );
}
