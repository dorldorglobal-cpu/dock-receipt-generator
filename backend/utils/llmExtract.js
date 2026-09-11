// ── LLM-based document field extraction (Groq/Llama) ──────────────────────────
// Prompts here were iterated against real production PDFs in
// backend/scripts/try-llm-extraction.js before being wired into any live route.
// See git history for the commit that introduced this file — revert it to fall
// back to the previous regex-only parsers with zero other code changes needed,
// since both call sites (parseAES in parseOrderDocs.js, /parse-container in
// routes/expenses.js) keep their old regex code path available for comparison
// via that same script.
const Groq = require("groq-sdk");

// qwen/qwen3-32b was removed from Groq — every call 404'd and silently fell
// back to the regex parsers. openai/gpt-oss-120b is a current Groq model.
const MODEL = "openai/gpt-oss-120b";

// Lazy singleton — constructing Groq() throws immediately if GROQ_API_KEY is
// unset, and this module is required at load time by parseOrderDocs.js (used
// by parseDispatch/parseBuyerReceipt too, which don't need Groq at all), so a
// missing key must not be able to crash unrelated parsers on require().
let _groq = null;
function getGroq() {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groq;
}

async function aiJSON(systemPrompt, userContent) {
  const res = await getGroq().chat.completions.create({
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

const AES_SYSTEM_PROMPT =
  "You are a logistics document parser reading a US AES/ACE Electronic Export Information (EEI) " +
  "filing for a vehicle export. Return ONLY a JSON object with these exact keys (empty string if not found):\n" +
  "- bookingNumber: from the field labeled \"TRANSPORTATION REFERENCE NO.\" (format like \"S3-29596609\")\n" +
  "- referenceNumber: from the field labeled \"SHIPMENT REFERENCE NO.\"\n" +
  "- exporterName, exporterAddress, exporterCity, exporterState, exporterZip\n" +
  "- consigneeName, consigneeAddress, consigneeCity\n" +
  "- vessel: the ship name from the field labeled \"9. EXPORTING CARRIER/CONVEYANCE NAME\" " +
  "(e.g. \"GRANDE ABIDJAN\", \"GLOVIS SUN\") — it sits on the line directly under that label\n" +
  "- portOfLoading, portOfDischarge: JUST the port city name (e.g. \"BALTIMORE\", \"TEMA\") — no " +
  "state, country, or extra text\n" +
  "- vin: EXACTLY 17 characters (letters and digits, no I/O/Q) — no more, no fewer\n" +
  "- year, make, model: from the vehicle description line (e.g. \"2019 BENZ SPRINTER 2500\")\n" +
  "- weightKgs: the shipping weight in KG from the \"SHIPPING WEIGHT (KG)\" column\n" +
  "- value: the customs-declared VALUE in US dollars from the \"g. VALUE\" column\n" +
  "\n" +
  "IMPORTANT — the commodity line sometimes jams the unit count, weight, and VIN together with no " +
  "spaces, and the VALUE appears as a separate number 1-2 lines below (often right before " +
  "\"Sensitive Information\"). The VIN is always the LAST 17 characters of the jammed run (it can " +
  "itself start with a digit) — whatever digits remain before it are the weight. Worked examples:\n" +
  "  \"1 NO2620WD4PF1CD5KP129370\\n/ 136613453 / FL\\n8500\"\n" +
  "    -> weightKgs=\"2620\", vin=\"WD4PF1CD5KP129370\", value=\"8500\"\n" +
  "  \"1 NO12701HGCR2F76GA030399\\n/ MI0029805656 / MI\\n3750\"\n" +
  "    -> weightKgs=\"1270\", vin=\"1HGCR2F76GA030399\", value=\"3750\"\n";

async function extractAESFields(text) {
  return aiJSON(AES_SYSTEM_PROMPT, `Extract from this document:\n\n${text.slice(0, 8000)}`);
}

const CONTAINER_SYSTEM_PROMPT =
  "You are a logistics document parser reading a container-loading or freight-forwarder " +
  "invoice (e.g. Savannah Auto Export, E-Z Cargo, iShip, Cedars). Return ONLY a JSON object " +
  "with keys: vendor, invoiceNumber, billDate, container, booking, total (number), and " +
  "rows (array of { vin, year, make, model, lineTotal, extraCharge } — one per vehicle on " +
  "the invoice).\n" +
  "- lineTotal (number, 0 if not itemized separately): only set this when the invoice prices " +
  "EACH vehicle on its own line (e.g. iShip-style). Most container invoices instead pool " +
  "freight/loading costs for the whole container with no per-vehicle price — leave lineTotal " +
  "0 for those.\n" +
  "- extraCharge (number, 0 if none): a charge that applies to only THIS ONE vehicle, on top " +
  "of the shared/pooled charges — storage, detention, demurrage, or a late fee tied to a " +
  "specific VIN. These often appear as their own line or section (e.g. \"Storage Fee\") that " +
  "names or partially matches one VIN, sometimes on a later page of the same document, not " +
  "necessarily right next to that vehicle's other data. Match it to the row for that VIN.\n" +
  "\n" +
  "IMPORTANT — the extraction sometimes jams the quantity, unit price, and amount of a " +
  "per-vehicle charge together with no spaces or newlines. The amount is the LAST 2-decimal " +
  "number in the jammed run; whatever comes before it splits into quantity then unit price, " +
  "also each ending in 2 decimals. Worked example:\n" +
  "  \"2022 Tucson VIN: 099257 received 03/27/26 shipped 07/29/26 - 12565.005.00325.00\\n" +
  "days / 60 days free\"\n" +
  "    -> this is a storage charge of 125 days minus 60 free = 65.00 billable days at 5.00/day " +
  "= 325.00 amount, for the vehicle whose VIN ends in 099257 -> extraCharge=325.00 on that " +
  "row (do not also add it to that vehicle's lineTotal or to any other vehicle).";

async function extractContainerInvoiceFields(text) {
  return aiJSON(CONTAINER_SYSTEM_PROMPT, `Extract from this document:\n\n${text.slice(0, 8000)}`);
}

module.exports = { extractAESFields, extractContainerInvoiceFields };
