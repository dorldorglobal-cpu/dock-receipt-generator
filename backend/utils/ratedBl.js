// Rated BL → order charges + invoice cross-check.
//
// A Grimaldi/ACL rated BL lists every charge the line billed us for the unit
// (Basic Frt, BAF, MDR, Storage(POL), Forklift S/C, …). The base freight lines
// are our ocean cost; the extras (storage, forklift, non-runner, …) are
// pass-through charges the customer must be billed for. applyRatedBl():
//   • sets charges.oceanCost to the base-freight total,
//   • sets each extra's <key>Cost to what the line charged,
//   • raises each extra's sell price to at least that cost (or its usual price),
//   • puts the same lines on the order's invoice — adding or raising lines on an
//     unpaid invoice and regenerating its PDF,
//   • opens a hold on the order when a human has to act (invoice already sent →
//     resend; invoice paid → bill separately; a charge it doesn't recognise).
// Safe to run more than once: a second run finds nothing to change.

const Order   = require("../models/Order");
const Invoice = require("../models/Invoice");

// Same keys/labels as feeRows in frontend OrderDetails.jsx (the labels are what the
// invoice lines are called, so matching on them finds the existing line).
const FEES = {
  emergencyBafFee:     { label: "Emergency BAF",        defaultSell: 100 },
  nonRunnerFee:        { label: "Non-runner Fee",       defaultSell: 400 },
  forkliftFee:         { label: "Forklift Fee",         defaultSell: 500 },
  storagePortFee:      { label: "Storage Fee – Port" },
  redeliveryFee:       { label: "Re-delivery Fee" },
  customsDemurrageFee: { label: "Customs Demurrage Fee" },
  vesselRolloverFee:   { label: "Vessel Rollover Fee" },
};

// "Storage(POL)             279.00 USD         Virginia Beach"
function parseAclChargeLines(text) {
  const out = [];
  const re = /^[ \t]*([A-Za-z][^\n]*?)[ \t]{2,}([\d,]+\.\d{2})[ \t]+USD\b/gm;
  let m;
  while ((m = re.exec(text || "")) !== null) {
    const label = m[1].trim();
    if (/total/i.test(label)) continue;
    out.push({ label, amount: parseFloat(m[2].replace(/,/g, "")) });
  }
  return out;
}

// ── Sallaum ────────────────────────────────────────────────────────────────
// Page 1 lists the tariff lines ("05-10-2026BAF3 u450.00 USD1,350.00 USD",
// "09-04-2026EBS11 u100.00 USD…", "27-03-2023Non Runner4 u350.00 USD…").
// Page 2 has one row per car: Volume, Freight, BAF, THC, Storage, Other(NR/FK etc.), Total.
// "Other" is the non-runner/forklift price + the BAF increase on one line (see
// sallaumChargeLines). We already bill the BAF increase as "Emergency BAF".
function parseSallaumTariffs(text) {
  const out = {};
  const re = /\d{2}-\d{2}-\d{4}\s*([A-Za-z][A-Za-z /().&-]*?)\s*(\d+)\s*u\s*([\d,]+\.\d{2})\s*USD/g;
  let m;
  while ((m = re.exec(text || "")) !== null) {
    const type = m[1].trim();
    const rate = parseFloat(m[3].replace(/,/g, ""));
    (out[type] = out[type] || []);
    if (!out[type].includes(rate)) out[type].push(rate);
  }
  return out;
}

const isEBS = t => /\bEBS\b|emergency/i.test(t);

/**
 * One car row → charge lines in the same shape as parseAclChargeLines.
 * row: { freight, baf, thc, storage, other, total }  tariffs: parseSallaumTariffs()
 * condition: order condition ("Runner" / "Nonrunner" / "Forklift")
 */
