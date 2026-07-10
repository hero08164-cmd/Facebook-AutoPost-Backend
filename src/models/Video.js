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
      // 🎯 UPDATE: 'scheduled' add kiya — Facebook ke native scheduler (scheduled_publish_time)
      // ke through upload ho chuki hai lekin abhi tak Facebook ne khud publish confirm nahi kiya.
      // 'uploading_draft' processing-in-progress marker ke roop mein rakha hai (overlap-prevention).
      enum: ["pending", "uploading_draft", "scheduled", "posted", "failed"],
      default: "pending",
    },
    // 🎯 Facebook Native Scheduling Pipeline ke liye fields
    fbVideoId: {
      type: String,
      default: null, // Facebook se milne wali video ID yahan save hogi
    },
    isUploadedAsDraft: {
      type: Boolean,
      default: false, // Jab Facebook ko scheduled_publish_time ke saath upload ho jaaye toh true
    },
    draftError: {
      type: String,
      default: null, // Agar upload/verification ke waqt koi dikkat aayi toh log hoga
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
