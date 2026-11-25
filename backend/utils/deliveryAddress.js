// An order's delivery name/address (deliveryName, deliveryAddress, City, State,
// Zip) must describe its deliveryLocation. When the location is switched (e.g.
// a RoRo port → a container warehouse) the old terminal's address used to stay
// behind, so DRs and the dispatch check read the wrong place.

const words = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(w => w.length >= 4);
const SKIP = new Set(["DORLDOR", "LDOR", "GLOBAL", "TERMINAL", "PORT", "EXPORT", "SALLAUM", "LINES"]);

// Does the saved delivery name belong to this location? (shares a real word, e.g.
// "SAVANNAH AUTO EXPORT" ~ "SAVANNAH …", "ACL – JACKSONVILLE (HORIZON)" ~ "JACKSONVILLE")
function nameFits(location, name) {
  if (!location || !name) return true;
  // Same name spelled differently: "EZCARGO" = "EZ CARGO" = "DOR L'DOR GLOBAL C/O EZCARGO"
  const flat = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (flat(name).includes(flat(location)) || flat(location).includes(flat(name))) return true;
  const a = words(location).filter(w => !SKIP.has(w)), b = words(name).filter(w => !SKIP.has(w));
  if (!a.length || !b.length) return true;
  return a.some(w => b.includes(w));
}

// Fill the delivery address from the most recent other order that has this same
// location with a matching name. Leaves the order alone if none is found.
// Returns true if it changed the order (caller saves).
async function refreshDeliveryAddress(order) {
  if (!order?.deliveryLocation || nameFits(order.deliveryLocation, order.deliveryName)) return false;
  const Order = require("../models/Order");
  const others = await Order.find({ _id: { $ne: order._id }, deliveryLocation: order.deliveryLocation, deliveryName: { $nin: ["", null] } })
    .sort({ createdAt: -1 }).limit(30).select("deliveryName deliveryAddress deliveryCity deliveryState deliveryZip").lean();
  const src = others.find(o => nameFits(order.deliveryLocation, o.deliveryName) && o.deliveryAddress);
  if (!src) return false;
  for (const k of ["deliveryName", "deliveryAddress", "deliveryCity", "deliveryState", "deliveryZip"]) order[k] = src[k] || "";
  return true;
}

module.exports = { nameFits, refreshDeliveryAddress };
