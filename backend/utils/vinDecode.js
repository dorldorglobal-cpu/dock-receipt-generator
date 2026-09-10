// NHTSA vPIC VIN decoder — the authoritative source for year/make/model.
// Auction buyer receipts jam the description ("CHEVROLEEQUINOX Date9"), so we
// trust the decoded VIN over the parsed text.

async function decodeVin(vin) {
  const v = (vin || "").toUpperCase().trim();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return null;
  try {
    const res = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${v}?format=json`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    const r = (await res.json())?.Results?.[0] || {};
    const year  = String(r.ModelYear || "").trim();
    const make  = String(r.Make || "").trim().toUpperCase();
    // Model + trim/series when vPIC splits them
    const model = [r.Model, r.Series].filter(Boolean).join(" ").trim().toUpperCase();
    if (!make && !model) return null;
    return { year, make, model };
  } catch {
    return null;
  }
}

module.exports = { decodeVin };
