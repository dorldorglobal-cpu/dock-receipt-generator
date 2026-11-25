const mongoose = require("mongoose");

const containerLoadSchema = new mongoose.Schema({
  name:          { type: String, required: true },
  orderIds:      [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }],
  vessel:        { type: String, default: "" },
  shippingLine:  { type: String, default: "" },
  pol:           { type: String, default: "" },
  pod:           { type: String, default: "" },
  loaderEmail:   { type: String, default: "" },
  loaderCc:      { type: String, default: "" },
  bookingNumber: { type: String, default: "" },
  containerNumber: { type: String, default: "" },
  sealNumber:    { type: String, default: "" },
  sailCutoff:    { type: String, default: "" },
  arrivalDate:   { type: String, default: "" },
  notes:         { type: String, default: "" },
  emailSentAt:   { type: Date },
  status:        { type: String, default: "Pending" },

  // Consignee info (for loader email)
  consigneeName:    { type: String, default: "" },
  consigneeAddress: { type: String, default: "" },
  consigneePhone:   { type: String, default: "" },
  consigneeEmail:   { type: String, default: "" },
  consigneeTin:     { type: String, default: "" },

  // Notify party info
  notifyName:    { type: String, default: "" },
  notifyAddress: { type: String, default: "" },
  notifyPhone:   { type: String, default: "" },
  notifyEmail:   { type: String, default: "" },
  notifyTin:     { type: String, default: "" },

  // Adjustments saved onto the load's invoices — a discount (minus line) or an
  // extra charge, split evenly across every open invoice or put on one car's
  // invoice. Kept so they show up and can't be re-added by mistake.
  discounts: [{
    kind:       { type: String, enum: ["discount", "charge"], default: "discount" },
    label:      { type: String, default: "Discount" },
    amount:     { type: Number, required: true },
    appliedAt:  { type: Date, default: Date.now },
    // How a container-wide line shows on the Combined invoice: "newLine" = once under
    // the cars; "split" = each car's share inside its own row. Either way each car's
    // invoice carries its share, so totals/balances are the same.
    mode:       { type: String, enum: ["newLine", "split"], default: "newLine" },
    perInvoice: [{ invoiceId: mongoose.Schema.Types.ObjectId, invoiceNumber: String, orderRef: String, amount: Number }],
  }],

  // Parts / boxes delivered to the warehouse to go in this container
  parts: [{
    owner:       { type: String, default: "" },
    carrier:     { type: String, default: "" },
    tracking:    { type: String, default: "" },
    description: { type: String, default: "" },
  }],

  // Built automatically from a Ghana office "<ref> CONTAINER TO <POD> – <warehouse>"
  // email (utils/ghanaLoadWatch.js). Stays a draft — car statuses untouched —
  // until approved on the Containers page.
  needsApproval: { type: Boolean, default: false },
  approvedAt:    { type: Date },
  fromEmail: {
    gmailId:    { type: String, default: "" },
    subject:    { type: String, default: "" },
    from:       { type: String, default: "" },
    receivedAt: { type: Date },
    body:       { type: String, default: "" },
  },
  emailWarnings: [{ type: String }],   // VINs not found, cars already in another load …

  customsHold:            { type: Boolean, default: false },
  customsHoldDate:        { type: Date },
  customsHoldNote:        { type: String, default: "" },
  customsHoldCleared:     { type: Boolean, default: false },
  customsHoldClearedDate: { type: Date },

  driveFolderId:   { type: String, default: "" },
  driveFolderLink: { type: String, default: "" },

  files: [{
    label:        { type: String, default: "Document" },
    originalName: String,
    filename:     String,
    driveFileId:  String,
    driveUrl:     String,
    mimetype:     String,
    uploadedAt:   { type: Date, default: Date.now },
  }],
}, { timestamps: true });

module.exports = mongoose.model("ContainerLoad", containerLoadSchema);
