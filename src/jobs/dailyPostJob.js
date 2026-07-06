const Video = require("../models/Video");
const FacebookAccount = require("../models/FacebookAccount");
const PostHistory = require("../models/PostHistory");
const { postVideoToPage } = require("../services/facebookService");
const { deleteVideoFromCloudinary } = require("../services/cloudinaryService");

/**
 * Ye function daily cron job dwara call hoga (aur /api/schedule/run-now se manually bhi)
 */
const runDailyPostJob = async () => {
  console.log(`\n[CRON] Daily post job start hua - ${new Date().toISOString()}`);

  try {
    // 🎯 FIX 1: 'connected' ko 'isConnected' kiya kyuki server.js me yahi store ho raha hai
    const fbAccount = await FacebookAccount.findOne({ isConnected: true });
    if (!fbAccount) {
      console.log("[CRON] Facebook account connected nahi hai ya database me synced nahi hai. Job skip.");
      return;
    }

    // FIFO - sabse purani pending video
    const video = await Video.findOne({ status: "pending" }).sort({ createdAt: 1 });

    if (!video) {
      console.log("[CRON] Koi pending video nahi mili. Aaj kuch post nahi hoga.");
      return;
    }

    const videoUrl = video.source === "manual" ? video.cloudinaryUrl : video.driveWebViewLink;

    try {
      // 🎯 FIX 2: 'fbAccount.pageAccessToken' ko badal kar 'fbAccount.accessToken' kiya jo sahi field hai
      const fbResponse = await postVideoToPage(
        fbAccount.pageId,
        fbAccount.accessToken, 
        videoUrl,
        video.title || ""
      );

      console.log(`[CRON] Video FB par post ho gayi. FB Post ID: ${fbResponse.id}`);

      // Cleanup / status update source ke hisab se
      if (video.source === "manual") {
        // Manual video - post hone ke baad Cloudinary space khali karo
        if (video.cloudinaryPublicId) {
          await deleteVideoFromCloudinary(video.cloudinaryPublicId).catch((e) =>
            console.error("[CRON] Cloudinary delete warning:", e.message)
          );
        }
      }

      // 🎯 FIX 3: Video ko MongoDB se permanent DELETE karne ki jagah status="posted" karo,
      // taaki Dashboard aur History section me iska data reference bana rahe aur crash na ho.
      video.status = "posted";
      video.postedAt = new Date();
      await video.save();

      // History collection me success state log karo
      await PostHistory.create({
        videoRef: video._id,
        videoTitle: video.title,
        source: video.source,
        status: "success",
        fbPostId: fbResponse.id,
        postedAt: new Date(),
      });

    } catch (postError) {
      // FB post fail hui (token expire, rate limit, invalid url, etc.)
      const errMsg = postError.response?.data?.error?.message || postError.message;
      console.error("[CRON] FB post fail hui:", errMsg);
      console.error("[CRON] Full error detail:", JSON.stringify(postError.response?.data || postError.message, null, 2));

      video.status = "failed";
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
    console.error("[CRON] Job me unexpected error:", err.message);
  }

  console.log("[CRON] Daily post job complete.\n");
};

module.exports = { runDailyPostJob };
