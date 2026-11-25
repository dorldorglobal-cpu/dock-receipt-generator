/**
 * Keep titleStatus honest:
 *   - a car that has Sailed (or later) had its title — nothing ships without one;
 *   - resolving the "No Title" hold means the title came in.
 * Either way titleStatus becomes "Title" (and, for a sailed car, any leftover
 * open No Title hold is resolved). Each change is written to the order timeline.
 */
const Order = require("../models/Order");

const SHIPPED = ["Sailed", "Arrived", "Paid", "Completed"];
const isNoTitleHold = (h) => h.holdType === "No Title" || /NO\s*TITLE/i.test(h.note || "");

// Mongoose doc → true if it changed (caller saves)
function applyTitleRule(order) {
  if (order.titleStatus === "Title") return false;
  const holds = order.holds || [];
  const open = holds.filter(h => isNoTitleHold(h) && !h.resolvedAt);
  const resolved = holds.some(h => isNoTitleHold(h) && h.resolvedAt);
  const shipped = SHIPPED.includes(order.status);
  if (!shipped && !(resolved && !open.length)) return false;

  const was = order.titleStatus || "Pending";
  order.titleStatus = "Title";
  order.timeline = order.timeline || [];
  if (shipped && open.length) {
    open.forEach(h => { h.resolvedAt = new Date(); });
    order.timeline.push({ action: "Hold Resolved", details: `No Title hold resolved automatically — order is ${order.status}.`, createdAt: new Date() });
  }
  order.timeline.push({
    action: "Title Status",
    details: `Title status ${was} → Title automatically (${shipped ? `order is ${order.status}` : "No Title hold was resolved"}).`,
    createdAt: new Date(),
  });
  return true;
}

// Hourly sweep over every order the rule applies to → how many were fixed
async function fixTitleStatuses() {
  const candidates = await Order.find({
    titleStatus: { $ne: "Title" },
    $or: [{ status: { $in: SHIPPED } }, { holds: { $elemMatch: { holdType: "No Title", resolvedAt: { $ne: null } } } },
      { holds: { $elemMatch: { note: /NO\s*TITLE/i, resolvedAt: { $ne: null } } } }],
  });
  let n = 0;
  for (const o of candidates) if (applyTitleRule(o)) { await o.save(); n++; }
  return n;
}

module.exports = { applyTitleRule, fixTitleStatuses, isNoTitleHold };
