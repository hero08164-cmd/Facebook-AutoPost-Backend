// backend/src/jobs/dailyPostJob.js
const Video = require("../models/Video");
const FacebookAccount = require("../models/FacebookAccount");
const PostHistory = require("../models/PostHistory");
const { uploadVideoAsDraft, publishDraftVideo } = require("../services/facebookService");
const { deleteVideoFromCloudinary } = require("../services/cloudinaryService");

/**
 * Ye function daily cron job dwara call hoga (aur /api/schedule/run-now se manually bhi)
 */
const runDailyPostJob = async () => {
  console.log(`\n[CRON] Daily post job start hua - ${new Date().toISOString()}`);

  try {
    // 🎯 Facebook account fetch configuration
    const fbAccount = await FacebookAccount.findOne({
      $or: [
        { isConnected: true },
        { connected: true },
        { pageId: { $exists: true, $ne: "" } }
      ]
    });

    if (!fbAccount || !fbAccount.pageId) {
      console.log("[CRON] ❌ Facebook account connected nahi hai ya database me synced nahi hai. Job skip.");
      return;
    }

    const token = fbAccount.accessToken || fbAccount.pageAccessToken;
    console.log(`[CRON] ✅ Connected Facebook Page mila: ${fbAccount.pageName || fbAccount.pageId}`);

    // FIFO - Agli video nikalne ke liye query (Jo posted ya failed nahi hai)
    // Hum pehle dhoondhenge jo 'uploading_draft' me ho ya 'pending' ho
    let video = await Video.findOne({ status: { $in: ["pending", "uploading_draft"] } }).sort({ createdAt: 1 });

    if (!video) {
      console.log("[CRON] ⚠️ Koi pending ya ready video nahi mili. Aaj kuch post nahi hoga.");
      return;
    }

    let fbVideoId = video.fbVideoId;
    const videoUrl = video.source === "manual" ? video.cloudinaryUrl : video.driveWebViewLink;

    try {
      // 🔄 STAGE 1: Agar video pehle se FB par draft upload NAHI hui hai, toh pehle upload karo
      if (!video.isUploadedAsDraft || !fbVideoId) {
        console.log(`[CRON] 🎬 Video pehle se Draft upload nahi thi. Background upload running for: "${video.title}"`);
        
        video.status = "uploading_draft";
        await video.save();

        const draftResponse = await uploadVideoAsDraft(fbAccount.pageId, token, videoUrl, video.title || "");
        
        fbVideoId = draftResponse.id;
        video.fbVideoId = fbVideoId;
        video.isUploadedAsDraft = true;
        await video.save();
      }

      // ⚡ STAGE 2: Video ab FB par draft hai. Ab ise instant PUBLIC karo!
      console.log(`[CRON] 🚀 Video ready hai. Instant publishing Facebook Video ID: ${fbVideoId}`);
      
      await publishDraftVideo(token, fbVideoId);

      console.log(`🎉 [FB SUCCESS] Video is now LIVE on Facebook Page!`);

      // Cleanup Cloudinary space if manual
      if (video.source === "manual" && video.cloudinaryPublicId) {
        await deleteVideoFromCloudinary(video.cloudinaryPublicId).catch((e) =>
          console.error("[CRON] Cloudinary delete warning:", e.message)
        );
      }

      // MongoDB update
      video.status = "posted";
      video.postedAt = new Date();
      await video.save();

      // Log to history
      await PostHistory.create({
        videoRef: video._id,
        videoTitle: video.title,
        source: video.source,
        status: "success",
        fbPostId: fbVideoId,
        postedAt: new Date(),
      });

    } catch (postError) {
      const errMsg = postError.response?.data?.error?.message || postError.message;
      console.error("[CRON] ❌ Process fail hua:", errMsg);

      video.status = "failed";
      video.draftError = errMsg;
      await video.save();

      await PostHistory.create({
        videoRef: video._id,
        videoTitle: video.title,
        source: video.source,
        status: "failed",
        errorMessage: errMsg,
        postedAt: new Date(),
      });
    }
  } catch (err) {
    console.error("[CRON] 💥 Job me unexpected error:", err.message);
  }

  console.log("[CRON] Daily post job complete.\n");
};

module.exports = { runDailyPostJob };
