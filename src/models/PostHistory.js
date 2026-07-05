const mongoose = require("mongoose");

const postHistorySchema = new mongoose.Schema(
  {
    videoRef: { type: mongoose.Schema.Types.ObjectId, ref: "Video" },
    videoTitle: { type: String },
    source: { type: String, enum: ["manual", "drive"] },

    status: {
      type: String,
      enum: ["success", "failed"],
      required: true,
    },

    fbPostId: { type: String }, // Facebook se mila post id (success case)
    errorMessage: { type: String }, // Failure case me reason

    postedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PostHistory", postHistorySchema);
