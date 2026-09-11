/**
 * CBP code tables for AES / EEI filing.
 *
 * The app stores ports and countries as UPPERCASE NAMES (see PORT_DEFS in
 * parseOrderDocs.js and POL_OPTIONS / POD_OPTIONS on the frontend). AES wants
 * numeric codes. This module is the single place that translates.
 *
 * Codes marked "confirmed" were cross-checked against a bulk scan of 307 real
 * accepted EEI printouts (saved AES PDFs, 2025–2026) — see the (n) counts.
 * Everything else is still `// VERIFY` until checked against the current CBP
 * publication. The AES Settings page renders this table so staff can see
 * which entries are still blank, and ACE AESDirect re-validates every code on
 * submit — a wrong/blank code shows up as a `missing[]` row on the review
 * screen, never as a silent bad filing.
 *
 *   - Schedule D  — U.S. port of export .......... https://www.census.gov/foreign-trade/schedules/d/
 *   - Schedule K  — foreign port of unlading ..... https://www.cbp.gov/document/guidance/schedule-k-classification-foreign-ports-vessels
 *   - Schedule C  — country codes (ISO alpha-2) .. https://www.census.gov/foreign-trade/schedules/c/
 */

const { normalizePort, countryFromPod } = require("./parseOrderDocs");

const up = (s) => String(s || "").trim().toUpperCase();

// ── Schedule D: U.S. port name → 4-digit port-of-export code ────────────────
// Keyed by the normalized POL name the app uses.
const SCHEDULE_D = {
  SAVANNAH:     "1703", // confirmed (n=213) — dominant POE
  BALTIMORE:    "1303", // confirmed (n=31)
  JACKSONVILLE: "1803", // confirmed (n=24)
  FREEPORT:     "5311", // confirmed (n=17) — Freeport, TX
  PROVIDENCE:   "0502", // confirmed (n=12) — Davisville falls under Providence, RI
  "WILMINGTON": "1103", // confirmed (n=8) — Wilmington, DE (NOT Wilmington, NC)
  BRUNSWICK:    "1701", // confirmed (n=1)
  "LONG BEACH": "2709", // confirmed (n=1)
  "NEW YORK":   "1001", // VERIFY — not seen in the sample
  NEWARK:       "4601", // VERIFY — not seen in the sample
  HOUSTON:      "5301", // VERIFY — not seen in the sample
  NORFOLK:      "1401", // VERIFY — not seen in the sample
  CHARLESTON:   "1601", // VERIFY — not seen in the sample
};

// ── Schedule K: foreign port name → 5-digit port-of-unlading code ───────────
// Left blank where not yet confirmed — blanks surface on the review screen.
const SCHEDULE_K = {
  TEMA:      "74990", // confirmed (n=203) — "74990 - TEMA (TEMO), GHANA"
  ACCRA:     "74990", // usually filed as Tema
  TAKORADI:  "", // VERIFY
  LAGOS:     "75367", // confirmed (n=99) — "75367 - LAGOS; TIN CAN ISLAND, NIGERIA"
  APAPA:     "47110", // seen twice in the sample as an older/alternate Lagos code — VERIFY which applies
  COTONOU:   "76101", // confirmed (n=5) — "76101 - COTONOU, BENIN"
  LOME:      "", // VERIFY — Togo
  DAKAR:     "", // VERIFY — Senegal
  ABIDJAN:   "", // VERIFY — Côte d'Ivoire
  BANJUL:    "", // VERIFY — Gambia
  CONAKRY:   "", // VERIFY — Guinea
  FREETOWN:  "", // VERIFY — Sierra Leone
  MONROVIA:  "", // VERIFY — Liberia
  NOUAKCHOTT:"", // VERIFY — Mauritania
  DURBAN:    "", // VERIFY — South Africa
  DOUALA:    "", // VERIFY — Cameroon
};

// ── Schedule C: country name → ISO alpha-2 (these are stable) ───────────────
const COUNTRY_ISO = {
  GHANA: "GH",
  NIGERIA: "NG",
  BENIN: "BJ",
  TOGO: "TG",
  SENEGAL: "SN",
  "IVORY COAST": "CI",
  "COTE D'IVOIRE": "CI",
  "SOUTH AFRICA": "ZA",
  GAMBIA: "GM",
  "THE GAMBIA": "GM",
  GUINEA: "GN",
  "SIERRA LEONE": "SL",
  LIBERIA: "LR",
  MAURITANIA: "MR",
  CAMEROON: "CM",
  "UNITED STATES": "US",
  USA: "US",
};

// ── SCAC: shipping line → Standard Carrier Alpha Code ──────────────────────
// TURNS OUT the SCAC on the actual filing tracks the DESTINATION PORT much
// more reliably than the nominal "shipping line" name — see SCAC_BY_POD
// below, built from the same 307-filing sample, and preferred by
// aesWeblink.js. This map is the fallback when the POD isn't recognized.
const SCAC = {
  SALLAUM:        "SBLF", // confirmed (n=59, Lagos-bound) — booking prefix SLSE
  "SALLAUM LINES":"SBLF",
  ACL:            "OOLU", // confirmed (n=155/203 of Tema-bound filings) — NOT the "ACLU" industry code
  "ATLANTIC CONTAINER LINE": "OOLU",
  GRIMALDI:       "", // VERIFY — not seen in the sample; don't guess
  HOEGH:          "", // VERIFY — Höegh Autoliners; not seen in the sample
  "HOEGH AUTOLINERS": "",
};

