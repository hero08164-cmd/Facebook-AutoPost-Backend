// backend/src/jobs/verifyScheduledJob.js
const Video = require("../models/Video");
const FacebookAccount = require("../models/FacebookAccount");
const PostHistory = require("../models/PostHistory");
const { deleteVideoFromCloudinary } = require("../services/cloudinaryService");
const axios = require("axios");

const FB_GRAPH_URL = "https://graph.facebook.com/v21.0";

// Agar scheduled time nikal jaane ke baad bhi itni der (minutes) tak Facebook confirm
// nahi karta ki video publish ho gayi, to failed mark kar denge (stuck-forever se bachne ke liye)
const GRACE_PERIOD_MINUTES = 30;

/**
 * Un sab videos ko check karta hai jo "scheduled" status mein hain (matlab Facebook ke
 * paas already upload ho chuki hain, aur Facebook ka native scheduler unhe publish karega).
 * Yeh job periodically chalta hai (har 15-30 min) aur Facebook se poochta hai — kya
 * video ab is_published ho chuki hai? Agar haan, DB update + Cloudinary cleanup karta hai.
 */
const runVerifyScheduledJob = async () => {
  console.log(`\n[VERIFY JOB] 🔍 Scheduled videos verify ho rahi hain - ${new Date().toISOString()}`);

  try {
    const fbAccount = await FacebookAccount.findOne({
      $or: [{ isConnected: true }, { connected: true }, { pageId: { $exists: true, $ne: "" } }],
    });

    if (!fbAccount) {
      console.log("[VERIFY JOB] ❌ Facebook account nahi mila. Skip.");
      return;
    }

    const token = fbAccount.accessToken || fbAccount.pageAccessToken;

    const scheduledVideos = await Video.find({ status: "scheduled", fbVideoId: { $exists: true, $ne: null } });

    if (scheduledVideos.length === 0) {
      console.log("[VERIFY JOB] ✅ Koi pending scheduled video nahi hai check karne ke liye.");
      return;
    }

    for (const video of scheduledVideos) {
      try {
        const { data } = await axios.get(`${FB_GRAPH_URL}/${video.fbVideoId}`, {
          params: { fields: "is_published,status,scheduled_publish_time", access_token: token },
        });

        console.log(
          `[VERIFY JOB] 📋 "${video.title}" — is_published: ${data.is_published}, video_status: ${data.status?.video_status}`
        );

        if (data.is_published === true) {
          console.log(`[VERIFY JOB] 🎉 CONFIRMED LIVE: "${video.title}"`);

          if (video.cloudinaryPublicId) {
            await deleteVideoFromCloudinary(video.cloudinaryPublicId).catch((e) =>
              console.error("[VERIFY JOB] Cloudinary cleanup warning:", e.message)
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
            fbPostId: video.fbVideoId,
            postedAt: new Date(),
          });
        } else {
          // Abhi tak publish nahi hui — check karo grace period nikal gaya kya
          const scheduledMs = video.postedAt ? new Date(video.postedAt).getTime() : 0;
          const graceDeadline = scheduledMs + GRACE_PERIOD_MINUTES * 60 * 1000;

          if (scheduledMs && Date.now() > graceDeadline) {
            throw new Error(
              `Scheduled time nikal gaya (+${GRACE_PERIOD_MINUTES} min grace) lekin Facebook ne abhi tak publish nahi kiya. Manual check zaroori hai.`
            );
          }
          console.log(`[VERIFY JOB] ⏳ "${video.title}" abhi bhi Facebook ke schedule queue mein hai, wait karo.`);
        }
      } catch (videoErr) {
        console.error(`[VERIFY JOB] ❌ "${video.title}" verify karte waqt error:`, videoErr.message);
        video.status = "failed";
        video.draftError = `Verification failed: ${videoErr.message}`;
        await video.save().catch(() => {});
      }
    }
  } catch (err) {
    console.error("[VERIFY JOB CRASH] ❌", err.message);
  }
};

module.exports = { runVerifyScheduledJob };
