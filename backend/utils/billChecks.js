/**
 * Checks on unpaid bills before they're paid. Each flag is
 *   { level: "stop" | "warn", text }
 * "stop" = very likely wrong (same bill entered twice, order canceled);
 * "warn" = worth a look (price well above that vendor's usual, car not picked up yet).
 *
 * One invoice # covering several cars is normal (Sallaum, loaders), and two
 * towing bills on one car is normal (trucker + A to Z drayage), so a bill only
 * counts as a duplicate when the SAME vendor bills the SAME car again with the
 * same invoice # or the same amount.
 */
const Expense = require("../models/Expense");
const Order = require("../models/Order");
const { normVendorName } = require("./vendorMatch");

const fmt$ = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDay = (d) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : ""; // bill/paid dates are stored as UTC midnight of the day
const vinOf = (e) => (e.vin || (e.description || "").match(/\b([A-HJ-NPR-Z0-9]{11,17})\b/)?.[1] || "").toUpperCase();
// Imported VINs sometimes miss a leading character — compare the last 8
const vinKey = (v) => (v && v.length >= 8 ? v.slice(-8) : "");
const invKey = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const NOT_PICKED_UP = new Set(["New Order", "Awaiting Pickup"]);
const PRICE_MIN_HISTORY = 4;   // past bills needed before judging a price
const PRICE_RATIO = 1.5;       // flag at 1.5× the vendor's usual …
const PRICE_MIN_GAP = 100;     // … and at least $100 more

/**
 * bills: open bills (lean docs with _id vendor amount orderRef vin description
 * invoiceNumber category status). Returns Map(billId → flags[]), only for bills with flags.
 */
async function checkBills(bills) {
  const out = new Map();
  if (!bills.length) return out;
  const add = (id, level, text) => { const k = String(id); if (!out.has(k)) out.set(k, []); out.get(k).push({ level, text }); };

  const vendorNames = [...new Set(bills.map(b => b.vendor).filter(Boolean))];
  const vendorKeys = new Set(vendorNames.map(normVendorName).filter(Boolean));
  // Every bill (any status) from these vendors — exact-name query first, then the
  // normalized match catches "A to Z Port Services" vs "A TO Z PORT SERVICES INC"
  const escRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const firstWords = [...new Set([...vendorKeys].map(k => k.split(" ")[0]).filter(Boolean))];
  const pool = firstWords.length ? await Expense.find({ vendor: { $regex: `^\\W*(${firstWords.map(escRx).join("|")})`, $options: "i" } })
    .select("_id vendor amount orderRef vin description invoiceNumber category status paidDate date").lean() : [];
  const sameVendorBills = new Map(); // vendorKey → bills
  for (const e of pool) {
    const k = normVendorName(e.vendor);
    if (!vendorKeys.has(k)) continue;
    if (!sameVendorBills.has(k)) sameVendorBills.set(k, []);
    sameVendorBills.get(k).push(e);
  }

  const refs = [...new Set(bills.map(b => b.orderRef).filter(Boolean))];
  const orders = refs.length ? await Order.find({ refNumber: { $in: refs } }).select("refNumber status vin").lean() : [];
  const orderByRef = new Map(orders.map(o => [o.refNumber, o]));

  for (const b of bills) {
    const o = b.orderRef ? orderByRef.get(b.orderRef) : null;
    const myVin = vinKey(vinOf(b) || o?.vin || "");
    const vKey = normVendorName(b.vendor);

    // 1. Same vendor, same car, same category: same invoice # or same amount
    const others = (sameVendorBills.get(vKey) || []).filter(e => String(e._id) !== String(b._id) && e.category === b.category);
    for (const e of others) {
      const theirVin = vinKey(vinOf(e));
      const sameCar = (myVin && theirVin) ? myVin === theirVin : (!!b.orderRef && e.orderRef === b.orderRef);
      if (!sameCar) continue;
      const sameInv = invKey(b.invoiceNumber) && invKey(b.invoiceNumber) === invKey(e.invoiceNumber);
      const sameAmt = Math.round((b.amount || 0) * 100) === Math.round((e.amount || 0) * 100);
      if (!sameInv && !sameAmt) continue;
      const what = sameInv ? `invoice #${e.invoiceNumber}` : `the same ${fmt$(e.amount)}`;
      const state = e.status === "paid" ? `already PAID${e.paidDate ? " " + fmtDay(e.paidDate) : ""}` : `also unpaid`;
      add(b._id, "stop", `Possible duplicate: ${e.vendor} billed this car ${what} before — ${state}`);
    }

    // 2. Order canceled (a ref with no order is normal for bills older than the app)
    if (o?.status === "Canceled") add(b._id, "stop", `Order #${o.refNumber} is Canceled`);

    // 3. Towing bill but the car isn't marked picked up yet
    if (o && b.category === "Towing / Transport" && NOT_PICKED_UP.has(o.status))
      add(b._id, "warn", `Car still shows "${o.status}" — not marked picked up yet`);

    // 4. Towing price well above this trucker's usual
    if (b.category === "Towing / Transport" && b.amount > 0) {
      const past = (sameVendorBills.get(vKey) || [])
        .filter(e => String(e._id) !== String(b._id) && e.category === "Towing / Transport" && e.amount > 0)
        .map(e => e.amount);
      if (past.length >= PRICE_MIN_HISTORY) {
        const m = median(past);
        if (b.amount >= m * PRICE_RATIO && b.amount - m >= PRICE_MIN_GAP)
          add(b._id, "warn", `${fmt$(b.amount)} is well above this trucker's usual ${fmt$(Math.round(m))} (${past.length} past bills)`);
      }
    }
  }
  return out;
}

/** Every open bill that has a flag → [{ bill, flags }], "stop" ones first. */
async function flaggedOpenBills() {
  const open = await Expense.find({ status: { $in: ["unpaid", "partial"] } })
    .select("_id vendor amount paidAmount orderRef vin description invoiceNumber category status date").lean();
  const flags = await checkBills(open);
  return open.filter(b => flags.has(String(b._id)))
    .map(b => ({ bill: b, flags: flags.get(String(b._id)) }))
    .sort((x, y) => (y.flags.some(f => f.level === "stop") - x.flags.some(f => f.level === "stop")) || String(x.bill.vendor).localeCompare(String(y.bill.vendor)));
}

module.exports = { checkBills, flaggedOpenBills };
