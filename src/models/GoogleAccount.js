const mongoose = require("mongoose");

const googleAccountSchema = new mongoose.Schema(
  {
    email: { type: String },
    refreshToken: { type: String, required: true },
    accessToken: { type: String },
    accessTokenExpiry: { type: Date },
    connected: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("GoogleAccount", googleAccountSchema);
