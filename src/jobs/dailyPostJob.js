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
  let currentVideo = null;

  try {
    // 1. Facebook Page Account Validation
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

    // 2. Queue se pehli pending video uthao (Cloudinary Manual Upload ko high priority)
    currentVideo = await Video.findOne({ status: "pending", source: "manual" }).sort({ createdAt: 1 });

    // Fallback: Agar manual nahi mili, toh normal pending uthao
    if (!currentVideo) {
      currentVideo = await Video.findOne({ status: "pending" }).sort({ createdAt: 1 });
    }

    if (!currentVideo) {
      console.log("[CRON] ⚠️ Queue empty hai, koi pending video nahi mili.");
      return;
    }

    // 🎯 Cloudinary Pure CDN URL Routing
    const downloadUrl = currentVideo.source === "manual" ? currentVideo.cloudinaryUrl : currentVideo.driveWebViewLink;

    console.log(`[CRON] 🎬 Processing Started for Video: "${currentVideo.title}" [Source: ${currentVideo.source}]`);
    console.log(`🚀 [BUFF ENGINE] Streaming chunks from CDN network layer...`);

    // 🚀 STEP 1: Fetch Raw MP4 Binary Chunks from Cloudinary CDN
    const videoResponse = await axios.get(downloadUrl, {
      responseType: "arraybuffer",
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    
    const videoBuffer = Buffer.from(videoResponse.data);
    const sizeInMB = (videoBuffer.length / (1024 * 1024)).toFixed(2);
    console.log(`📥 [BUFF ENGINE] CDN Memory Cache Success! Real Size: ${sizeInMB} MB.`);

    // Strict validation checkpoint
    if (parseFloat(sizeInMB) <= 0.05) {
      throw new Error(`Invalid video content buffer fetched (Size: ${sizeInMB} MB). Stream might be corrupted.`);
    }

    // 🚀 STEP 2: Multi-part Payload structural packing
    const form = new FormData();
    form.append("access_token", token);
    form.append("description", currentVideo.title || "");
    form.append("title", currentVideo.title || "Automated Production Update");
    form.append("published", "true"); // Direct Feed Publication Loop

    form.append("source", videoBuffer, {
      filename: `fb_production_clip_${Date.now()}.mp4`,
      contentType: "video/mp4"
    });

    console.log(`📢 [FB LIVE ENGINE] Uploading raw buffer directly to Meta infrastructure...`);

    const { data } = await axios.post(
      `${FB_GRAPH_URL}/${fbAccount.pageId}/videos`,
      form,
      {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );

    console.log(`🎉 [FB SUCCESS] Video successfully deployed & LIVE on Page feed! Video ID: ${data.id}`);

    // 🚀 STEP 3: Auto Clean Cloudinary Workspace (Storage space bachane ke liye)
    if (currentVideo.source === "manual" && currentVideo.cloudinaryPublicId) {
      console.log(`扫 [CLEANUP] Purging temporary storage from Cloudinary: ${currentVideo.cloudinaryPublicId}`);
      await deleteVideoFromCloudinary(currentVideo.cloudinaryPublicId).catch((e) =>
        console.error("[CRON] Cloudinary storage cleanup warning:", e.message)
      );
    }

    // MongoDB Sync update
    currentVideo.status = "posted";
    currentVideo.postedAt = new Date();
    currentVideo.fbVideoId = data.id;
    await currentVideo.save();

    await PostHistory.create({
      videoRef: currentVideo._id,
      videoTitle: currentVideo.title,
      source: currentVideo.source,
      status: "success",
      fbPostId: data.id,
      postedAt: new Date()
    });

  } catch (postError) {
    const errMsg = postError.response?.data?.error?.message || postError.message;
    console.error("[CRON CORE CRASH] ❌ API Layer failure:", errMsg);

    if (currentVideo) {
      currentVideo.status = "failed";
      currentVideo.draftError = errMsg;
      await currentVideo.save();
    }

    await PostHistory.create({
      videoRef: currentVideo?._id || null,
      videoTitle: currentVideo?.title || "Unknown Video",
      source: currentVideo?.source || "unknown",
      status: "failed",
      errorMessage: errMsg,
      postedAt: new Date()
    });
  }
};

module.exports = { runDailyPostJob };
