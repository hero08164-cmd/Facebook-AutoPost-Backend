const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema({
  // Sirf ek hi settings document rahega (singleton pattern)
  key: { type: String, default: "app_settings", unique: true },

  // Format: "HH:mm" (24 hour), e.g. "18:00"
  cronTime: { type: String, default: "18:00" },

  // Kaunsa Drive folder currently active/selected hai
  activeDriveFolderId: { type: String, default: null },
  activeDriveFolderName: { type: String, default: null },
});

module.exports = mongoose.model("Settings", settingsSchema);