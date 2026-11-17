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
const NO_SPLIT_FEES = ["emergencyBafFee", "hybridElectricFee", "storageAuctionFee", "storageWarehouseFee", "storagePortFee",
  "redeliveryFee", "titleProcessingFee", "mechanicalCharges", "warehouseInOutFee", "customsDemurrageFee",
  "customsHoldingFee", "vesselRolloverFee", "blFedexFee", "noTitleDeliveryFee", "ctnFee", "dryRunFee",
  "inOutFee", "miscellaneousFee"];

// Invoice line descriptions for those fees (labels from the order's fee rows).
const isNoSplitItem = desc =>
  /^(emergency baf|hybrid|storage|re-?delivery|title processing|mechanical|warehouse in\/out|customs|vessel rollover|fedex\/mailing|no title delivery|ctn|dry run|in & out|miscellaneous)/i
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

// Manual Ghana Cost overrides live in charges as "<item>GhanaCost"
// (towingGhanaCost, oceanGhanaCost, <feeKey>GhanaCost). Blank = automatic.
const ghanaOverride = (charges, base) => {
  const v = charges[base + "GhanaCost"];
  return v === undefined || v === null || String(v).trim() === "" ? null : (Number(v) || 0);
};

// Towing sold for $500 or less: Ghana's profit on the tow is $150 (Ghana Cost =
// sell − 150), unless our real profit is already under $150 — then real cost.
// Tows over $500 use the real cost until a Ghana Cost is entered by hand.
const ghanaTowAuto = (sell, cost) => (sell > 0 && sell <= 500 ? Math.max(cost, sell - 150) : cost);

// How much Ghana Cost differs from our real cost on an order:
// freight items = real cost, no-split fees = sell (or real cost if higher),
// unless a Ghana Cost was entered by hand for that line.
function ghanaCostDelta(charges = {}) {
  const n = v => Number(v || 0) || 0;
  let d = 0;
  const line = (base, realCost, auto) => {
    const ov = ghanaOverride(charges, base);
    d += (ov !== null ? ov : auto) - realCost;
  };
  line("towing", n(charges.towingCost), ghanaTowAuto(n(charges.towingCharge), n(charges.towingCost)));
  line("ocean",  n(charges.oceanCost),  n(charges.oceanCost));
  for (const k of [...NO_SPLIT_FEES, "nonRunnerFee", "forkliftFee"]) {
    const sl = Math.max(0, n(charges[k])), c = n(charges[k + "Cost"]);
    line(k, c, NO_SPLIT_FEES.includes(k) ? Math.max(sl, c) : c);
  }
  return d;
}

// A Ghana order for the Ghana Cost / split profit: from the Ghana office, or
// shipping to a Ghana port (any customer).
const GHANA_POD = /\b(TEMA|ACCRA|TAKORADI|GHANA)\b/i;
function isGhanaOrder(o = {}) {
  return isGhanaCustomer(o.customerName) || String(o.source || "").toUpperCase() === "GHANA OFFICE" || GHANA_POD.test(String(o.pod || ""));
}

// Ghana split for one order from its charges — same numbers as the order page:
// sell = every charge; ghanaCost = real cost adjusted by ghanaCostDelta.
function ghanaSplit(charges = {}) {
  const n = v => Number(v || 0) || 0;
  const lists = [...(Array.isArray(charges.extraTows) ? charges.extraTows : []), ...(Array.isArray(charges.driverFees) ? charges.driverFees : [])];
  let sell = 0, cost = 0;
  for (const [k, v] of Object.entries(charges)) {
    if (typeof v === "object" || k.endsWith("Desc") || k.endsWith("Category")) continue;
    if (k.endsWith("GhanaCost")) continue;
    if (k.endsWith("Cost")) cost += n(v); else sell += n(v);
  }
  for (const x of lists) { sell += n(x?.amount); cost += n(x?.cost); }
  const ghanaCost = cost + ghanaCostDelta(charges);
  return { sell, cost, ghanaCost, split: sell - ghanaCost };
}

module.exports = { ghanaTowAuto, isGhanaCustomer, isGhanaOrder, NO_SPLIT_FEES, isNoSplitItem, splitProfit, ghanaCostDelta, ghanaSplit };
