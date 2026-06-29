const mongoose = require("mongoose");

const CATEGORIES = [
  "Towing / Transport",
  "Ocean Freight",
  "Storage",
  "Port / Terminal Fees",
  "Loaders & Warehouses",
  "Software",
  "Legal Fees",
  "Office & Admin",
  "General Overhead",
];

const expenseSchema = new mongoose.Schema(
  {
    category:    { type: String, required: true, enum: CATEGORIES },
    description: { type: String, required: true, trim: true },
    vendor:      { type: String, default: "", trim: true },
    amount:      { type: Number, required: true, min: 0 },
    date:        { type: Date,   required: true, default: Date.now },

    // Optional order link
    orderId:  { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    orderRef: { type: String, default: "" },

    // Payment status: unpaid → partial → paid
    status:        { type: String, enum: ["unpaid", "partial", "paid"], default: "unpaid" },
    paidDate:      { type: Date, default: null },   // date of most recent payment
    paidAmount:    { type: Number, default: null }, // cumulative total paid so far
    paymentMethod: { type: String, default: "" },

    // Full payment history
    payments: [{
      amount: { type: Number, required: true },
      date:   { type: Date, default: Date.now },
      method: { type: String, default: "" },
      notes:  { type: String, default: "" },
      receiptFileName: { type: String, default: "" },
      receiptDriveId:  { type: String, default: "" },
      receiptDriveUrl: { type: String, default: "" },
      receiptMime:     { type: String, default: "" },
    }],

    vin:           { type: String, default: "" },
    invoiceNumber: { type: String, default: "" },

    // Bill document (vendor's invoice / dispatch sheet)
    billFileName:   { type: String, default: "" },
    billMime:       { type: String, default: "" },
    billDriveId:    { type: String, default: "" },
    billDriveUrl:   { type: String, default: "" },

    // Receipt proof (payment confirmation)
    receiptFileName:   { type: String, default: "" },
    receiptMime:       { type: String, default: "" },
    receiptDriveId:    { type: String, default: "" },
    receiptDriveUrl:   { type: String, default: "" },

    notes: { type: String, default: "" },

    // General attachments (extra docs, photos, etc.)
    attachments: [{
      name:       { type: String, default: "" },
      driveId:    { type: String, default: "" },
      driveUrl:   { type: String, default: "" },
      mime:       { type: String, default: "" },
      uploadedAt: { type: Date, default: Date.now },
    }],

    // Extra charge lines attached to this bill
    lineItems: [{
      description: { type: String, default: "" },
      amount:      { type: Number, default: 0 },
    }],
  },
  { timestamps: true }
);

const Expense = mongoose.model("Expense", expenseSchema);
Expense.CATEGORIES = CATEGORIES;
module.exports = Expense;
