// Read the text of a PDF that has no text layer — e.g. an AES "View EEI" page printed
// from the CBP website as a picture. Claude reads the PDF directly and transcribes it;
// the normal parsers then work on that text exactly as they would on a real text PDF.
// Needs ANTHROPIC_API_KEY (same key as title OCR).

const Anthropic = require("@anthropic-ai/sdk");

const MODEL = "claude-opus-5-5";
let _client = null;
const client = () => (_client ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

const PROMPT =
  "Transcribe all of the text in this document exactly as printed, page by page, top to bottom. " +
  "Keep every field label together with its value (e.g. \"3. TRANSPORTATION REFERENCE NO.\" followed by its value " +
  "on the next line), keep table rows on one line with their columns in order, and copy numbers, VINs, ITNs and codes " +
  "character for character. Output only the transcribed text — no commentary, no markdown.";

/** @param {Buffer} buffer PDF bytes  @returns {Promise<string>} transcribed text */
async function ocrPdfText(buffer) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set — can't read picture-only PDFs.");
  let response;
  try {
    response = await client().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low" },                 // plain transcription — no deep reasoning needed
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",                             // if a safety check declines, the API retries on a fallback model
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") } },
          { type: "text", text: PROMPT },
        ],
      }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error("Claude API key is invalid — check ANTHROPIC_API_KEY.");
    if (err instanceof Anthropic.RateLimitError) throw new Error("Claude rate-limited the request — try again shortly.");
    if (err instanceof Anthropic.APIError) throw new Error(`Claude PDF read failed (${err.status}): ${err.message}`);
    throw err;
  }
  if (response.stop_reason === "refusal") throw new Error("Claude declined to read this PDF.");
  return response.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
}

module.exports = { ocrPdfText };
