// Vehicle title OCR — reads a photo (or photos) of a US vehicle title /
// salvage certificate via Claude's vision (Anthropic API), and picks the
// correct AES USPPI (exporterName/exporterAddress on Order) from the
// title's assignment chain per Eli's filing rule:
//
//   1. Walk the title's chain of custody backward from the most recent
//      party: registered owner ("seller"), then buyer #1, buyer #2, ... as
//      filled in on any reassignment block (front or back of the title).
//   2. Use the LAST (most recent) party in that chain who has a genuine
//      USA address as the USPPI.
//   3. If there is no buyer at all (title never reassigned), USPPI = the
//      registered owner (seller).
//   4. Exception — if the very last party in the chain is FOREIGN:
//        - At FREEPORT: USPPI name = that foreign buyer's name, but the
//          ADDRESS used is DDG's own agent address (power of attorney).
//        - At every other port: fall back and keep walking backward to the
//          previous party with a USA address (seller, or an earlier buyer).
//
// Confirmed empirically against real filed orders (2026-09): 43 of 49
// Freeport orders used DDG's own agent address (23 Galahad Dr, Manalapan,
// NJ) paired with a foreign buyer's name; a Baltimore order with a foreign
// buyer (BAFSA GLOBAL VENTURES, Nigeria) fell back to the seller (GEICO);
// a Jacksonville order with two domestic reassignments (Peddle LLC ->
// Boacon Autos) used the LAST domestic buyer (Boacon Autos).

const Anthropic = require("@anthropic-ai/sdk");
const heicConvert = require("heic-convert");

const MODEL = "claude-sonnet-5";
let _client = null;
function getClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","PR",
]);

// ── Image prep ────────────────────────────────────────────────────────────
// Claude's vision accepts jpeg/png/gif/webp — not HEIC/HEIF, which is what
// iPhones save title photos as by default. Convert those; pass everything
// else through as-is.
async function toVisionImage(buffer, mimetype, filename) {
  const name = (filename || "").toLowerCase();
  const isHeic = /image\/hei[cf]/i.test(mimetype || "") || /\.hei[cf]$/i.test(name);
  if (isHeic) {
    const out = await heicConvert({ buffer, format: "JPEG", quality: 0.85 });
    return { base64: Buffer.from(out).toString("base64"), mime: "image/jpeg" };
  }
  const mime = /^image\//.test(mimetype || "") ? mimetype : "image/jpeg";
  return { base64: buffer.toString("base64"), mime };
}

const SYSTEM_PROMPT = `You are reading a photo of a US vehicle Certificate of Title or Certificate of Salvage. Return ONLY a JSON object, no prose, with this exact shape:

{
  "titleNumber": "",
  "titleState": "",
  "vin": "",
  "registeredOwner": { "name": "", "address": "", "city": "", "state": "", "zip": "" },
  "buyers": [
    { "name": "", "address": "", "city": "", "state": "", "zip": "", "country": "" }
  ]
}

Rules:
- titleState: the 2-letter US state that ISSUED the title (top of the document), not a party's state.
- registeredOwner: the "Name(s) and Address of Registered Owner(s)" (or "Owner" on a salvage certificate) printed at the top of the front of the title. This is the SELLER.
- buyers: one entry per filled-in "Transfer of Title", "Assignment of Ownership", or "Dealer Reassignment" block — there may be one on the front and one or more stacked on the back. List them in the order they appear top-to-bottom, i.e. chronological order. Look for labels like "Purchaser's Name", "Name(s) of Buyer(s)", "Purchaser Print Name". Skip any reassignment block that is blank/unused. If NO reassignment block is filled in at all, return an empty buyers array.
- Buyer addresses are sometimes handwritten and don't fit neatly into address/city/state/zip boxes (e.g. a foreign address crammed across several boxes, like a Nigerian or Ghanaian city and country written where "City/State" is printed). Do your best to split it into address/city/state/zip as written, but ALSO set "country" for that buyer:
  - If the address is clearly a normal US address (a real 2-letter state + 5-digit zip), set country to "UNITED STATES" and leave state as the 2-letter code.
  - If the address is clearly foreign (mentions a country name, or a city/region that isn't a US state, or has no recognizable US zip), set country to that country's name in English (e.g. "NIGERIA", "GHANA", "TOGO", "BENIN"), and leave "state" empty or as whatever was actually written (do not force it into a fake 2-letter code).
- vin: the Vehicle Identification Number printed on the title (for cross-checking against our records) — exactly as printed, do not guess characters you can't read.
- Use "" for any field you cannot read or that is not present. Never fabricate a value.
- If multiple photos are provided, treat them as pages of the SAME title (e.g. front + back) and combine everything into one answer.`;

// Claude doesn't force JSON-only output the way OpenAI's response_format
// does — it reliably returns bare JSON when instructed to, but defensively
// strip a markdown code fence or leading/trailing prose if it ever adds one.
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  try { return JSON.parse(candidate); } catch { /* fall through */ }
  const braceMatch = candidate.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch { /* fall through */ }
  }
  throw new Error("Claude returned invalid JSON");
}

