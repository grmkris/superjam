// Build-time asset generation for the autonomous builder — IMAGE + VOICE, baked
// into the jam at build time (sprites, backgrounds, a logo, fixed narration/jingle).
// Both ride the SAME Google key the platform already uses for refine, so no new
// provider/key: image via gemini-2.5-flash-image, voice via gemini-2.5-flash-preview-tts.
// These run IN the builder process (exposed to the agent as in-process MCP tools),
// so the key never touches the app workspace or the deployed bundle.
const API = "https://generativelanguage.googleapis.com/v1beta/models";

const IMAGE_MODEL = "gemini-2.5-flash-image";
const TTS_MODEL = "gemini-2.5-flash-preview-tts";

interface InlinePart {
  inlineData?: { mimeType: string; data: string };
}
interface GenResponse {
  candidates?: { content?: { parts?: InlinePart[] } }[];
  error?: { code: number; message: string };
}

const call = async (model: string, key: string, body: unknown): Promise<GenResponse> => {
  const res = await fetch(`${API}/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as GenResponse;
  if (!res.ok || json.error) {
    throw new Error(`${model}: ${json.error?.message ?? res.status}`);
  }
  return json;
};

const firstInline = (json: GenResponse): { mimeType: string; data: string } => {
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!part) throw new Error("response carried no inline media");
  return part;
};

/** Generate a PNG from a prompt (gemini-2.5-flash-image). Returns the raw bytes. */
export const generateImage = async (prompt: string, key: string): Promise<Uint8Array> => {
  const json = await call(IMAGE_MODEL, key, {
    contents: [{ parts: [{ text: prompt }] }],
  });
  const { data } = firstInline(json);
  return Buffer.from(data, "base64");
};

/** Wrap raw little-endian PCM (mono, 16-bit) in a minimal WAV container. */
const wavFromPcm = (pcm: Uint8Array, sampleRate: number): Uint8Array => {
  const channels = 1;
  const bits = 16;
  const blockAlign = (channels * bits) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

/**
 * Generate speech from text (gemini-2.5-flash-preview-tts) and return a playable
 * WAV. The model returns raw L16 PCM (rate in the mimeType, usually 24000) — we
 * parse the rate and wrap it. `voice` is a Gemini prebuilt voice name (e.g. Kore).
 */
export const generateVoice = async (
  text: string,
  key: string,
  voice = "Kore"
): Promise<Uint8Array> => {
  const json = await call(TTS_MODEL, key, {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  });
  const { mimeType, data } = firstInline(json);
  const rate = Number(/rate=(\d+)/.exec(mimeType)?.[1] ?? 24000);
  return wavFromPcm(Buffer.from(data, "base64"), rate);
};
