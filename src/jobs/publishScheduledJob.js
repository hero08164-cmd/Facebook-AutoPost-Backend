// backend/src/jobs/publishScheduledJob.js
const Video = require("../models/Video");
const FacebookAccount = require("../models/FacebookAccount");
const PostHistory = require("../models/PostHistory");
const { deleteVideoFromCloudinary } = require("../services/cloudinaryService");
const { publishDraftVideo } = require("../services/facebookService");

/**
 * 🎯 PHASE 2: Exact scheduled second pe chalta hai. Video already Facebook ke
 * server par draft ke roop mein fully processed pada hai (Phase 1 se) — yeh sirf
 * ek chhota "is_published: true" API call karta hai, jo turant instant hota hai.
 * Isse timing bilkul precise rehti hai, chahe video kitni bhi lambi kyun na ho.
 */
const runPublishScheduledJob = async () => {
  console.log(`\n[PUBLISH JOB] ⚡ Exact-time publish job shuru hua - ${new Date().toISOString()}`);
  let currentVideo = null;

  try {
    const fbAccount = await FacebookAccount.findOne({
      $or: [{ isConnected: true }, { connected: true }, { pageId: { $exists: true, $ne: "" } }],
    });

    if (!fbAccount || !fbAccount.pageId) {
      console.log("[PUBLISH JOB] ❌ Facebook Page details nahi mili. Job skip.");
      return;
    }

    const token = fbAccount.accessToken || fbAccount.pageAccessToken;

    // Woh video dhoondo jiska draft already upload + processed ho chuka hai
    currentVideo = await Video.findOne({
      status: "uploading_draft",
      isUploadedAsDraft: true,
      fbVideoId: { $exists: true, $ne: null },
    }).sort({ createdAt: 1 });

    if (!currentVideo) {
      console.log(
        "[PUBLISH JOB] ⚠️ Koi draft-ready video nahi mili. Ho sakta hai draft-upload job abhi tak complete nahi hua (buffer window bahut chhota tha), ya koi video schedule mein nahi hai."
      );
      return;
    }

    console.log(`[PUBLISH JOB] ⚡ Publishing: "${currentVideo.title}" (FB ID: ${currentVideo.fbVideoId})...`);

    await publishDraftVideo(token, currentVideo.fbVideoId);

    console.log(`[PUBLISH JOB] 🎉 LIVE! "${currentVideo.title}" is now public on the Page feed.`);

    // Ab cleanup karo — video confirm live ho chuki hai
    if (currentVideo.cloudinaryPublicId) {
      console.log(`[PUBLISH JOB] 🧹 Cleaning up Cloudinary: ${currentVideo.cloudinaryPublicId}`);
      await deleteVideoFromCloudinary(currentVideo.cloudinaryPublicId).catch((e) =>
        console.error("[PUBLISH JOB] Cloudinary cleanup warning:", e.message)
      );
    }

    currentVideo.status = "posted";
    currentVideo.postedAt = new Date();
    await currentVideo.save();

    await PostHistory.create({
      videoRef: currentVideo._id,
      videoTitle: currentVideo.title,
      source: currentVideo.source,
      status: "success",
      fbPostId: currentVideo.fbVideoId,
      postedAt: new Date(),
    });
  } catch (err) {
    const errMsg = err.response?.data?.error?.message || err.message;
    console.error("[PUBLISH JOB CRASH] ❌", errMsg);

    if (currentVideo) {
      currentVideo.status = "failed";
      currentVideo.draftError = `Publish failed: ${errMsg}`;
      await currentVideo.save().catch(() => {});
    }

    await PostHistory.create({
      videoRef: currentVideo?._id || null,
      videoTitle: currentVideo?.title || "Unknown Video",
      source: currentVideo?.source || "unknown",
      status: "failed",
      errorMessage: `Publish failed: ${errMsg}`,
      postedAt: new Date(),
    });
  }
};

module.exports = { runPublishScheduledJob };
