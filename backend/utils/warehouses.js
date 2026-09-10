// Loading warehouses (Port of Loading options for a container load).
// Picking a POL on the new-load form auto-fills the loader email, and the
// "review email" step sends there instead of always defaulting to EZ Cargo.
//
// `loaderTo` / `loaderCc` are comma-separated recipient lists.

const WAREHOUSES = [
  {
    key: "EZ CARGO",
    name: "EZ CARGO",
    city: "Old Bridge", state: "NJ", pol: "NEW YORK",
    loaderTo: "info@e-zcargo.com",
    loaderCc: "shipping@e-zcargo.com",
  },
  {
    key: "SAVANNAH AUTO EXPORT",
    name: "SAVANNAH AUTO EXPORT",
    city: "Pooler", state: "GA", pol: "SAVANNAH",
    loaderTo: "savannahexport@yahoo.com",
    loaderCc: "",
  },
  {
    key: "ISHIP",
    name: "ISHIP",
    city: "Houston", state: "TX", pol: "HOUSTON",
    loaderTo: "cs@ishipinc.com, bookings@ishipinc.com",
    loaderCc: "",
  },
  {
    key: "CEDARS EXPRESS",
    name: "CEDARS EXPRESS",
    city: "Compton", state: "CA", pol: "LONG BEACH",
    loaderTo: "dulce@cedarsexpress.com",
    loaderCc: [
      "naji@cedarsexpress.com",
      "dataentry@cedarsexpress.com",
      "dispatch@cedarsexpress.com",
      "wrh@cedarsexpress.com",
      "mabelle@cedarsexpress.com",
      "cindy.a@cedarsexpress.com",
      "gs@cedarsexpress.com",
    ].join(", "),
  },
];

// Match a stored POL value ("ISHIP", "iship", "HOUSTON, TX", "NJ") to a
// warehouse. Tries key/name first, then city/state tokens, then a couple of
// legacy aliases that predate the dropdown.
const ALIASES = {
  "NJ": "EZ CARGO", "NEW YORK": "EZ CARGO", "NEW JERSEY": "EZ CARGO", "EZCARGO": "EZ CARGO",
  "SAVANNAH": "SAVANNAH AUTO EXPORT", "GA": "SAVANNAH AUTO EXPORT", "POOLER": "SAVANNAH AUTO EXPORT",
  "HOUSTON": "ISHIP", "TX": "ISHIP", "FREEPORT": "ISHIP", "I-SHIP": "ISHIP",
  "CA": "CEDARS EXPRESS", "COMPTON": "CEDARS EXPRESS", "LOS ANGELES": "CEDARS EXPRESS",
  "LONG BEACH": "CEDARS EXPRESS", "CEDARS": "CEDARS EXPRESS",
};

function findWarehouse(pol) {
  if (!pol) return null;
  const norm = String(pol).toUpperCase().trim();
  const direct = WAREHOUSES.find(w => w.key === norm || w.name.toUpperCase() === norm);
  if (direct) return direct;
  // token match against aliases (handles "HOUSTON, TX")
  for (const tok of norm.split(/[^A-Z]+/).filter(Boolean).concat([norm])) {
    if (ALIASES[tok]) return WAREHOUSES.find(w => w.key === ALIASES[tok]);
  }
  return null;
}

// POD → shipping line (mirrors the CreateOrder frontend helper)
function podToShippingLine(pod) {
  const p = String(pod || "").toUpperCase().trim();
  if (["LAGOS", "COTONOU", "LOME", "DAKAR", "ABIDJAN"].includes(p)) return "SALLAUM";
  if (p === "TEMA") return "ACL";
  return "";
}

module.exports = { WAREHOUSES, findWarehouse, podToShippingLine };
