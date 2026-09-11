/**
 * Build a CBP AES WebLink Submission from an Order + AesConfig.
 *
 * Field names follow the "AESDirect WebLink Submission API" spec (v1.1, May 2023)
 * cross-checked against CBP's published sample form (aesdirect weblink.txt,
 * Sep 2023). Notable encodings confirmed from the sample:
 *   - EDA  = YYMMDD
 *   - POE  = 4-digit Schedule D, POU = 5-digit Schedule K, COD = ISO alpha-2
 *   - MOT  = 10 (vessel, non-containerized / RORO) | 11 (vessel, containerized)
 *   - party ID type for an EIN = "E"
 *   - line-item fields are IT{line}_{n}  (line 1 → IT1_1 … IT1_21, isLine1=Y)
 *   - equipment fields are EQ1 / SN1
 *
 * This module never submits anything. The POST to CBP is made by the user's
 * browser (a real <form> submit) while they are logged into ACE AESDirect.
 *
 * Cross-checked against order 14217's accepted filing, then against a bulk
 * scan of 307 real accepted EEIs (saved AES PDFs, 2025–2026):
 *   - DDG files as the AUTHORIZED/FORWARDING AGENT (AD3_*), not the USPPI.
 *     The USPPI (AD0_*) is the vehicle's seller of record and comes from the
 *     order (exporterName/exporterAddress/... + usppiEin), not AesConfig.
 *   - IT1_21 (foreign/domestic origin) = "D" in all 307 filings — it describes
 *     the export, not the country of manufacture.
 *   - IT1_1 (export info code) = "OS" in all 307. IBT (in-bond) = "70" in all
 *     307. FO (filing option) = "2 - PREDEPARTURE" in all 307.
 *   - IT1_13 (Schedule B) = "8703.60.0045" in 303/307 — the near-universal
 *     default for a used passenger vehicle, regardless of engine type.
 *   - AD1_14 (ultimate consignee type) = "O" in 306/307.
 *   - SCAC tracks the destination PORT far more reliably than the nominal
 *     "shipping line" name (multiple ocean carriers service the same RORO
 *     consolidator route) — see SCAC_BY_POD in aesCodes.js.
 *   - IT1_12 (commodity description) is just "YEAR MAKE MODEL", no filler text.
 */

const aesCodes = require("./aesCodes");

const TEST_URL = "https://trade-test.cbp.dhs.gov/ace/aes/aesdirect-ui/secured/createWeblinkFiling";
const PROD_URL = "https://trade.cbp.dhs.gov/ace/aes/aesdirect-ui/secured/createWeblinkFiling";

const s = (v) => (v === undefined || v === null ? "" : String(v).trim());
const digits = (v) => s(v).replace(/\D/g, "");
const intStr = (v) => {
  const n = Math.round(Number(s(v).replace(/[^0-9.\-]/g, "")));
  return Number.isFinite(n) && n !== 0 ? String(n) : "";
};

// Any reasonable date string → YYMMDD ("" if unparseable)
function yymmdd(v) {
  const str = s(v);
  if (!str) return "";
  let d;
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const sl = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (iso) d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  else if (sl) d = new Date(Number(sl[3].length === 2 ? "20" + sl[3] : sl[3]), Number(sl[1]) - 1, Number(sl[2]));
  else { const t = Date.parse(str); if (!Number.isNaN(t)) d = new Date(t); }
  if (!d || Number.isNaN(d.getTime())) return "";
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return yy + mm + dd;
}

function effectiveEnv(config) {
  return process.env.AES_ENV || (config && config.aesEnv) || "test";
}

/**
 * @returns {{ actionUrl, fields, missing, warnings, meta }}
 *   fields   — { <WebLink field name>: <string> }  (empty strings omitted)
 *   missing  — [{ field, label, reason }]  required data not present
 *   warnings — [{ field, label, note }]    present but worth a human check
 *   meta     — { srn, env }
 */