async function extractTitleFields(files) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — title OCR is unavailable.");
  }
  if (!files?.length) throw new Error("No title images provided");

  const images = [];
  for (const f of files) {
    const { base64, mime } = await toVisionImage(f.buffer, f.mimetype, f.filename);
    images.push({ type: "image", source: { type: "base64", media_type: mime, data: base64 } });
  }

  let response;
  try {
    response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            ...images,
            { type: "text", text: `Extract this title. ${images.length > 1 ? `${images.length} photos provided — they are pages of the same title.` : ""}` },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error("Claude API key is invalid — check ANTHROPIC_API_KEY.");
    if (err instanceof Anthropic.RateLimitError) throw new Error("Claude rate-limited the request — try again shortly.");
    if (err instanceof Anthropic.APIError) throw new Error(`Claude vision request failed (${err.status}): ${err.message}`);
    throw err;
  }

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to read this image — try a clearer photo.");
  }

  const raw = response.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
  if (!raw) throw new Error("Claude returned no content");

  const parsed = extractJson(raw);

  return {
    titleNumber: String(parsed.titleNumber || "").trim(),
    titleState: String(parsed.titleState || "").trim().toUpperCase().slice(0, 2),
    vin: String(parsed.vin || "").trim().toUpperCase(),
    registeredOwner: normalizeParty(parsed.registeredOwner),
    buyers: (Array.isArray(parsed.buyers) ? parsed.buyers : []).map(normalizeParty).filter(p => p.name || p.address),
  };
}

function normalizeParty(p) {
  p = p || {};
  return {
    name:    String(p.name || "").trim().toUpperCase(),
    address: String(p.address || "").trim().toUpperCase(),
    city:    String(p.city || "").trim().toUpperCase(),
    state:   String(p.state || "").trim().toUpperCase().slice(0, 20),
    zip:     String(p.zip || "").trim(),
    country: String(p.country || "").trim().toUpperCase(),
  };
}

function isUsParty(p) {
  if (!p) return false;
  if (p.country && p.country !== "UNITED STATES" && p.country !== "USA" && p.country !== "US") return false;
  if (p.state && p.state.length === 2 && US_STATES.has(p.state)) return true;
  // No usable state code and no explicit non-US country — treat as unknown/US
  // only if a country was explicitly confirmed US; otherwise be conservative
  // and call it non-US so a human reviews it rather than silently filing a
  // bad address.
  return p.country === "UNITED STATES" || p.country === "USA" || p.country === "US";
}

// Loose "same company" check — uppercase, strip punctuation, see if one
// contains the other. Good enough for a UI hint, not meant to be exact.
function looksLikeSameName(a, b) {
  const norm = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// Business rule described above. `ddgAgent` = AesConfig.forwardingAgent
// ({ name, address1, address2, city, state, country, postal }). `orderCustomerName`
// = the order's own customerName, already captured cleanly (typed, not
// handwritten) off the buyer receipt when the order was created — in the
// Freeport/POA case the foreign buyer on the title IS almost always this
// same customer, so prefer that known-good spelling over OCR'ing their name
// off a handwritten reassignment block. The title's own name is still
// returned as titleName so a mismatch is visible in review.
function pickUsppi({ registeredOwner, buyers }, { isFreeport, ddgAgent, orderCustomerName }) {
  const chain = buyers || [];

  for (let i = chain.length - 1; i >= 0; i--) {
    const b = chain[i];
    const isLast = i === chain.length - 1;

    if (isUsParty(b)) {
      return {
        name: b.name, address: b.address, city: b.city, state: b.state, zip: b.zip,
        country: "UNITED STATES",
        source: `buyer${i + 1}`,
        reason: `Using buyer #${i + 1} (${b.name || "unnamed"}) — last domestic-US party on the title.`,
      };
    }

    if (isLast && isFreeport) {
      const nameMatches = looksLikeSameName(b.name, orderCustomerName);
      // Prefer the order's own (typed, already-verified) customerName over the
      // OCR'd handwritten name — UNLESS they clearly don't match, in which case
      // trust the title itself and just flag it for a human to double-check
      // (could be a broker/different entity, or the wrong title uploaded).
      const preferCustomer = !!orderCustomerName && (nameMatches || !b.name);
      const usedName = preferCustomer ? orderCustomerName : (b.name || orderCustomerName || "");
      const mismatch = !!(orderCustomerName && b.name && !nameMatches);
      return {
        name: usedName,
        titleName: b.name || "",
        nameMismatch: mismatch,
        address: [ddgAgent?.address1, ddgAgent?.address2].filter(Boolean).join(" "),
        city: ddgAgent?.city || "", state: ddgAgent?.state || "", zip: ddgAgent?.postal || "",
        country: "UNITED STATES",
        source: "poa-freeport",
        reason: mismatch
          ? `Buyer is foreign and POL is Freeport — using our own address (POA), but the title's buyer name ("${b.name}") doesn't look like this order's customer ("${orderCustomerName}") — double-check which is right.`
          : preferCustomer
          ? `Buyer is foreign and POL is Freeport — using the order's customer name (${orderCustomerName}) with our own address (POA), since that's already clean typed data rather than OCR off handwriting.`
          : `Buyer (${b.name || "unnamed"}) is foreign and POL is Freeport — using buyer's name with our own address (POA).`,
      };
    }
    // foreign and not the Freeport case: keep walking backward
  }

  const o = registeredOwner || {};
  return {
    name: o.name, address: o.address, city: o.city, state: o.state, zip: o.zip,
    country: "UNITED STATES",
    source: "seller",
    reason: chain.length
      ? "Every buyer on the title is foreign and this isn't a Freeport shipment — falling back to the seller."
      : "No buyer/reassignment found on the title — using the registered owner (seller).",
  };
}

module.exports = { extractTitleFields, pickUsppi, isUsParty };
