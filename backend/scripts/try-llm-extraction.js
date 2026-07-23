#!/usr/bin/env node
/**
 * Read-only comparison: regex parser vs. LLM extraction (Groq/Llama) on the same
 * real PDFs. Does NOT touch any live route, the database, or Google Drive.
 *
 * NOTE: parseAES and the /parse-container route now call the LLM path by default
 * in production (see parseAESWithLLM in utils/parseOrderDocs.js and
 * parseContainerInvoiceLLM in routes/expenses.js) — both keep their old regex
 * implementation (parseAESRegex, parseContainerInvoiceRegex) available for this
 * comparison and as an automatic fallback if the LLM call fails. This script
 * still calls the *_Regex versions directly so "regex" always means regex here,
 * and pulls the AES/container prompts from utils/llmExtract.js (the same code
 * the live routes use) so there's one source of truth for those two prompts.
 * Receipt/dispatch aren't wired into production yet — their prompts below are
 * still experimental/local to this script.
 *
 * Usage:
 *   node scripts/try-llm-extraction.js                # runs the built-in sample set
 *   node scripts/try-llm-extraction.js <kind> <file>   # kind = receipt | dispatch | container | aes
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env"), quiet: true });
const fs       = require("fs");
const pdfParse = require("pdf-parse");
const Groq     = require("groq-sdk");
const { parseBuyerReceipt, parseDispatch, parseAESRegex } = require("../utils/parseOrderDocs");
const { extractAESFields, extractContainerInvoiceFields } = require("../utils/llmExtract");

const groq  = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "llama-3.3-70b-versatile";

async function aiJSON(systemPrompt, userContent) {
  const res = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userContent },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });
  return JSON.parse(res.choices[0].message.content);
}

const SCHEMAS = {
  receipt: {
    system:
      "You are a logistics document parser reading a vehicle auction buyer receipt " +
      "(Copart or IAA/IAAI). Return ONLY a JSON object with these exact keys (empty " +
      'string "" if not found): customerName, customerPhone, customerEmail, vin, year, ' +
      "make, model, lotNumber, pickupLocation, pickupAddress, pickupCity, pickupState, pickupZip. " +
      "pickupLocation should be formatted like \"COPART <CITY> <STATE>\" or \"IAAI <BRANCH NAME>\". " +
      "lotNumber must be ONLY the digits from the StockNo field — e.g. from \"StockNo 000-44674966\" " +
      "and a separate \"Sale Item # D-0034\", lotNumber is \"44674966\" (strip the leading \"000-\" " +
      "prefix and any separate sale-item code, do not concatenate them). " +
      "pickupState must always be the 2-letter USPS abbreviation (e.g. \"TX\", never \"Texas\").",
  },
  dispatch: {
    system:
      "You are a logistics document parser reading a vehicle dispatch/towing order or invoice. " +
      "Return ONLY a JSON object with these exact keys (empty string if not found, 0 for towingCost): " +
      "vin, pickupName, pickupAddress, pickupCity, pickupState, pickupZip, " +
      "deliveryName, deliveryAddress, deliveryCity, deliveryState, deliveryZip, " +
      "weightLbs (the raw number as stated in the document, e.g. from \"Max Weight 3,310 lbs\" " +
      "weightLbs is 3310 — copy the number exactly, do NOT convert or calculate units yourself), " +
      "towingCost (the dollar amount the carrier/tow company is paid — look for labels like " +
      "\"Total Price\", \"Carrier Pay\", \"Quoted Rate\", \"Amount Due\", or a flat rate; return just " +
      "the number, no \"$\"), condition (\"Forklift\", \"Nonrunner\", or empty).",
  },
  // "container" and "aes" prompts now live in utils/llmExtract.js (the code the
  // live routes actually call) — see extractWithLLM below.
};

// Fields the LLM is told not to compute itself (unit conversions, rounding) — derived
// deterministically here instead, same as the regex parser, so numeric results match exactly.
function postProcess(kind, result) {
  if (kind === "dispatch" && result.weightLbs) {
    result.weightKgs = Math.round(Number(result.weightLbs) * 0.453592);
  }
  return result;
}

async function extractWithLLM(kind, text) {
  const start = Date.now();
  let result;
  if (kind === "aes")       result = await extractAESFields(text);
  else if (kind === "container") result = await extractContainerInvoiceFields(text);
  else result = await aiJSON(SCHEMAS[kind].system, `Extract from this document:\n\n${text.slice(0, 8000)}`);
  return { result: postProcess(kind, result), ms: Date.now() - start };
}

async function runOne(kind, filePath) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${kind.toUpperCase()}  —  ${filePath}`);
  console.log("=".repeat(70));

  const buffer = fs.readFileSync(filePath);
  const data   = await pdfParse(buffer);
  const text   = data.text || "";

  let regexResult = null;
  try {
    if (kind === "receipt")  regexResult = await parseBuyerReceipt(filePath);
    if (kind === "dispatch") regexResult = await parseDispatch(filePath);
    if (kind === "aes")      regexResult = await parseAESRegex(filePath);
    // "container" has no equivalent in parseOrderDocs.js — its regex logic lives
    // inline in routes/expenses.js parse-container and isn't easily callable standalone,
    // so we only show the LLM side for that kind.
  } catch (e) {
    regexResult = { error: e.message };
  }

  if (regexResult) {
    console.log("\n--- Existing regex parser ---");
    console.log(JSON.stringify(regexResult, null, 2));
  }

  try {
    const { result, ms } = await extractWithLLM(kind, text);
    console.log(`\n--- LLM extraction (Groq/${MODEL}, ${ms}ms) ---`);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.log("\n--- LLM extraction FAILED ---");
    console.log(e.message);
  }
}

const BUILT_IN_SAMPLES = [
  { kind: "receipt",   file: "uploads/6a18901e138f578a6a5dd345/Stock_26696063_45172076.pdf" },
  { kind: "dispatch",  file: "uploads/receipts/1780285677493-660721995.pdf" },
  { kind: "dispatch",  file: "uploads/receipts/1780363836781-196250312.pdf" },
  { kind: "dispatch",  file: "temp/1omOiiTWD2mumjzi5xj_KctSGdoIxTi-E.pdf" },
  { kind: "container", file: "uploads/receipts/1780240200012-130849656.pdf" },
  { kind: "container", file: "uploads/receipts/1780240769238-516803778.pdf" },
  { kind: "aes",       file: "temp/1K-ZP9jNLXyt5nV5C-mhpc5qiHkgcEhvU.pdf" },
  { kind: "aes",       file: "temp/1oZJazP2L0-cT7ZoNAdushelTR3GeP7hD.pdf" },
];

const VALID_KINDS = ["receipt", "dispatch", "container", "aes"];

async function main() {
  const [argKind, argFile] = process.argv.slice(2);
  const jobs = argKind && argFile ? [{ kind: argKind, file: argFile }] : BUILT_IN_SAMPLES;

  if (argKind && !VALID_KINDS.includes(argKind)) {
    console.error(`Unknown kind "${argKind}" — expected one of: ${VALID_KINDS.join(", ")}`);
    process.exit(1);
  }

  for (const { kind, file } of jobs) {
    if (!fs.existsSync(file)) {
      console.log(`\nSKIP — file not found: ${file}`);
      continue;
    }
    await runOne(kind, file);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
