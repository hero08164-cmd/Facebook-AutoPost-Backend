// backend/src/jobs/dailyPostJob.js
const Video = require("../models/Video");
const FacebookAccount = require("../models/FacebookAccount");
const PostHistory = require("../models/PostHistory");
const { deleteVideoFromCloudinary } = require("../services/cloudinaryService");
const axios = require("axios");
const FormData = require("form-data");

const FB_GRAPH_URL = "https://graph.facebook.com/v21.0";

/**
 * Normal Google Drive link ko direct downloadable streaming link me badalta hai
 */
const formatDriveUrl = (url) => {
  if (!url) return "";
  if (url.includes("drive.google.com") && (url.includes("/view") || url.includes("id="))) {
    let fileId = "";
    if (url.includes("/d/")) {
      fileId = url.split("/d/")[1].split("/")[0];
    } else if (url.includes("id=")) {
      fileId = url.split("id=")[1].split("&")[0];
    }
    if (fileId) {
      return `https://docs.google.com/uc?export=download&id=${fileId}&confirm=t`;
    }
  }
  return url;
};

const runDailyPostJob = async () => {
  console.log(`\n[CRON] Daily post job engine shuru hua - ${new Date().toISOString()}`);
  let currentVideo = null; // Error scoping fix

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
    currentVideo = await Video.findOne({ status: "pending" }).sort({ createdAt: 1 });

    if (!currentVideo) {
      console.log("[CRON] ⚠️ Queue empty hai, koi pending video nahi mili.");
      return;
    }

    // 🎯 URL Conversion Fallback Matrix
    let initialUrl = currentVideo.source === "manual" ? currentVideo.cloudinaryUrl : currentVideo.driveWebViewLink;
    const downloadUrl = formatDriveUrl(initialUrl);

    console.log(`[CRON] 🎬 Heavy Processing Started for Video: "${currentVideo.title}"`);
    console.log(`🚀 [BUFF ENGINE] Downloading movie clip buffer from remote node cloud...`);

    // 🚀 STEP 1: Direct Binary Stream Buffer Extraction
    const videoResponse = await axios.get(downloadUrl, {
      responseType: "arraybuffer",
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const videoBuffer = Buffer.from(videoResponse.data);
    const sizeInMB = (videoBuffer.length / (1024 * 1024)).toFixed(2);
    console.log(`📥 [BUFF ENGINE] Memory cache success! Size: ${sizeInMB} MB.`);

    if (parseFloat(sizeInMB) <= 0.01) {
      throw new Error("Google Drive Core Link HTML response return kar raha hai, actual mp4 download block hua.");
    }

    // 🚀 STEP 2: Multipart payload data structure creation
    const form = new FormData();
    form.append("access_token", token);
    form.append("description", currentVideo.title || "");
    form.append("title", currentVideo.title || "Automated Video Update");
    form.append("published", "true"); // Direct Feed Live mode

    form.append("source", videoBuffer, {
      filename: `fb_production_clip_${Date.now()}.mp4`,
      contentType: "video/mp4",
    });

    console.log(`📢 [FB LIVE ENGINE] Uploading massive stream chunks directly to Facebook servers...`);

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

    // Space management cleanup
    if (currentVideo.source === "manual" && currentVideo.cloudinaryPublicId) {
      console.log(`🧹 [CLEANUP] Purging staging cache from Cloudinary...`);
      await deleteVideoFromCloudinary(currentVideo.cloudinaryPublicId).catch((e) =>
        console.error("[CRON] Cloudinary storage cleanup warning:", e.message)
      );
    }

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
      postedAt: new Date(),
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
      postedAt: new Date(),
    });
  }
};

module.exports = { runDailyPostJob };