// Port of unlading → the most common SCAC actually filed for that route
// (majority vote across 307 real accepted filings). Multiple ocean carriers
// service these RORO-consolidator routes on any given sailing (OOLU/HLCU/ACLU
// for Tema; SBLF/HLCU/ACLU/SLSD/MAEU for Lagos), so this is a strong default,
// not a certainty — aesWeblink.js flags it as a warning to confirm per booking.
const SCAC_BY_POD = {
  TEMA:    "OOLU", // 155/203 (76%) — runner-up HLCU (24), ACLU (21)
  ACCRA:   "OOLU",
  LAGOS:   "SBLF", // 59/99 (60%) — runner-up HLCU (26), ACLU (7), SLSD (5)
  COTONOU: "MSCU", // 3/5 — small sample, runner-up HLCU (2)
};

// ── US states: full name → 2-letter abbreviation ─────────────────────────────
const US_STATES = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA",
  COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE", FLORIDA: "FL", GEORGIA: "GA",
  HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA",
  KANSAS: "KS", KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD",
  MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN", MISSISSIPPI: "MS", MISSOURI: "MO",
  MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", OHIO: "OH",
  OKLAHOMA: "OK", OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT", VERMONT: "VT",
  VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV", WISCONSIN: "WI", WYOMING: "WY",
  "DISTRICT OF COLUMBIA": "DC",
};
const STATE_ABBRS = new Set(Object.values(US_STATES));

/**
 * Pull a clean 2-letter state code out of whatever's on hand — a plain
 * abbreviation, a full name, or a messier string like "NEW PHILADELPHIA OHIO"
 * (city + state run together, seen in real pickup-location data). Returns ""
 * if nothing recognizable is found.
 */
function stateAbbr(raw) {
  const u = up(raw);
  if (!u) return "";
  if (STATE_ABBRS.has(u)) return u;
  if (US_STATES[u]) return US_STATES[u];
  // scan word-by-word (and 2-word combos, for "NEW YORK" etc.) from the end —
  // state names/codes are usually the last token(s) of a "CITY STATE" string
  const words = u.split(/[\s,]+/).filter(Boolean);
  for (let n = Math.min(2, words.length); n >= 1; n--) {
    const tail = words.slice(-n).join(" ");
    if (US_STATES[tail]) return US_STATES[tail];
  }
  for (const w of words) if (STATE_ABBRS.has(w)) return w;
  return "";
}

// ── Mode of transport (vessel) ───────────────────────────────────────────────
//   10 = Vessel, non-containerized (RORO)   11 = Vessel, containerized
function motFor(requestType) {
  return up(requestType) === "CONTAINER" ? "11" : "10";
}

// ── Lookups ─────────────────────────────────────────────────────────────────
function scheduleD(pol) {
  const name = up(normalizePort ? normalizePort(pol) : pol) || up(pol);
  return SCHEDULE_D[name] || "";
}

function scheduleK(pod) {
  const name = up(normalizePort ? normalizePort(pod) : pod) || up(pod);
  return SCHEDULE_K[name] || "";
}

function countryIso(nameOrPod) {
  const n = up(nameOrPod);
  if (COUNTRY_ISO[n]) return COUNTRY_ISO[n];
  // maybe they passed a POD name — resolve to a country first
  const c = up(countryFromPod ? countryFromPod(nameOrPod) : "");
  return COUNTRY_ISO[c] || "";
}

function scac(line) {
  return SCAC[up(line)] || "";
}

// Preferred SCAC lookup — by destination port (the reliable signal), not the
// nominal shipping line. See SCAC_BY_POD above.
function scacForPod(pod) {
  const name = up(normalizePort ? normalizePort(pod) : pod) || up(pod);
  return SCAC_BY_POD[name] || "";
}

/**
 * Schedule B for the vehicle. Order override → AesConfig keyword map →
 * AesConfig default. Returns "" if nothing is configured (⇒ missing[]).
 */
function scheduleB(order, config) {
  if (order && order.scheduleB) return order.scheduleB.replace(/\D/g, "");
  const overrides = (config && config.scheduleBOverrides) || {};
  const hay = up(
    [order && order.vehicleYearMakeModel, order && order.make, order && order.model, order && order.condition]
      .filter(Boolean)
      .join(" ")
  );
  for (const kw of Object.keys(overrides)) {
    if (kw && hay.includes(up(kw)) && overrides[kw]) return String(overrides[kw]).replace(/\D/g, "");
  }
  return config && config.defaultScheduleB ? String(config.defaultScheduleB).replace(/\D/g, "") : "";
}

/**
 * Foreign/Domestic origin indicator (IT1_21) — is this a "domestic" or
 * "foreign" export? For a USED vehicle this is about the export, not where it
 * was manufactured: a used car that was in US domestic commerce (registered,
 * driven, sold used) is a DOMESTIC export even if it's a Hyundai or a Toyota.
 * Confirmed from a real accepted filing (order 14217, Korean-built VIN,
 * IT1_21 = "D"). Default "D" for every used vehicle; an Order-level override
 * (for the rare foreign-origin re-export) or the AesConfig default both win.
 */
function originIndicator(order, config) {
  if (order && order.originIndicator) return up(order.originIndicator);
  return config && config.defaultOriginIndicator ? up(config.defaultOriginIndicator) : "D";
}

module.exports = {
  SCHEDULE_D,
  SCHEDULE_K,
  COUNTRY_ISO,
  SCAC,
  SCAC_BY_POD,
  US_STATES,
  motFor,
  scheduleD,
  scheduleK,
  countryIso,
  scac,
  scacForPod,
  scheduleB,
  originIndicator,
  stateAbbr,
};
