// backend/src/jobs/dailyPostJob.js
const Video = require("../models/Video");
const FacebookAccount = require("../models/FacebookAccount");
const PostHistory = require("../models/PostHistory");
const { deleteVideoFromCloudinary } = require("../services/cloudinaryService");
const { isValidMp4Buffer } = require("./syncDriveToCloudinaryJob");
const axios = require("axios");
const FormData = require("form-data");

const FB_GRAPH_URL = "https://graph.facebook.com/v21.0";

// Polling config - Facebook transcoding ke liye
const POLL_INTERVAL_MS = 30000; // 30 sec
const MAX_POLL_ATTEMPTS = 15; // 15 x 30s = 7.5 minutes cutoff

/**
 * Facebook video processing status ko poll karta hai jab tak "ready", "error" na mile
 * ya timeout na ho jaaye. Video ID milna = success NAHI hota, yeh confirm karta hai asli status.
 */
const waitForFacebookProcessing = async (videoId, token) => {
  let attempts = 0;

  while (attempts < MAX_POLL_ATTEMPTS) {
    attempts++;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    console.log(`⏳ [POLLING] Checking transcode status on Meta (Attempt ${attempts}/${MAX_POLL_ATTEMPTS})...`);

    const statusCheck = await axios.get(`${FB_GRAPH_URL}/${videoId}`, {
      params: { fields: "status", access_token: token },
    });

    const videoStatus = statusCheck.data?.status?.video_status;
    console.log(`📉 [META STATUS RESPONSE]: ${videoStatus}`);

    if (videoStatus === "ready") {
      console.log(`🎉 [PROVEN SUCCESS] Meta processing complete! Video is officially LIVE.`);
      return { ready: true };
    }

    if (videoStatus === "error" || videoStatus === "invalid") {
      throw new Error(
        `Meta transcoding pipeline rejected the video. Status: "${videoStatus}". Full detail: ${JSON.stringify(
          statusCheck.data.status
        )}`
      );
    }
    // "processing" ya "uploading" ho to loop continue karega
  }

  throw new Error(
    `Meta background transcoding timed out after ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 60000} minutes. Video was accepted but never confirmed "ready".`
  );
};