function buildWeblinkFiling(order, config, opts = {}) {
  order = order || {};
  config = config || {};
  const env = effectiveEnv(config);
  const actionUrl = env === "prod" ? PROD_URL : TEST_URL;
  const baseUrl = s(opts.baseUrl || process.env.PUBLIC_BACKEND_URL || process.env.RENDER_EXTERNAL_URL).replace(/\/$/, "");

  const srn = s(opts.srn || (order.aesFiling && order.aesFiling.srn) ||
    (s(config.srnPrefix) + s(order.refNumber))); // default prefix "" — SRN = bare order number
  const returnToken = s(opts.returnToken || (order.aesFiling && order.aesFiling.returnToken));

  const fields = {};
  const missing = [];
  const warnings = [];
  const put = (k, v) => { const val = s(v); if (val !== "") fields[k] = val; };
  const req = (k, v, label, reason) => {
    const val = s(v);
    if (val === "") missing.push({ field: k, label, reason: reason || "required" });
    else fields[k] = val;
    return val;
  };
  const warn = (k, label, note) => warnings.push({ field: k, label, note });

  // ── System ────────────────────────────────────────────────────────────────
  if (baseUrl && returnToken) {
    const q = `o=${encodeURIComponent(s(order._id))}&t=${encodeURIComponent(returnToken)}`;
    put("wl_success_url", `${baseUrl}/api/aes/weblink-return?ok=1&${q}`);
    put("wl_nosed_url", `${baseUrl}/api/aes/weblink-return?ok=0&${q}`);
  } else {
    warn("wl_success_url", "Return URL", "PUBLIC_BACKEND_URL not set / no return token — ITN won't post back automatically");
  }
  req("EMAIL", config.responseEmail, "AES response email", "set it on the AES Settings page");

  // ── General ───────────────────────────────────────────────────────────────
  // State of origin (ST) IS the USPPI's state — confirmed from real filings
  // (order 14217: both "6. STATE OF ORIGIN" and the USPPI address read "OH").
  // Computed once and reused for both AD0_7 and ST below so they can never
  // disagree, no matter which fallback tier ends up supplying it.
  const originState =
    aesCodes.stateAbbr(order.exporterState) ||
    aesCodes.stateAbbr(order.pickupState) ||
    aesCodes.stateAbbr(config.defaultStateOfOrigin);

  put("SRN", srn);
  req("BN", order.bookingNumber, "Booking number");
  put("FAC", (order.aesFiling && order.aesFiling.status === "accepted") ? "R" : (config.defaultFilingAction || "A"));
  req("FO", config.defaultFilingOption, "Filing option", "set it on the AES Settings page");
  req("FT", config.defaultFilingType, "AEI filing type", "set it on the AES Settings page");
  req("ST", originState, "U.S. state of origin", "USPPI (exporter) state, or pickup/warehouse state");
  req("POE", aesCodes.scheduleD(order.pol), "Port of export (Schedule D)",
    `no code for POL "${s(order.pol) || "—"}" in aesCodes.js`);
  const dest = s(order.consigneeCountry) || "";
  req("COD", aesCodes.countryIso(dest || order.pod), "Country of ultimate destination",
    `no ISO code for "${dest || s(order.pod) || "—"}"`);
  req("POU", aesCodes.scheduleK(order.pod), "Port of unlading (Schedule K)",
    `no code for POD "${s(order.pod) || "—"}" in aesCodes.js`);
  req("EDA", yymmdd(order.sailDate || order.cutoffDate), "Estimated date of export", "order sail / cutoff date");
  put("MOT", aesCodes.motFor(order.requestType));
  const scacByPod = aesCodes.scacForPod(order.pod);
  const scacDefault = scacByPod || aesCodes.scac(order.shippingLine);
  req("SCAC", s(order.aesScac) || scacDefault, "Carrier SCAC",
    `no SCAC for POD "${s(order.pod) || "—"}" or line "${s(order.shippingLine) || "—"}" in aesCodes.js`);
  if (!order.aesScac && scacByPod) warn("SCAC", "Carrier SCAC", `defaulted to "${scacByPod}" — the most common carrier for this port historically, but varies by sailing; confirm against this booking's carrier`);
  req("VN", order.vessel, "Conveyance / vessel name");
  put("RCC", config.relatedParty || "N");
  put("HAZ", config.hazmat || "N");
  put("RT", config.routedExport || "N");
  put("IBT", config.defaultInBondCode || "70"); // 70 = merchandise not shipped in-bond
  if ((fields.FAC === "R") && order.aesFiling && order.aesFiling.itn) put("ORIG_ITN", order.aesFiling.itn);

  // ── USPPI (party type E) — the vehicle's seller of record. Comes from the
  // ORDER first (exporterName/exporterAddress/...usppiEin — usually captured
  // off the buyer receipt / a past AES PDF), falling back to AesConfig's
  // usppi* fields only for the rare case DDG itself is the USPPI. Contact
  // name/phone stay DDG's own (config) — that's who's actually filing. ──────
  req("AD0_1", order.exporterName || config.usppiName, "USPPI name", "add it on the filing screen, or set a fallback in AES Settings");
  req("AD0_2", digits(order.usppiEin) || digits(config.usppiEin), "USPPI EIN", "add it on the filing screen, or set a fallback in AES Settings");
  put("AD0_3", config.usppiIdType || "E");
  req("AD0_4", order.exporterAddress || config.usppiAddress1, "USPPI address", "add it on the filing screen, or set a fallback in AES Settings");
  put("AD0_5", config.usppiAddress2);
  req("AD0_6", order.exporterCity || config.usppiCity, "USPPI city", "add it on the filing screen, or set a fallback in AES Settings");
  req("AD0_7", originState, "USPPI state", "same as ST — add it on the filing screen, or set the AES Settings fallback state of origin");
  req("AD0_8", order.exporterZip || config.usppiZip, "USPPI ZIP", "add it on the filing screen, or set a fallback in AES Settings");
  // A person AT the USPPI, not DDG — confirmed from a live ACE filing screen
  // (order 14217: "Pablo Cejas" at State Farm Mutual, not DDG's own contact).
  // Falls back to AesConfig's usppiContact* (DDG's own contact) when unknown.
  req("AD0_9", order.usppiContactFirst || config.usppiContactFirst, "USPPI contact first name", "add it on the filing screen, or set a fallback in AES Settings");
  req("AD0_11", order.usppiContactLast || config.usppiContactLast, "USPPI contact last name", "add it on the filing screen, or set a fallback in AES Settings");
  req("AD0_12", digits(order.usppiContactPhone) || digits(config.usppiPhone), "USPPI contact phone", "add it on the filing screen, or set a fallback in AES Settings");

  // ── Ultimate consignee (party type C) ────────────────────────────────────
  req("AD1_3", order.consigneeName, "Ultimate consignee name");
  put("AD1_5", s(order.contactName) || s(order.consigneeName));
  put("AD1_6", "N"); // sold en route
  const consPhone = digits(order.customerPhone);
  if (consPhone) put("AD1_7", consPhone); else warn("AD1_7", "Consignee phone", "no phone on the order");
  req("AD1_8", order.consigneeAddress, "Ultimate consignee address");
  put("AD1_9", "");
  req("AD1_10", order.consigneeCity, "Ultimate consignee city");
  put("AD1_11", order.consigneeState); // optional for foreign
  put("AD1_12", aesCodes.countryIso(dest || order.pod));
  put("AD1_13", order.consigneeZip);   // optional for foreign
  req("AD1_14", config.ultConsigneeType, "Ultimate consignee type", "set a default on the AES Settings page (D/R/G/O)");

  // ── Forwarding agent (party type F) — only when configured ───────────────
  const fa = config.forwardingAgent || {};
  if (s(fa.name)) {
    put("AD3_2", fa.idType || "E");
    put("AD3_3", fa.name);
    put("AD3_4", digits(fa.partyId));
    put("AD3_5", fa.contact);
    put("AD3_7", digits(fa.phone));
    put("AD3_8", fa.address1);
    put("AD3_9", fa.address2);
    put("AD3_10", fa.city);
    put("AD3_11", fa.state);
    put("AD3_12", fa.country);
    put("AD3_13", fa.postal);
  }

  // ── Line item 1 — the vehicle ───────────────────────────────────────────
  put("isLine1", "Y");
  put("IT1_1", s(order.exportInfoCode) || config.defaultExportInfoCode || "OS");
  req("IT1_2", intStr(order.value), "Value of goods (USD)");
  put("IT1_3", "NO");   // unit of measure 1 = number  (VERIFY for the Schedule B used)
  put("IT1_4", "1");    // quantity 1
  req("IT1_7", intStr(order.weightKgs), "Shipping weight (kg)");
  put("IT1_8", config.defaultLicenseCode || "C33");
  put("IT1_9", config.defaultLicenseNumber || "NLR");
  const ymm = s(order.vehicleYearMakeModel) ||
    [order.year, order.make, order.model].map(s).filter(Boolean).join(" ");
  req("IT1_12", ymm.toUpperCase(), "Commodity description", "vehicle year/make/model"); // "2015 HYUNDAI TUCSON" — confirmed format, order 14217
  req("IT1_13", aesCodes.scheduleB(order, config), "Schedule B number",
    "set a default Schedule B on the AES Settings page, or a per-order override");
  put("IT1_15", "Y");  // commodity is a used self-propelled vehicle
  put("IT1_16", "V");  // vehicle ID qualifier = VIN
  req("IT1_17", s(order.vin).toUpperCase(), "VIN");
  req("IT1_18", order.titleNumber, "Vehicle title number", "add it on the filing screen");
  req("IT1_19", s(order.titleState).toUpperCase(), "Vehicle title state", "add it on the filing screen");
  put("IT1_20", config.defaultEccn);
  put("IT1_21", aesCodes.originIndicator(order, config));
  warn("IT1_1", "Export information code", `defaulted to "${fields.IT1_1}" — confirm for this shipment`);

  // ── Equipment — container shipments only ────────────────────────────────
  if (s(order.requestType).toUpperCase() === "CONTAINER") {
    req("EQ1", order.containerNumber, "Container number");
    if (s(order.sealNumber)) put("SN1", order.sealNumber);
    else warn("SN1", "Seal number", "no seal number on the order");
  }

  // SRN sanity
  if (srn.length > 17) missing.push({ field: "SRN", label: "Shipment reference number", reason: `"${srn}" is ${srn.length} chars (max 17)` });

  return { actionUrl, fields, missing, warnings, meta: { srn, env } };
}

