# Recipe judge — AI-scored contests (zero-backend)

User submits an artifact (draw on a canvas / snap a photo) → upload it → an AI grades it against
a **rubric you state** → gallery + leaderboard. Uses `sdk.files.upload`, `sdk.ai.chat`,
`sdk.data.collection`/`counter`. Manifest capability: **"ai"**.

## HARD RULES (critical)
1. Judge **artifacts, never people** — grade the drawing/outfit/photo composition, never a
   person's looks/age/identity. Wholesome only.
2. Always show the score **AND** the model's one-line reason (a bare number feels arbitrary).
3. Force a parseable verdict — ask for `"N — reason"` (or JSON), then clamp N to 0–10.
4. AI is quota'd (~25/user/day) — judge once on submit, show a spinner, never loop.
5. The image must be a `sdk.files.upload` URL (server magic-byte checked).

## Pattern (sketch)
```tsx
// 1. get an image: canvas.toDataURL("image/png")  OR  <input type="file" accept="image/*" capture="environment">
// 2. const { url } = await sdk.files.upload(dataUrl);
// 3. const { text } = await sdk.ai.chat(
//      [{ role: "user", content: "Score this drawing of a cat 0-10 for cuteness. Reply 'N — reason'." }],
//      { images: [url] });
// 4. parse "N — reason", clamp 0..10
// 5. await sdk.data.collection("entries").insert({ url, score, reason });
//    await sdk.data.counter("scores").increment(me, score);
// 6. render the gallery (entries.list) + counter("scores").top(10)
```
`<input capture="environment">` opens the phone camera (getUserMedia does NOT work in the
sandbox). For a draw contest, capture pointer events on a `<canvas>` then `toDataURL`.

## Variants
- caption-the-image (text only, no upload) · outfit/food photo · "rate my setup".
