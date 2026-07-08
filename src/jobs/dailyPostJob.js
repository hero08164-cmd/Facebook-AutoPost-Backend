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
    // 1. Facebook Page Connection Check Karo
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

    // 2. Queue se pehli pending video uthao (Cloudinary Staging/Manual to priority milegi)
    currentVideo = await Video.findOne({ status: "pending", source: "manual" }).sort({ createdAt: 1 });

    // Fallback: Agar subah sync me koi issue hua ho aur source "drive" hi reh gaya ho, toh use safe side uthao
    if (!currentVideo) {
      currentVideo = await Video.findOne({ status: "pending" }).sort({ createdAt: 1 });
    }

    if (!currentVideo) {
      console.log("[CRON] ⚠️ Queue empty hai, koi pending video nahi mili.");
      return;
    }

    // 🎯 Target Cloudinary/CDN URL Setup
    const downloadUrl = currentVideo.source === "manual" ? currentVideo.cloudinaryUrl : currentVideo.driveWebViewLink;

    console.log(`[CRON] 🎬 Processing Started for Video: "${currentVideo.title}" [Source: ${currentVideo.source}]`);
    console.log(`🚀 [BUFF ENGINE] Streaming video chunks from CDN network layer...`);

    // 🚀 STEP 1: Fetch Raw Binary Chunks from Cloudinary CDN
    const videoResponse = await axios.get(downloadUrl, {
      responseType: "arraybuffer",
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    
    const videoBuffer = Buffer.from(videoResponse.data);
    const sizeInMB = (videoBuffer.length / (1024 * 1024)).toFixed(2);
    console.log(`📥 [BUFF ENGINE] CDN Memory Cache Success! Real Size: ${sizeInMB} MB.`);

    // Buffer verification checkpoint
    if (parseFloat(sizeInMB) <= 0.05) {
      throw new Error(`Invalid video content buffer fetched (Size: ${sizeInMB} MB). Stream might be corrupted or 0MB block.`);
    }

    // 🚀 STEP 2: Multipart Payload Structural Packing for Facebook
    const form = new FormData();
    form.append("access_token", token);
    form.append("description", currentVideo.title || "");
    form.append("title", currentVideo.title || "Automated Production Update");
    form.append("published", "true"); // Direct Feed Publication Loop (No Native Drops)

    form.append("source", videoBuffer, {
      filename: `fb_production_clip_${Date.now()}.mp4`,
      contentType: "video/mp4"
    });

    console.log(`📢 [FB LIVE ENGINE] Uploading raw buffer directly to Meta infrastructure... (Absorbing the 20-min window)`);

    // Execution call to Meta Core Graph API
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

    // 🚀 STEP 3: Auto Clean Cloudinary Workspace (Storage space free rakhne ke liye)
    if (currentVideo.source === "manual" && currentVideo.cloudinaryPublicId) {
      console.log(`🧹 [CLEANUP] Purging temporary storage from Cloudinary: ${currentVideo.cloudinaryPublicId}`);
      await deleteVideoFromCloudinary(currentVideo.cloudinaryPublicId).catch((e) =>
        console.error("[CRON] Cloudinary storage cleanup warning:", e.message)
      );
    }

    // DB logs system ko sync karo
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
