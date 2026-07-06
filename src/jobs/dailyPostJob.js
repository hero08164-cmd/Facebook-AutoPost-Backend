// backend/src/jobs/dailyPostJob.js
const Video = require("../models/Video");
const FacebookAccount = require("../models/FacebookAccount");
const PostHistory = require("../models/PostHistory");
const { uploadVideoAsDraft, publishDraftVideo } = require("../services/facebookService");
const { deleteVideoFromCloudinary } = require("../services/cloudinaryService");

// 🎯 Helper function code ko rokne (wait karne) ke liye
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runDailyPostJob = async () => {
  console.log(`\n[CRON] Daily post job start hua - ${new Date().toISOString()}`);

  try {
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

    let video = await Video.findOne({ status: { $in: ["pending", "uploading_draft"] } }).sort({ createdAt: 1 });

    if (!video) {
      console.log("[CRON] ⚠️ Koi pending ya ready video nahi mili. Aaj kuch post nahi hoga.");
      return;
    }

    let fbVideoId = video.fbVideoId;
    const videoUrl = video.source === "manual" ? video.cloudinaryUrl : video.driveWebViewLink;

    try {
      // 🔄 STAGE 1: Agar video draft upload nahi hui hai, toh upload karo
      if (!video.isUploadedAsDraft || !fbVideoId) {
        console.log(`[CRON] 🎬 Video Draft upload running for: "${video.title}"`);
        
        video.status = "uploading_draft";
        await video.save();

        const draftResponse = await uploadVideoAsDraft(fbAccount.pageId, token, videoUrl, video.title || "");
        
        fbVideoId = draftResponse.id;
        video.fbVideoId = fbVideoId;
        video.isUploadedAsDraft = true;
        await video.save();

        // 🎯 FIX: Badi videos (~112MB+) ke liye Facebook ko encode karne ka time chahiye!
        // Agar hum turant publish marenge toh sirf text aayega, video nahi.
        // Isliye hum yahan 5 MINUTE (300,000 ms) ka delay laga rahe hain taaki FB processing khatam kar le.
        console.log(`⏳ [CRON] Video uploaded as draft. Waiting for 5 minutes for Facebook to finish background encoding...`);
        await delay(600000); 
      }

      // ⚡ STAGE 2: Video ab processing queue se nikal chuki hogi. Now publish it!
      console.log(`[CRON] 🚀 Triggering instant publish command for Video ID: ${fbVideoId}`);
      
      await publishDraftVideo(token, fbVideoId);
      console.log(`🎉 [FB SUCCESS] Video is now LIVE on Facebook Page with layout!`);

      // Cleanup Cloudinary space if manual
      if (video.source === "manual" && video.cloudinaryPublicId) {
        await deleteVideoFromCloudinary(video.cloudinaryPublicId).catch((e) =>
          console.error("[CRON] Cloudinary delete warning:", e.message)
        );
      }

      video.status = "posted";
      video.postedAt = new Date();
      await video.save();

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
