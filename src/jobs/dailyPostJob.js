// backend/src/jobs/dailyPostJob.js
const Video = require("../models/Video");
const FacebookAccount = require("../models/FacebookAccount");
const PostHistory = require("../models/PostHistory");
const { deleteVideoFromCloudinary } = require("../services/cloudinaryService");
const axios = require("axios");
const FormData = require("form-data");

const FB_GRAPH_URL = "https://graph.facebook.com/v21.0";

const runDailyPostJob = async () => {
  console.log(`\n[CRON] Daily post job engine shuru hua - ${new Date().toISOString()}`);

  try {
    const fbAccount = await FacebookAccount.findOne({
      $or: [
        { isConnected: true },
        { connected: true },
        { pageId: { $exists: true, $ne: "" } }
      ]
    });

    if (!fbAccount || !fbAccount.pageId) {
      console.log("[CRON] ❌ Facebook Page details database me nahi mili. Job skip.");
      return;
    }

    const token = fbAccount.accessToken || fbAccount.pageAccessToken;
    console.log(`[CRON] ✅ Target Facebook Page Connection: ${fbAccount.pageName || fbAccount.pageId}`);

    // Queue se pehli pending video uthao
    let video = await Video.findOne({ status: "pending" }).sort({ createdAt: 1 });

    if (!video) {
      console.log("[CRON] ⚠️ Queue empty hai, koi pending video nahi mili.");
      return;
    }

    const videoUrl = video.source === "manual" ? video.cloudinaryUrl : video.driveWebViewLink;
    console.log(`[CRON] 🎬 Heavy Processing Started for Video: "${video.title}"`);

    // 🚀 STEP 1: Direct Binary Stream Buffer Extraction (Supports unlimited size chunks via network pipeline)
    console.log(`🚀 [BUFF ENGINE] Downloading movie clip buffer from remote node cloud...`);
    const videoResponse = await axios.get(videoUrl, {
      responseType: "arraybuffer",
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    const videoBuffer = Buffer.from(videoResponse.data);

    console.log(`📥 [BUFF ENGINE] Memory cache success! Size: ${(videoBuffer.length / (1024 * 1024)).toFixed(2)} MB.`);

    // 🚀 STEP 2: Multipart application data structure payload creation
    const form = new FormData();
    form.append("access_token", token);
    form.append("description", video.title || "");
    form.append("title", video.title || "Automated Video Update");
    
    // ⚡ DIRECT UNREJECTABLE LIVE MODE: Seedha permanent post feed par render karo
    form.append("published", "true"); 

    form.append("source", videoBuffer, {
      filename: `fb_production_clip_${Date.now()}.mp4`,
      contentType: "video/mp4",
    });

    console.log(`📢 [FB LIVE ENGINE] Uploading massive stream chunks directly to Facebook servers... (This will absorb the 20-min window)`);

    // Core Facebook REST endpoint mapping execution
    const { data } = await axios.post(
      `${FB_GRAPH_URL}/${fbAccount.pageId}/videos`,
      form,
      {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    console.log(`🎉 [FB SUCCESS] Video successfully deployed & LIVE on Page feed! Video ID: ${data.id}`);

    // 🚀 STEP 3: Space management cleanup for Cloudinary if manual upload
    if (video.source === "manual" && video.cloudinaryPublicId) {
      console.log(`🧹 [CLEANUP] Purging staging cache from Cloudinary: ${video.cloudinaryPublicId}`);
      await deleteVideoFromCloudinary(video.cloudinaryPublicId).catch((e) =>
        console.error("[CRON] Cloudinary storage cleanup warning:", e.message)
      );
    }

    // Local MongoDB state synchronization updates
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
    console.error("[CRON CORE CRASH] ❌ API Layer failure:", errMsg);

    if (video) {
      video.status = "failed";
      video.draftError = errMsg;
      await video.save();
    }

    await PostHistory.create({
      videoRef: video?._id,
      videoTitle: video?.title || "Unknown Video",
      source: video?.source || "unknown",
      status: "failed",
      errorMessage: errMsg,
      postedAt: new Date(),
    });
  }
};

module.exports = { runDailyPostJob };
