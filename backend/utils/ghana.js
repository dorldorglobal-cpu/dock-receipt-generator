// Dor L'Dor Global Ghana — our own Ghana office acting as the customer.
// Any order/invoice for this customer is, by definition, coming from the
// Ghana office, so its `source` is forced to "GHANA OFFICE".

// Match the canonical all-caps name and the common shorthand, ignoring
// punctuation/spacing ("Dor Ldor Global Ghana", "DOR LDOR GHANA", etc.).
function isGhanaCustomer(name) {
  const norm = (name || "").toUpperCase().replace(/[^A-Z]/g, "");
  return norm === "DORLDORGLOBALGHANA" || norm === "DORLDORGHANA";
}

module.exports = { isGhanaCustomer };
