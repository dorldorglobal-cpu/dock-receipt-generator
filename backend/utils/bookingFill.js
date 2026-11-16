/**
 * An order's booking # should never stay blank once a document for it carries one
 * (DR, rated/draft BL, Sallaum / ACL / container-loader bill). fillBookingIfBlank()
 * sets it only when the order has none — it never overwrites a booking already there.
 */
const Order = require("../models/Order");

/** Same format the app uses: Sallaum "SLSE-326194", ACL "S3-29824775"; others as given. */
function normBooking(raw) {
  let s = String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return "";
  let m;
  if ((m = s.match(/^SLSE-?(\d{5,7})$/))) return `SLSE-${m[1]}`;
  if ((m = s.match(/^S3-?(\d{8})$/))) return `S3-${m[1]}`;
  return s;
}

const lineOfBooking = (bk) => /^SLSE-/.test(bk) ? "SALLAUM" : /^S3-/.test(bk) ? "ACL" : "";

/**
 * Fill the order's booking if it's blank. `order` may be a loaded mongoose doc (it is
 * updated in memory and the caller saves it) or an id (saved here). Returns the booking set, or "".
 */
async function fillBookingIfBlank(order, rawBooking, source) {
  const bk = normBooking(rawBooking);
  if (!bk || !order) return "";
  const entry = { action: "Booking Updated", details: `Booking ${bk} filled in from ${source}`, createdAt: new Date() };
  if (typeof order === "object" && order.save) {
    if (String(order.bookingNumber || "").trim()) return "";
    order.bookingNumber = bk;
    if (!order.shippingLine && lineOfBooking(bk)) order.shippingLine = lineOfBooking(bk);
    (order.timeline = order.timeline || []).push(entry);
    return bk;
  }
  const o = await Order.findById(order).select("bookingNumber shippingLine").lean();
  if (!o || String(o.bookingNumber || "").trim()) return "";
  const set = { bookingNumber: bk };
  if (!o.shippingLine && lineOfBooking(bk)) set.shippingLine = lineOfBooking(bk);
  await Order.updateOne({ _id: o._id, $or: [{ bookingNumber: { $in: ["", null] } }, { bookingNumber: { $exists: false } }] },
    { $set: set, $push: { timeline: entry } });
  return bk;
}

module.exports = { normBooking, fillBookingIfBlank, lineOfBooking };
