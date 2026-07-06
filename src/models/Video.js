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
      // 🎯 UPDATE: 'uploading_draft' add kiya taaki processing state track ho sake
      enum: ["pending", "uploading_draft", "posted", "failed"],
      default: "pending",
    },

    // 🎯 NEW FIELDS: Pipeline 2.0 (1 Ghanta Pehle Draft Upload) ke liye
    fbVideoId: { 
      type: String, 
      default: null // Facebook se milne wali draft video ID yahan save hogi
    },
    isUploadedAsDraft: { 
      type: Boolean, 
      default: false // Jab 1 ghante pehle upload ho jayegi toh true ho jayega
    },
    draftError: {
      type: String,
      default: null // Agar draft upload ke waqt koi dikkat aayi toh log hoga
    },

    // FIFO order ke liye - jo pehle create hui wahi pehle post hogi
    createdAt: { type: Date, default: Date.now },
    postedAt: { type: Date },
  },
  { timestamps: true }
);

// Queue fetch karte time FIFO order ke liye index (Naye status tracking ke sath optimized)
videoSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model("Video", videoSchema);
