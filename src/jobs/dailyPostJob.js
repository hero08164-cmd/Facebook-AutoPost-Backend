const Video = require("../models/Video");
const FacebookAccount = require("../models/FacebookAccount");
const PostHistory = require("../models/PostHistory");
const { postVideoToPage } = require("../services/facebookService");
const { deleteVideoFromCloudinary } = require("../services/cloudinaryService");

/**
 * Ye function daily cron job dwara call hoga (aur /api/schedule/run-now se manually bhi)
 *
 * Steps:
 * 1. Connected FB page nikalo
 * 2. Queue me se sabse purani pending video nikalo (FIFO - createdAt ascending)
 * 3. FB par post karo
 * 4. Success: manual hui to Cloudinary+Mongo se delete, drive hui to status="posted"
 * 5. History table me log karo
 */
const runDailyPostJob = async () => {
  console.log(`\n[CRON] Daily post job start hua - ${new Date().toISOString()}`);

  try {
    const fbAccount = await FacebookAccount.findOne({ connected: true });
    if (!fbAccount) {
      console.log("[CRON] Facebook account connected nahi hai. Job skip.");
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
      const fbResponse = await postVideoToPage(
        fbAccount.pageId,
        fbAccount.pageAccessToken,
        videoUrl,
        video.title || ""
      );

      console.log(`[CRON] Video FB par post ho gayi. FB Post ID: ${fbResponse.id}`);

      // Cleanup / status update source ke hisab se
      if (video.source === "manual") {
        // Manual video - post hone ke baad Cloudinary + MongoDB se delete
        if (video.cloudinaryPublicId) {
          await deleteVideoFromCloudinary(video.cloudinaryPublicId).catch((e) =>
            console.error("[CRON] Cloudinary delete warning:", e.message)
          );
        }
        await video.deleteOne();
      } else {
        // Drive video - delete nahi karni, sirf status update (repeat na ho isliye)
        video.status = "posted";
        video.postedAt = new Date();
        await video.save();
      }

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
