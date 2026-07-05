const mongoose = require("mongoose");

const videoSchema = new mongoose.Schema(
  {
    source: {
      type: String,
      enum: ["manual", "drive"],
      required: true,
    },
    // Manual upload ke case me Cloudinary details
    cloudinaryUrl: { type: String },
    cloudinaryPublicId: { type: String },

    // Drive ke case me file details
    driveFileId: { type: String },
    driveFileName: { type: String },
    driveWebViewLink: { type: String },

    title: { type: String, default: "" },

    status: {
      type: String,
      enum: ["pending", "posted", "failed"],
      default: "pending",
    },

    // FIFO order ke liye - jo pehle create hui wahi pehle post hogi
    createdAt: { type: Date, default: Date.now },
    postedAt: { type: Date },
  },
  { timestamps: true }
);

// Queue fetch karte time FIFO order ke liye index
videoSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model("Video", videoSchema);
