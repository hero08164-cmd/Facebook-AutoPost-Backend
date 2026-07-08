// backend/src/jobs/dailyPostJob.js
const Video = require("../models/Video");
const FacebookAccount = require("../models/FacebookAccount");
const PostHistory = require("../models/PostHistory");
const { deleteVideoFromCloudinary } = require("../services/cloudinaryService");
const axios = require("axios");
const FormData = require("form-data");

const FB_GRAPH_URL = "https://graph.facebook.com/v21.0";

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

    // Queue se ek pending video uthao (Bina draft loop me fase)
    let video = await Video.findOne({ status: "pending" }).sort({ createdAt: 1 });

    if (!video) {
      console.log("[CRON] ⚠️ Koi pending ya ready video nahi mila. Aaj kuch post nahi hoga.");
      return;
    }

    const videoUrl = video.source === "manual" ? video.cloudinaryUrl : video.driveWebViewLink;
    console.log(`[CRON] 🎬 Native Scheduling running for: "${video.title}"`);

    try {
      // 🚀 STEP 1: Video File Buffer Extraction (Heavy File Buffer Stream)
      console.log(`🚀 [BUFF ENGINE] Downloading heavy movie clip buffer from source...`);
      const videoResponse = await axios.get(videoUrl, {
        responseType: "arraybuffer",
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      const videoBuffer = Buffer.from(videoResponse.data);

      console.log(`📥 [BUFF ENGINE] Cached successfully. Size: ${(videoBuffer.length / (1024 * 1024)).toFixed(2)} MB.`);

      // 🕒 STEP 2: Time Epoch Seconds Calculation (Exact 1 Hour Delay)
      // Jab ye shaam ko 5:00 baje chalega, toh automatic 6:00 baje ka time stamp banayega
      const currentEpochSeconds = Math.floor(Date.now() / 1000);
      const oneHourInSeconds = 3600; 
      const scheduleTimestamp = currentEpochSeconds + oneHourInSeconds;

      console.log(`⏳ [SCHEDULER] Targeting Facebook Auto-Live Epoch: ${scheduleTimestamp}`);

      // 🚀 STEP 3: Multi-part Payload Request Construction
      const form = new FormData();
      form.append("access_token", token);
      form.append("description", video.title || "");
      form.append("title", video.title || "Automated Movie Clip");
      
      // ⚡ NATIVE INSTRUCTIONS: Facebook server ko background configuration bhejna
      form.append("published", "false"); // Abhi direct page feed par mat dikhao
      form.append("scheduled_publish_time", scheduleTimestamp.toString()); // Exact 1 ghante baad public karo

      form.append("source", videoBuffer, {
        filename: `clip_${Date.now()}.mp4`,
        contentType: "video/mp4",
      });

      console.log(`📢 [FB BULK UPLOAD] Sending multipart stream to Facebook API...`);

      const { data } = await axios.post(
        `${FB_GRAPH_URL}/${fbAccount.pageId}/videos`,
        form,
        {
          headers: form.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        }
      );

      console.log(`🎉 [FB SUCCESS] Video uploaded & native scheduled successfully! Video ID: ${data.id}`);

      // Cleanup Cloudinary space right away if source is manual
      if (video.source === "manual" && video.cloudinaryPublicId) {
        console.log(`🧹 [CLEANUP] Deleting temporary source from Cloudinary...`);
        await deleteVideoFromCloudinary(video.cloudinaryPublicId).catch((e) =>
          console.error("[CRON] Cloudinary delete warning:", e.message)
        );
      }

      // Local tracking database states sync
      video.status = "posted";
      video.postedAt = new Date();
      video.fbVideoId = data.id;
      await video.save();

      await PostHistory.create({
        videoRef: video._id,
        videoTitle: video.title,
        source: video.source,
        status: "success",
        fbPostId: data.id,
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
