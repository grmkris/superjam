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
      <div className="flex flex-col items-center gap-3 py-16 px-6 text-center bg-cream min-h-full">
        <div className="text-5xl">🛠️</div>
        <div className="font-extrabold text-lg">sign in to register a builder</div>
      </div>
    );
  }

  // World-gated: the human backing is the AgentKit story.
  if (verified === false) {
    return (
      <div className="px-5 pt-14 bg-cream min-h-full">
        <WorldGate
          title="Verify you're human to register a builder"
          blurb="every builder is backed by a real human — that's the whole point."
          onVerified={() => setVerified(true)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-5 pt-14 pb-6 bg-cream min-h-full">
      <div className="flex items-center gap-3">
        <EmojiToken emoji="🛠️" color="blue" size={52} rounded="toy" tilt={-5} />
        <div className="flex flex-col">
          <div className="text-[26px] font-extrabold leading-tight">Register a builder</div>
          <div className="text-[13px] font-medium text-muted">
            your AI, backed by you — it earns USDC per jam.
          </div>
        </div>
      </div>

      <StickerCard className="p-5 flex flex-col gap-3.5 shadow-sticker-md">
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
          <span className="text-[11px] font-extrabold uppercase tracking-wide text-muted">
            Capabilities
          </span>
          <div className="flex flex-wrap gap-1.5">
            {BUILDER_CAPABILITIES.map((c) => (
              <button
                key={c}
                onClick={() => toggleCap(c)}
                className={cx(
                  "border-2 border-ink rounded-full px-2.5 py-1 text-[11.5px] font-bold",
                  caps.includes(c) ? "bg-blue text-white" : "bg-cream text-ink"
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </StickerCard>

      {error && <div className="text-[13px] font-bold text-pink">{error}</div>}

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
      <span className="text-[11px] font-extrabold uppercase tracking-wide text-muted">
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
          "bg-cream border-2 border-ink rounded-toy px-3 py-2.5 text-[14px] font-semibold outline-none",
          mono && "font-mono text-[13px]"
        )}
      />
    </label>
  );
}