/**
 * Record an ITN on the order without ever clobbering one that's already there.
 * Mutates `order` (caller saves). Returns "set" | "confirmed" | "mismatch" | "noop".
 */
function applyItn(order, rawItn, source) {
  const itn = s(rawItn).toUpperCase();
  if (!/^X\d{14,}$/.test(itn)) return "noop";
  order.aesFiling = order.aesFiling || {};

  if (!s(order.aesItn)) {
    order.aesItn = itn;
    order.aesFiling.itn = itn;
    order.aesFiling.status = "itn_received";
    order.aesFiling.itnReceivedAt = new Date();
    addTimelineSafe(order, "AES ITN Received", `${itn} (${source || "unknown"})`);
    return "set";
  }
  if (s(order.aesItn).toUpperCase() === itn) {
    order.aesFiling.itn = itn;
    if (order.aesFiling.status !== "itn_received") {
      order.aesFiling.status = "itn_received";
      order.aesFiling.itnReceivedAt = order.aesFiling.itnReceivedAt || new Date();
    }
    return "confirmed";
  }
  addTimelineSafe(order, "AES ITN Mismatch",
    `${source || "unknown"} returned ${itn} but the order already has ${order.aesItn}. Kept the existing ITN.`);
  return "mismatch";
}

function addTimelineSafe(order, action, details) {
  if (!Array.isArray(order.timeline)) order.timeline = [];
  order.timeline.push({ action, details, createdAt: new Date() });
}

module.exports = { buildWeblinkFiling, applyItn, yymmdd, TEST_URL, PROD_URL, effectiveEnv };
