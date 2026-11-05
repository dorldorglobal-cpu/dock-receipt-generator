/**
 * Customer-name matching, so "ZAYYAD AUTOMOBILE LTD", "Zayyad Automobile" and
 * "ZAYYAD AUTOMOBILE LIMITED" are recognised as the same customer instead of
 * each becoming a new address-book entry.
 */
const AddressBook = require("../models/AddressBook");

const normCustomerName = (s) => (s || "").toUpperCase()
  .replace(/['‘’`]/g, "")
  .replace(/\b(LTD|LIMITED|CO|COMPANY|INC|INCORPORATED|LLC|CORP|CORPORATION|PLC)\b\.?/g, " ")
  .replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** The existing customer whose name matches apart from LTD/CO/INC/punctuation, or null. */
async function findSimilarCustomer(name) {
  const want = normCustomerName(name);
  if (!want) return null;
  const all = await AddressBook.find({ type: { $regex: "^customer$", $options: "i" } }).select("companyName").lean();
  const hit = all.find(c => normCustomerName(c.companyName) === want);
  return hit ? AddressBook.findById(hit._id) : null;
}

module.exports = { normCustomerName, findSimilarCustomer };
