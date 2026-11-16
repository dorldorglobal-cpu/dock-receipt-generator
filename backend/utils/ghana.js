// Dor L'Dor Global Ghana — our own Ghana office acting as the customer.
// Any order/invoice for this customer is, by definition, coming from the
// Ghana office, so its `source` is forced to "GHANA OFFICE".

// Match the canonical all-caps name and the common shorthand, ignoring
// punctuation/spacing ("Dor Ldor Global Ghana", "DOR LDOR GHANA", etc.).
function isGhanaCustomer(name) {
  const norm = (name || "").toUpperCase().replace(/[^A-Z]/g, "");
  return norm === "DORLDORGLOBALGHANA" || norm === "DORLDORGHANA";
}

// Fees the Ghana office pays 100% of: every additional fee except non-runner and
// forklift (those are part of the freight). They stay on the invoice but are not
// part of the freight profit split, and Ghana's cost for them is the sell price.
// Same list as frontend OrderDetails.jsx NO_SPLIT_FEES.
const NO_SPLIT_FEES = ["emergencyBafFee", "storageAuctionFee", "storageWarehouseFee", "storagePortFee",
  "redeliveryFee", "titleProcessingFee", "mechanicalCharges", "warehouseInOutFee", "customsDemurrageFee",
  "customsHoldingFee", "vesselRolloverFee", "blFedexFee", "noTitleDeliveryFee", "ctnFee", "dryRunFee",
  "inOutFee", "miscellaneousFee"];

// Invoice line descriptions for those fees (labels from the order's fee rows).
const isNoSplitItem = desc =>
  /^(emergency baf|storage|re-?delivery|title processing|mechanical|warehouse in\/out|customs|vessel rollover|fedex\/mailing|no title delivery|ctn|dry run|in & out|miscellaneous)/i
    .test(String(desc || "").trim());

// No-split fee totals from order charges. Ghana's cost for these = sell.
// losses = fees that cost us more than we charged (flag so the sell gets raised).
function splitProfit(charges = {}) {
  const n = v => Number(v || 0) || 0;
  let feeSell = 0, feeCost = 0, loss = 0, ghana = 0;
  for (const k of NO_SPLIT_FEES) {
    const sl = Math.max(0, n(charges[k])), c = n(charges[k + "Cost"]);
    feeSell += sl; feeCost += c; ghana += Math.max(sl, c);
    if (c - sl > 0.005) loss += sl - c;
  }
  // ghanaCost: sell price, or the real cost when higher (Ghana sees that loss)
  return { feeSell, feeCost, feeProfit: feeSell - feeCost, feeLoss: loss, ghanaCost: ghana };
}

module.exports = { isGhanaCustomer, NO_SPLIT_FEES, isNoSplitItem, splitProfit };