function sallaumChargeLines(row, tariffs = {}, condition = "") {
  const lines = [];
  const add = (label, amount) => { if (amount > 0) lines.push({ label, amount: r2(amount) }); };
  const ebsRates = Object.entries(tariffs).filter(([t]) => isEBS(t)).flatMap(([, r]) => r);
  const bafRates = Object.entries(tariffs).filter(([t]) => /^baf$/i.test(t)).flatMap(([, r]) => r);

  // "Other" = the non-runner/forklift price + the BAF increase (EBS, $100) on the
  // same line — e.g. Baltimore non-runner 500 = 400 + 100, forklift 600 = 500 + 100.
  // Which one it is comes from the AMOUNT (matched to this invoice's own Non Runner /
  // Forklift tariff rates) — never the order's condition, which the port often changes
  // after the DR. On the newer BAF rate the increase sits in the BAF column instead
  // (BAF 450 = 350 + 100), and then "Other" is the non-runner/forklift price alone.
  const other = r2(row.other || 0);
  const inc = ebsRates[0] || 100;
  const nrRates = Object.entries(tariffs).filter(([t]) => /non\s*-?\s*run/i.test(t)).flatMap(([, r]) => r);
  const fkRates = Object.entries(tariffs).filter(([t]) => /fork/i.test(t)).flatMap(([, r]) => r);
  // Same rate listed under both names (older bills) → non-runner; the forklift is always the higher price
  const typeOf  = a => nrRates.includes(a) ? "Non Runner" : fkRates.includes(a) ? "Forklift" : null;

  let baf = r2(row.baf || 0);
  const bafRaised = bafRates.length > 1 && ebsRates.includes(r2(baf - Math.min(...bafRates)));
  const options = bafRaised
    ? [{ ebs: r2(baf - Math.min(...bafRates)), inBaf: true, nrfk: other }]
    : [...(other >= inc ? [{ ebs: inc, nrfk: r2(other - inc) }] : []), { ebs: 0, nrfk: other }];
  const pick = options.find(o => o.nrfk === 0 || typeOf(o.nrfk)) || null;

  if (pick) {
    if (pick.inBaf) baf = r2(baf - pick.ebs);
    add("Emergency Bunker (EBS / BAF increase)", pick.ebs);
    if (pick.nrfk > 0) add(typeOf(pick.nrfk), pick.nrfk);
  } else if (other > 0) {
    add("Other (NR/FK etc.)", other); // amount isn't a non-runner/forklift rate on this bill → hold for review
  }
  add("Freight", row.freight || 0);
  add("BAF", baf);
  add("THC", row.thc || 0);
  add("Storage", row.storage || 0);

  const sum = r2(lines.reduce((s, l) => s + l.amount, 0));
  if (row.total && Math.abs(sum - r2(row.total)) > 0.01) return []; // row didn't read cleanly — don't guess
  return lines;
}

// Find one car's row on a Sallaum invoice by VIN → charge lines
function parseSallaumChargeLines(text, vin, condition = "") {
  if (!vin) return [];
  const line = String(text || "").split("\n").find(l => l.toUpperCase().includes(String(vin).toUpperCase()));
  if (!line) return [];
  const after = line.substring(line.toUpperCase().indexOf(String(vin).toUpperCase()) + 17);
  const nums = (after.match(/[\d,]+\.\d{2}/g) || []).map(s => parseFloat(s.replace(/,/g, "")));
  if (nums.length < 7) return [];
  const [freight, baf, thc, storage, other, total] = nums.slice(-6);
  return sallaumChargeLines({ freight, baf, thc, storage, other, total }, parseSallaumTariffs(text), condition);
}

// Any rated BL / carrier bill text → charge lines (ACL layout, or Sallaum by VIN)
function parseRatedChargeLines(text, { vin = "", condition = "" } = {}) {
  if (/sallaum/i.test(text || "")) return parseSallaumChargeLines(text, vin, condition);
  return parseAclChargeLines(text);
}

// → a FEES key, "ocean" (part of the base freight cost), or "unknown"
function classifyCharge(label) {
  const l = String(label || "");
  if (/stor/i.test(l))                                         return "storagePortFee";
  if (/fork\s*-?\s*lift/i.test(l))                             return "forkliftFee";
  if (/non\s*-?\s*run|not\s*self|tow(ing)?\s*s\s*\/?\s*c/i.test(l)) return "nonRunnerFee"; // ACL "Towing S/C - POL" = non-runner handling
  if (/emergency\s*(bunker|baf)|\bEB[SC]\b/i.test(l))          return "emergencyBafFee";
  if (/roll\s*-?\s*over/i.test(l))                             return "vesselRolloverFee";
  if (/demurrage|detention/i.test(l))                          return "customsDemurrageFee";
  if (/re\s*-?\s*deliver/i.test(l))                            return "redeliveryFee";
  if (/basic|fr(eigh)?t|\bBAF\b|bunker|\bMDR\b|sulph|sulfur|\bLSS\b|\bTHC\b|ISPS|terminal|wharf|security|currency|\bCAF\b|carbon|\bETS\b|war\s*risk|fuel|doc(ument)?/i.test(l))
    return "ocean";
  return "unknown";
}

