# SKILL art — AI-generated image assets, baked into the bundle

You have a `generate_image` tool: it generates an image from a prompt and writes
it INTO your workspace at the path you give. Files in `assets/` ship with the
app — they're local, fast, and always available (unlike runtime
`sdk.ai.chat({images})` judging or per-user generation, which is slow and
quota'd — bake art at build time whenever it isn't per-user).

```
generate_image({ prompt: "...", path: "assets/bg.jpg" })   → ok, file written
```

## RULES
1. Paths must be `assets/<name>.jpg`. Reference them from code as relative URLs:
   `<img src="./assets/bg.jpg" />`, `style={{ backgroundImage: "url(./assets/bg.jpg)" }}`,
   canvas `drawImage`, or drei `useTexture("./assets/floor.jpg")`.
2. **One style line, reused in EVERY prompt** — consistency is what makes it look
   art-directed, not pasted. Match the immersive **Stage** theme (dark, glowing). Example style line:
   `"vibrant glowing digital art on a deep dark background, neon gradient accents (hot pink / electric blue / mint), soft bloom and depth, cinematic, no text"`
3. Budget: ≤ 4 images per app. One great background beats four mediocre sprites.
   Always say "no text" (generated text renders garbled).
4. Generate images FIRST (each call takes a few seconds), THEN write the code
   that uses them.
5. If the tool returns "unavailable" (image gen not configured), ship WITHOUT
   assets: CSS gradients + emoji. The app must still work and look good — write
   it so a missing `./assets/*` degrades to a gradient, never a broken `<img>`.

## What to generate (in order of payoff)
- A full-screen **background** for the stage/card (`assets/bg.jpg`)
- A **hero/logo image** for the header card (`assets/hero.jpg`)
- **Card art** for collectible/quiz/deck apps (one per category, not per item)
- A **texture** for 3D floors/skyboxes (with skills/game-3d.md)

## QR codes (react-qr-code — also curated)
Render a `sdk.share.link` deep-link as a scannable code (invite walls, "scan to
join"):
```tsx
import QRCode from "react-qr-code";
const { url } = await sdk.share.link({ data: { room } });
<div style={{ background: "#fff", padding: 12, borderRadius: 12 }}>
  <QRCode value={url} size={160} fgColor="#221A33" bgColor="#FFFFFF" />
</div>
```

## Build-time vs runtime images (know the split)
- `generate_image` = **art direction** (bg, sprites, card art): paid once per
  build, instant at runtime, survives IPFS / builder death.
- `sdk.ai.chat({ images })` / `sdk.files.upload` = **per-user runtime content**:
  judging a user's drawing, showing an uploaded photo. Quota'd, seconds-slow.
