/**
 * Default shipping line for Dor L'Dor Global Ghana CONTAINER orders, by warehouse:
 *   NJ (EZ Cargo) → OOCL · Savannah Auto Export → OOCL · CA (Cedars) → HAPAG LLOYD · Houston (iShip) → MAERSK
 * Applied only when the line is blank or "ACL" (ACL is RoRo — wrong for a container),
 * so a line picked by hand (e.g. ARKAS) is kept. Sailed/finished orders are left alone.
 * Runs on every Order save (models/Order.js) and hourly (server.js) for orders
 * updated some other way.
 */
const { isGhanaCustomer } = require("./ghana");

const DEFAULTS = [
  [/E\s*-?\s*Z\s*CARGO/i, "OOCL"],
  [/SAVANNAH\s+AUTO\s+EXPORT/i, "OOCL"],
  [/CEDARS/i, "HAPAG LLOYD"],
  [/\bI-?SHIP\b/i, "MAERSK"],
];
const DONE = ["Sailed", "Arrived", "Paid", "Completed", "Canceled", "Cancelled"];

function ghanaDefaultLine(o) {
  if (!isGhanaCustomer(o.customerName) || !/container/i.test(o.requestType || "") || DONE.includes(o.status)) return null;
  const cur = String(o.shippingLine || "").trim().toUpperCase();
  if (cur && cur !== "ACL") return null;
  const where = `${o.deliveryLocation || ""} ${o.pol || ""}`;
  const hit = DEFAULTS.find(([rx]) => rx.test(where));
  return hit ? hit[1] : null;
}

// Mongoose doc → true if it changed (caller saves)
function applyGhanaLine(order) {
  const line = ghanaDefaultLine(order);
  if (!line) return false;
  const was = order.shippingLine || "(blank)";
  order.shippingLine = line;
  order.timeline = order.timeline || [];
  order.timeline.push({ action: "Order Updated", details: `Shipping line ${was} → ${line} (Ghana container default for this warehouse)`, createdAt: new Date() });
  return true;
}

async function fixGhanaLines() {
  const Order = require("../models/Order");
  const candidates = await Order.find({
    customerName: /DOR\s*L.?\s*DOR\s*(GLOBAL\s*)?GHANA/i, requestType: /container/i, status: { $nin: DONE },
    $or: [{ shippingLine: { $in: ["", null, "ACL"] } }, { shippingLine: { $exists: false } }],
  });
  let n = 0;
  for (const o of candidates) if (applyGhanaLine(o)) { await o.save(); n++; }
  return n;
}

module.exports = { ghanaDefaultLine, applyGhanaLine, fixGhanaLines };
