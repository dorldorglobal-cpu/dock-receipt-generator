/**
 * CBP code tables for AES / EEI filing.
 *
 * The app stores ports and countries as UPPERCASE NAMES (see PORT_DEFS in
 * parseOrderDocs.js and POL_OPTIONS / POD_OPTIONS on the frontend). AES wants
 * numeric codes. This module is the single place that translates.
 *
 * ⚠️  Every code below is marked `// VERIFY` until it has been checked against
 *     the current CBP publication. The AES Settings page renders this table so
 *     staff can see which entries are still blank, and ACE AESDirect re-validates
 *     every code on submit — a wrong/blank code shows up as a `missing[]` row on
 *     the review screen, never as a silent bad filing.
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
  BALTIMORE:    "1303", // confirmed — order 14217, accepted EEI
  JACKSONVILLE: "1803", // VERIFY
  BRUNSWICK:    "1701", // VERIFY
  SAVANNAH:     "1703", // VERIFY
  "WILMINGTON": "1501", // VERIFY (Wilmington, NC)
  "NEW YORK":   "1001", // VERIFY
  NEWARK:       "4601", // VERIFY
  PROVIDENCE:   "0502", // VERIFY (Davisville falls under Providence, RI)
  HOUSTON:      "5301", // VERIFY
  "LONG BEACH": "2709", // VERIFY
  FREEPORT:     "",     // VERIFY — Freeport, TX?  confirm which Freeport
  NORFOLK:      "1401", // VERIFY
  CHARLESTON:   "1601", // VERIFY
};

// ── Schedule K: foreign port name → 5-digit port-of-unlading code ───────────
// Left blank where not yet confirmed — blanks surface on the review screen.
const SCHEDULE_K = {
  TEMA:      "", // VERIFY — Tema, Ghana
  ACCRA:     "", // VERIFY (usually filed as Tema)
  TAKORADI:  "", // VERIFY
  LAGOS:     "75367", // confirmed — order 14217: "75367 - LAGOS; TIN CAN ISLAND, NIGERIA"
  APAPA:     "", // VERIFY — Apapa is a separate Lagos-area terminal from Tin Can Island, may have its own code
  COTONOU:   "", // VERIFY — Benin
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
const SCAC = {
  SALLAUM:        "SBLF", // confirmed — order 14217 (booking prefix SLSE)
  "SALLAUM LINES":"SBLF", // confirmed
  ACL:            "ACLU", // VERIFY — Atlantic Container Line
  "ATLANTIC CONTAINER LINE": "ACLU", // VERIFY
  GRIMALDI:       "GRIU", // VERIFY
  HOEGH:          "HEGH", // VERIFY — Höegh Autoliners
  "HOEGH AUTOLINERS": "HEGH", // VERIFY
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
  US_STATES,
  motFor,
  scheduleD,
  scheduleK,
  countryIso,
  scac,
  scheduleB,
  originIndicator,
  stateAbbr,
};
