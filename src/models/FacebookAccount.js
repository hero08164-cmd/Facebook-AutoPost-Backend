const mongoose = require("mongoose");

const facebookAccountSchema = new mongoose.Schema(
  {
    pageId: { type: String, required: true },
    pageName: { type: String },
    pageAccessToken: { type: String, required: true }, // Long-lived token
    connected: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("FacebookAccount", facebookAccountSchema);