const runDailyPostJob = async () => {
  console.log(`\n[CRON] Daily post job engine shuru hua - ${new Date().toISOString()}`);
  let currentVideo = null;

  try {
    // 1. Facebook Page Connection Check Karo
    const fbAccount = await FacebookAccount.findOne({
      $or: [{ isConnected: true }, { connected: true }, { pageId: { $exists: true, $ne: "" } }],
    });

    if (!fbAccount || !fbAccount.pageId) {
      console.log("[CRON] ❌ Facebook Page details database me nahi mili. Job skip.");
      return;
    }

    const token = fbAccount.accessToken || fbAccount.pageAccessToken;
    console.log(`[CRON] ✅ Target Facebook Page Connection: ${fbAccount.pageName || fbAccount.pageId}`);

    // 2. Queue se pehli pending video uthao — SIRF Cloudinary (source: "manual") wali videos.
    // ⚠️ Drive fallback jaan-bujh kar HATA diya gaya hai. Agar koi video "drive" status
    // mein phasi hai (subah ka Cloudinary sync fail/pending hai), yeh job use IGNORE karega
    // — us video ka status "pending" hi rahega jab tak Cloudinary sync use "manual" na bana de.
    currentVideo = await Video.findOne({ status: "pending", source: "manual" }).sort({ createdAt: 1 });

    if (!currentVideo) {
      console.log(
        "[CRON] ⚠️ Cloudinary queue empty hai (koi 'manual' source pending video nahi mili). " +
          "Agar Drive se videos pending pade hain, unka subah ka Cloudinary sync check karo."
      );
      return;
    }

    console.log(`[CRON] 🎬 Processing Started for Video: "${currentVideo.title}" [Source: ${currentVideo.source}]`);
    console.log(`🚀 [BUFF ENGINE] Streaming video chunks from Cloudinary CDN...`);

    // 🚀 STEP 1: Fetch Raw Binary Chunks — hamesha Cloudinary se, kabhi Drive se nahi
    const videoResponse = await axios.get(currentVideo.cloudinaryUrl, {
      responseType: "arraybuffer",
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    const videoBuffer = Buffer.from(videoResponse.data);
    const sizeInMB = (videoBuffer.length / (1024 * 1024)).toFixed(2);
    console.log(`📥 [BUFF ENGINE] CDN Memory Cache Success! Real Size: ${sizeInMB} MB.`);

    // 🛡️ Hard validation checkpoint - magic-byte check, size-guess nahi
    // (Cloudinary khud content-type validate nahi karta, isliye yeh check yahan bhi zaroori hai)
    if (!isValidMp4Buffer(videoBuffer)) {
      throw new Error(
        `[CRITICAL BLOCKED] CDN se fetched content valid MP4 nahi hai (Size: ${sizeInMB} MB). File corrupted ho sakti hai ya upstream Drive sync fail hua tha.`
      );
    }

    // 🚀 STEP 2: Multipart Payload Structural Packing for Facebook
    const form = new FormData();
    form.append("access_token", token);
    form.append("description", currentVideo.title || "");
    form.append("title", currentVideo.title || "Automated Production Update");
    form.append("published", "true");

    form.append("source", videoBuffer, {
      filename: `fb_production_clip_${Date.now()}.mp4`,
      contentType: "video/mp4",
    });

    console.log(`📢 [FB LIVE ENGINE] Uploading raw buffer to Meta infrastructure...`);

    // Execution call to Meta Core Graph API
    const { data } = await axios.post(`${FB_GRAPH_URL}/${fbAccount.pageId}/videos`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    const fbVideoId = data.id;
    console.log(`📡 [ASYNC CAPTURE] Meta accepted binary. Temp ID: ${fbVideoId}. Starting real status verification...`);

    // 🚀 STEP 3: REAL SUCCESS CHECK — video ID milna success nahi hai, yeh confirm karta hai
    await waitForFacebookProcessing(fbVideoId, token);

    // 🚀 STEP 4: Auto Clean Cloudinary Workspace (sirf ab jab confirm ho gaya video live hai)
    if (currentVideo.cloudinaryPublicId) {
      console.log(`🧹 [CLEANUP] Purging temporary storage from Cloudinary: ${currentVideo.cloudinaryPublicId}`);
      await deleteVideoFromCloudinary(currentVideo.cloudinaryPublicId).catch((e) =>
        console.error("[CRON] Cloudinary storage cleanup warning:", e.message)
      );
    }

    // DB logs system ko sync karo - ab yeh 100% verified fact hai, guess nahi
    currentVideo.status = "posted";
    currentVideo.postedAt = new Date();
    currentVideo.fbVideoId = fbVideoId;
    await currentVideo.save();

    await PostHistory.create({
      videoRef: currentVideo._id,
      videoTitle: currentVideo.title,
      source: currentVideo.source,
      status: "success",
      fbPostId: fbVideoId,
      postedAt: new Date(),
    });
  } catch (postError) {
    const errMsg = postError.response?.data?.error?.message || postError.message;
    console.error("[CRON CORE CRASH] ❌ API Layer failure:", errMsg);

    if (currentVideo) {
      currentVideo.status = "failed";
      currentVideo.draftError = errMsg;
      await currentVideo.save().catch(() => {});
    }

    await PostHistory.create({
      videoRef: currentVideo?._id || null,
      videoTitle: currentVideo?.title || "Unknown Video",
      source: currentVideo?.source || "unknown",
      status: "failed",
      errorMessage: errMsg,
      postedAt: new Date(),
    });
  }
};

module.exports = { runDailyPostJob };
