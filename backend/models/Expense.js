const mongoose = require("mongoose");

const CATEGORIES = [
  "Towing / Transport",
  "Ocean Freight",
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

    // Payment status
    status:          { type: String, enum: ["unpaid", "paid"], default: "unpaid" },
    paidDate:        { type: Date, default: null },
    paymentMethod:   { type: String, default: "" }, // "Bank ACH", "Zelle", "Venmo", "Check", "Other"

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