const norm = (s) => String(s || "").toLowerCase().replace(/[–—-]/g, "-").replace(/\s+/g, " ").trim();
const num  = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const r2   = (n) => Math.round(n * 100) / 100;
const usd  = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function addHoldOnce(order, note) {
  order.holds = order.holds || [];
  if (order.holds.some(h => !h.resolvedAt && h.note === note)) return;
  order.holds.push({ holdType: "Custom", note });
}

/**
 * @param {string|ObjectId} orderId
 * @param {{label:string, amount:number}[]} chargeLines  from parseAclChargeLines
 * @param {{source?:string}} opts
 * @returns summary { changed, extras:[…], invoice:{…}|null, unknown:[…] }
 */
async function applyRatedBl(orderId, chargeLines, { source = "Rated BL", dryRun = false } = {}) {
  const lines = (chargeLines || []).filter(c => c && c.amount > 0);
  if (!orderId || !lines.length) return { changed: false, extras: [], invoice: null, unknown: [] };
  const order = await Order.findById(orderId);
  if (!order) return { changed: false, extras: [], invoice: null, unknown: [] };

  let base = 0;
  const extraCost = {};
  const unknown = [];
  for (const c of lines) {
    const k = classifyCharge(c.label);
    if (k === "ocean") base += c.amount;
    else if (k === "unknown") { base += c.amount; unknown.push(c); }
    else extraCost[k] = (extraCost[k] || 0) + c.amount;
  }

  const charges = { ...(order.charges || {}) };
  const log = [];
  let chargesChanged = false;

  if (base > 0 && num(charges.oceanCost) !== r2(base)) {
    log.push(`ocean cost ${usd(num(charges.oceanCost))} → ${usd(base)}`);
    charges.oceanCost = String(r2(base));
    chargesChanged = true;
  }

  // Non-runner vs forklift: the carrier's charge decides (the port often re-marks a
  // unit after the DR). If the order bills the other one, move it over — the
  // other line is cleared, the invoice line is renamed, and the condition follows.
  const SIBLING = { forkliftFee: "nonRunnerFee", nonRunnerFee: "forkliftFee" };
  const COND = { forkliftFee: "Forklift", nonRunnerFee: "Nonrunner" };
  const extras = [];
  for (const [key, costRaw] of Object.entries(extraCost)) {
    const cost = r2(costRaw);
    const sib = SIBLING[key];
    const { label, defaultSell = 0 } = FEES[key];
    let replaces = null;
    if (sib && (num(charges[sib]) > 0 || num(charges[sib + "Cost"]) > 0)) {
      replaces = FEES[sib].label;
      log.push(`carrier charged ${label.replace(/ Fee$/, "")}, not ${replaces.replace(/ Fee$/, "")} — moved ${usd(num(charges[sib]))} ${replaces} to ${label}`);
      charges[sib] = "0.00"; delete charges[sib + "Cost"];
      chargesChanged = true;
    }
    if (COND[key] && order.condition !== COND[key]) {
      log.push(`condition ${order.condition || "—"} → ${COND[key]}`);
      order.condition = COND[key];
    }
    if (num(charges[key + "Cost"]) !== cost) {
      charges[key + "Cost"] = String(cost);
      chargesChanged = true;
    }
    const curSell = num(charges[key]);
    const sell = Math.max(curSell, cost, curSell ? 0 : defaultSell);
    if (sell !== curSell) {
      charges[key] = String(sell);
      chargesChanged = true;
      log.push(`${label}: cost ${usd(cost)}, billed ${usd(curSell)} → ${usd(sell)}`);
    }
    extras.push({ key, label, cost, sell, previousSell: curSell, replaces });
  }

  // ── Cross-check the invoice ─────────────────────────────────────────────
  let invoiceSummary = null;
  let invForPdf = null;
  const inv = await Invoice.findOne({ orderId: order._id }).sort({ createdAt: 1 });
  if (inv && extras.length) {
    const items = (inv.items || []).map(i => ({ description: i.description, amount: Number(i.amount || 0) }));
    const fixes = [];
    for (const x of extras) {
      // A line for the other one (NR ↔ FK) becomes this one
      const sibLabel = SIBLING[x.key] ? norm(FEES[SIBLING[x.key]].label) : null;
      const sIdx = sibLabel ? items.findIndex(i => norm(i.description).startsWith(sibLabel)) : -1;
      if (sIdx !== -1) {
        fixes.push(`${items[sIdx].description} ${usd(items[sIdx].amount)} → ${x.label} ${usd(x.sell)}`);
        items[sIdx] = { description: x.label, amount: x.sell };
        continue;
      }
      const idx = items.findIndex(i => norm(i.description).startsWith(norm(x.label)));
      if (idx === -1) {
        items.push({ description: x.label, amount: x.sell });
        fixes.push(`added ${x.label} ${usd(x.sell)}`);
      } else if (items[idx].amount < x.sell) {
        fixes.push(`${x.label} ${usd(items[idx].amount)} → ${usd(x.sell)}`);
        items[idx].amount = x.sell;
      }
    }
    if (fixes.length) {
      const total = r2(items.reduce((s, i) => s + Number(i.amount || 0), 0));
      if (inv.status === "paid") {
        addHoldOnce(order, `${source}: invoice ${inv.invoiceNumber} is paid but is missing ${fixes.join("; ")} — bill the customer separately`);
        invoiceSummary = { invoiceNumber: inv.invoiceNumber, status: inv.status, updated: false, fixes };
      } else {
        const before = inv.total;
        inv.items = items; inv.subtotal = total; inv.total = total; inv.updatedAt = new Date();
        if (!dryRun) await inv.save();
        invForPdf = inv.toObject();
        if (inv.status === "sent")
          addHoldOnce(order, `${source}: invoice ${inv.invoiceNumber} was already sent — updated ${usd(before)} → ${usd(total)} (${fixes.join("; ")}). Resend it to the customer.`);
        invoiceSummary = { invoiceNumber: inv.invoiceNumber, status: inv.status, updated: true, fixes, before, total };
      }
      log.push(`invoice ${inv.invoiceNumber}: ${fixes.join("; ")}`);
    }
  }

  if (unknown.length)
    addHoldOnce(order, `${source}: charge(s) not recognised — ${unknown.map(u => `${u.label} ${usd(u.amount)}`).join(", ")}. Counted in ocean cost; check if the customer should be billed.`);

  // A hold only counts as a change the first time it's opened (re-runs stay quiet)
  const changed = chargesChanged || !!invoiceSummary || order.isModified("holds") || order.isModified("condition");
  if (!changed) return { changed: false, extras, invoice: null, unknown };
  if (dryRun) return { changed: true, dryRun: true, extras, invoice: invoiceSummary, unknown, log, holds: order.holds.filter(h => !h.resolvedAt).map(h => h.note) };

  order.charges = charges;
  order.markModified("charges");
  order.timeline.push({
    action: "Rated BL Checked",
    details: `${source}: ${lines.map(c => `${c.label} ${usd(c.amount)}`).join(", ")}.${log.length ? " Updated: " + log.join("; ") + "." : ""}`,
    createdAt: new Date(),
  });

  // Regenerate the invoice PDF on the order (this also saves the order)
  let saved = false;
  if (invForPdf) {
    try {
      const inv_ = require("../routes/invoices");
      const pdf = await inv_.generateInvoicePdf(invForPdf, order);
      saved = await inv_.replaceInvoiceFileOnOrder(order, pdf, invForPdf.invoiceNumber);
    } catch (e) {
      console.warn("[ratedBl] invoice PDF regen failed:", e.message);
    }
  }
  if (!saved) await order.save();

  return { changed: true, extras, invoice: invoiceSummary, unknown, log };
}

module.exports = {
  parseAclChargeLines, parseSallaumTariffs, sallaumChargeLines, parseSallaumChargeLines, parseRatedChargeLines,
  classifyCharge, applyRatedBl, FEES,
};
