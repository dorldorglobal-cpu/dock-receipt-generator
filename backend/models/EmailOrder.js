const mongoose = require("mongoose");

const emailOrderSchema = new mongoose.Schema({
  // One Gmail message can carry several buyer receipts (customer forwards a
  // batch), so this is NOT unique — there's one EmailOrder row per attachment.
  // The poller's own "already processed" check + per-VIN dedup prevent repeats.
  gmailMessageId: { type: String, index: true },
  status: { type: String, default: "pending" }, // pending | approved | rejected | no-pdf

  // Extracted fields
  customerName:  String,
  requestType:   String,
  lot:           String,
  vin:           String,
  year:          String,
  make:          String,
  model:         String,
  color:         String,
  pickupAddress: String,
  pickupCity:    String,
  pickupState:   String,
  pickupZip:     String,
  pin:           String,
  buyerNumber:   String,
  saleDate:      String,

  // From the email subject line the user writes
  pod:           String,
  shippingLine:  String,
  deliveryName:  String, // warehouse (Container) named in the subject
  charges:       mongoose.Schema.Types.Mixed,

  // Raw data kept for upload and audit
  pdfBuffer:  Buffer,
  pdfFilename: String,
  bodyText:   String,

  // Set after approval
  orderId:    { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
  orderRef:   String,
}, { timestamps: true });

module.exports = mongoose.model("EmailOrder", emailOrderSchema);
