// Find the towing-rate row for an order's pickup yard.
//
// City names repeat across states (LEXINGTON SC → Jacksonville vs LEXINGTON KY →
// Baltimore; also Lincoln, Hudson, Graham, Columbia, Springfield…), so a city-only
// match picks the wrong port and price. Match city + state, then the auction
// (Copart vs IAAI) when a city has both, then the order's port.
// Mirror of backend/utils/towRate.js — keep the two in step.

const STATE_CODES = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA", COLORADO: "CO",
  CONNECTICUT: "CT", DELAWARE: "DE", FLORIDA: "FL", GEORGIA: "GA", HAWAII: "HI", IDAHO: "ID",
  ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA", KANSAS: "KS", KENTUCKY: "KY", LOUISIANA: "LA",
  MAINE: "ME", MARYLAND: "MD", MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN",
  MISSISSIPPI: "MS", MISSOURI: "MO", MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV",
  "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY",
  "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", OHIO: "OH", OKLAHOMA: "OK", OREGON: "OR",
  PENNSYLVANIA: "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT", VERMONT: "VT", VIRGINIA: "VA", WASHINGTON: "WA",
  "WEST VIRGINIA": "WV", WISCONSIN: "WI", WYOMING: "WY", "DISTRICT OF COLUMBIA": "DC",
};

export const normCity = (s) => {
  if (!s) return "";
  let c = String(s).toUpperCase().replace(/[^A-Z0-9\s]/g, "").trim().replace(/\s+/g, " ");
  return c.replace(/\bFT\b/g, "FORT").replace(/\bST\b/g, "SAINT").replace(/\bMT\b/g, "MOUNT");
};

export const normState = (s) => {
  const u = String(s || "").toUpperCase().replace(/[^A-Z ]/g, "").replace(/\s+/g, " ").trim();
  if (!u) return "";
  if (u.length === 2) return u;
  return STATE_CODES[u] || u;
};

const auctionOf = (s) => {
  const u = String(s || "").toUpperCase();
  if (/COPART/.test(u)) return "COPART";
  if (/\bI\.?\s*A\.?\s*A\.?\s*I?\b|INSURANCE AUTO/.test(u)) return "IAAI";
  return "";
};

/**
 * @param {Array} rates   towing pricing rows ({ city, state, name, port, … })
 * @param {{city:string, state?:string, pickupName?:string, pol?:string, requirePort?:boolean}} q
 * @returns the best row, or null when it can't be told apart safely
 */
// The port your own rate table uses most for pickups in a state — the fallback when
// a pickup city has no rate of its own (better than a fixed state → port list).
export function portForState(rates, state) {
  const st = normState(state);
  if (!st || !Array.isArray(rates)) return "";
  const count = {};
  for (const r of rates) if (r.port && normState(r.state) === st) count[r.port] = (count[r.port] || 0) + 1;
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

export function findTowRate(rates, { city, state, pickupName, pol, requirePort = false } = {}) {
  if (!Array.isArray(rates)) return null;
  const c = normCity(city);
  if (!c) return null;
  // Spaces ignored: "LEROY" = "LE ROY", "DESOTO" = "DE SOTO"
  const flat = (s) => normCity(s).replace(/ /g, "");
  let pool = rates.filter(r => flat(r.city) === flat(city) && (!requirePort || r.port));
  if (!pool.length) return null;

  const st = normState(state);
  if (st) {
    pool = pool.filter(r => normState(r.state) === st);
    if (!pool.length) return null;                // same city name, different state → not ours
  } else if (new Set(pool.map(r => normState(r.state))).size > 1) {
    return null;                                    // no state to tell them apart → don't guess
  }

  const auc = auctionOf(pickupName);
  if (auc) {
    const a = pool.filter(r => auctionOf(r.name) === auc);
    if (a.length) pool = a;
  }

  const p = String(pol || "").toUpperCase();
  return (p && pool.find(r => String(r.port || "").toUpperCase() === p))
      || pool.find(r => r.port)
      || pool[0];
}
