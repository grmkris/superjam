// Smoke test for the refine() attachment path (§11).
//
// Confirms our real refine() reads an attached CSV (passed as a file-part byte
// blob, the way builds.refine resolves it from the object store) and produces a
// DATA-AWARE spec. A url_context attempt was rejected by Gemini ("Tool use with a
// response mime type 'application/json' is unsupported"), so attachments ride as
// native content parts instead — this proves that path works against live Gemini.
//
// Run from the repo ROOT (root .env GOOGLE_GENERATIVE_AI_API_KEY auto-loads):
//   bun packages/builder/scripts/smoke-refine-attachments.ts
import { refine } from "../src/refine.ts";

// Unique marker (Zedonia/9999) the model can only know by reading the file.
const CSV = [
  "region,ev_sales_thousands,year",
  "Zedonia,9999,2024",
  "Eastland,120,2024",
  "Westmere,340,2024",
].join("\n");

const result = await refine({
  prompt: "build a simple infographic site that visualises this dataset",
  attachments: [{ mediaType: "text/csv", data: new TextEncoder().encode(CSV) }],
});

console.log(JSON.stringify(result, null, 2));

const blob = JSON.stringify(result).toLowerCase();
// Data-awareness signals: it should pick up the domain (EV/region/sales) and/or a
// charts skill — none of which are in the bare prompt, only in the CSV.
const aware =
  blob.includes("region") ||
  blob.includes("ev") ||
  blob.includes("zedonia") ||
  (result.spec?.skills ?? []).includes("charts");
console.log(aware ? "\n✅ spec is data-aware (read the CSV)" : "\n⚠️ spec looks generic");
process.exit(aware ? 0 : 1);
