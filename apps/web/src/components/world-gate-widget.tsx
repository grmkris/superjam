"use client";

// The idkit v4 widget, isolated in its own module so it can be loaded via
// next/dynamic({ ssr:false }) from world-gate.tsx — idkit-core runs on WASM
// (idkit_wasm_bg.wasm), which must instantiate in the BROWSER only, never during
// SSR/prerender. All @worldcoin/idkit imports live here for that reason.
import {
  IDKitRequestWidget,
  proofOfHuman,
  type IDKitResult,
} from "@worldcoin/idkit";

export interface WorldGateWidgetProps {
  appId: string;
  action: string;
  rpContext: {
    rp_id: string;
    nonce: string;
    created_at: number;
    expires_at: number;
    signature: string;
  };
  environment: "staging" | "production";
  allowLegacyProofs: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResult: (result: IDKitResult) => void;
  onError: (code: string) => void;
}

export default function WorldGateWidget({
  appId,
  action,
  rpContext,
  environment,
  allowLegacyProofs,
  open,
  onOpenChange,
  onResult,
  onError,
}: WorldGateWidgetProps) {
  return (
    <IDKitRequestWidget
      app_id={appId as `app_${string}`}
      action={action}
      rp_context={rpContext}
      allow_legacy_proofs={allowLegacyProofs}
      environment={environment}
      preset={proofOfHuman()}
      open={open}
      onOpenChange={onOpenChange}
      onSuccess={onResult}
      onError={(code) => onError(String(code))}
    />
  );
}
