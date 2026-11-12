// Apply a parsed AES to an order.
//
// - An AES for a different VIN is rejected outright: nothing from it is applied
//   (an AES uploaded to the wrong order once copied another car's ITN, exporter,
//   title and vessel onto it).
// - An AES for this order's VIN is the filed document for this car, so the fields
//   it owns (exporter/USPPI, title, vessel, weight, value, booking, ITN) replace
//   whatever is on the order — that's how a wrong earlier upload gets corrected.
// - Without a VIN to check, it only fills blanks (the old behaviour).
// Mutates `order` (caller saves). Returns { applied, rejected, updates, warning, vesselChanged }.

const { applyItn } = require("./aesWeblink");

const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function applyAesToOrder(order, parsed, { source = "AES PDF upload", fileName = "" } = {}) {
  const updates = [];
  const pv = norm(parsed.vin), ov = norm(order.vin);
  const tl = (action, details) => { order.timeline = order.timeline || []; order.timeline.push({ action, details, createdAt: new Date() }); };

  if (pv && ov && pv !== ov && pv.slice(-6) !== ov.slice(-6)) {
    const warning = `This AES${fileName ? ` (${fileName})` : ""} is for VIN ${pv}, not this order's ${ov} — nothing was taken from it. Wrong file?`;
    tl("AES VIN Mismatch", warning);
    return { applied: false, rejected: true, updates, warning };
  }
  const verified = !!(pv && ov);

  const OWNED = ["exporterName","exporterAddress","exporterCity","exporterState","exporterZip","exporterCountry","usppiEin",
                 "vessel","titleNumber","titleState","bookingNumber"];
  // Weight/value read less reliably (a stray digit) — only ever fill a blank, and only a sane car weight
  const FILL  = ["vin","year","make","model","pol","pod","value"];
  const kg = Number(parsed.weightKgs);
  if (kg >= 300 && kg <= 6000 && !order.weightKgs) { order.weightKgs = parsed.weightKgs; updates.push("weightKgs"); }
  const oldVessel = order.vessel;

  for (const f of OWNED) {
    if (!parsed[f]) continue;
    if (verified ? String(order[f] ?? "") !== String(parsed[f]) : !order[f]) { order[f] = parsed[f]; updates.push(f); }
  }
  for (const f of FILL) if (parsed[f] && !order[f]) { order[f] = parsed[f]; updates.push(f); }

  // The DR prints vehicleYearMakeModel ahead of year/make/model — keep it this car's
  const ymm = [order.year, order.make, order.model].filter(Boolean).join(" ").toUpperCase() || parsed.vehicleYearMakeModel;
  if (ymm && (verified || !order.vehicleYearMakeModel) && order.vehicleYearMakeModel !== ymm) {
    order.vehicleYearMakeModel = ymm; updates.push("vehicleYearMakeModel");
  }

  // Consignee (field 4a) always overwrites — more reliable than the buyer receipt
  for (const f of ["consigneeName","consigneeAddress","consigneeCity","consigneeCountry"]) {
    if (parsed[f] && order[f] !== parsed[f]) { order[f] = parsed[f]; updates.push(f); }
  }

  // ITN: this car's own AES wins; otherwise never clobber (WebLink-captured ITNs etc.)
  const itn = String(parsed.aesItn || "").toUpperCase();
  if (itn) {
    const cur = String(order.aesItn || "").toUpperCase();
    if (verified && cur && cur !== itn && /^X\d{14,}$/.test(itn)) {
      order.aesItn = itn;
      order.aesFiling = order.aesFiling || {};
      order.aesFiling.itn = itn;
      order.aesFiling.status = "itn_received";
      order.aesFiling.itnReceivedAt = new Date();
      tl("AES ITN Replaced", `${cur} → ${itn} (${source}${fileName ? `: ${fileName}` : ""} — this car's VIN)`);
      updates.push("aesItn");
    } else if (applyItn(order, itn, source) === "set") {
      updates.push("aesItn");
    }
  }

  return { applied: true, rejected: false, updates, vesselChanged: !!order.vessel && order.vessel !== oldVessel };
}

module.exports = { applyAesToOrder };
