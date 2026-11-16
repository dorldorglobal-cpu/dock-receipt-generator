// Dor L'Dor Global Ghana — our own Ghana office acting as the customer.
// Any order/invoice for this customer is, by definition, coming from the
// Ghana office, so its `source` is forced to "GHANA OFFICE".

// Match the canonical all-caps name and the common shorthand, ignoring
// punctuation/spacing ("Dor Ldor Global Ghana", "DOR LDOR GHANA", etc.).
function isGhanaCustomer(name) {
  const norm = (name || "").toUpperCase().replace(/[^A-Z]/g, "");
  return norm === "DORLDORGLOBALGHANA" || norm === "DORLDORGHANA";
}

// Fees the Ghana office pays 100% of. They stay on the invoice but are not
// part of the freight profit split with the Ghana office.
const NO_SPLIT_FEES = ["storageAuctionFee", "storageWarehouseFee", "storagePortFee",
                       "blFedexFee", "noTitleDeliveryFee", "titleProcessingFee"];

// Invoice line descriptions for those fees (labels from the order's fee rows).
const isNoSplitItem = desc =>
  /^(storage|fedex\/mailing|no title delivery|title processing)/i.test(String(desc || "").trim());

// Freight profit (split with Ghana) vs no-split fee profit, from order charges.
function splitProfit(charges = {}) {
  const n = v => Number(v || 0) || 0;
  const feeSell = NO_SPLIT_FEES.reduce((s, k) => s + Math.max(0, n(charges[k])), 0);
  const feeCost = NO_SPLIT_FEES.reduce((s, k) => s + n(charges[k + "Cost"]), 0);
  return { feeSell, feeCost, feeProfit: feeSell - feeCost };
}

module.exports = { isGhanaCustomer, NO_SPLIT_FEES, isNoSplitItem, splitProfit };
