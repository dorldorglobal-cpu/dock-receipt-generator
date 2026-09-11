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
  BALTIMORE:    "1303", // VERIFY
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
  LAGOS:     "", // VERIFY — Apapa/Lagos, Nigeria
  APAPA:     "", // VERIFY
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
  SALLAUM:        "",     // VERIFY — Sallaum Lines
  "SALLAUM LINES":"",     // VERIFY
  ACL:            "ACLU", // VERIFY — Atlantic Container Line
  "ATLANTIC CONTAINER LINE": "ACLU", // VERIFY
  GRIMALDI:       "GRIU", // VERIFY
  HOEGH:          "HEGH", // VERIFY — Höegh Autoliners
  "HOEGH AUTOLINERS": "HEGH", // VERIFY
};

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
 * Foreign/Domestic origin indicator (IT1_21). US-built vehicles (VIN world
 * manufacturer identifier starting 1, 4 or 5) → "D"; otherwise "F". An Order
 * override wins. Always flagged as a warning for a human to confirm.
 */
function originIndicator(order, config) {
  if (order && order.originIndicator) return up(order.originIndicator);
  const vin = up(order && order.vin);
  if (/^[145]/.test(vin)) return "D";
  if (vin) return "F";
  return config && config.defaultOriginIndicator ? up(config.defaultOriginIndicator) : "F";
}

module.exports = {
  SCHEDULE_D,
  SCHEDULE_K,
  COUNTRY_ISO,
  SCAC,
  motFor,
  scheduleD,
  scheduleK,
  countryIso,
  scac,
  scheduleB,
  originIndicator,
};
