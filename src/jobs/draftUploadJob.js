// backend/src/jobs/draftUploadJob.js
const Video = require("../models/Video");
const FacebookAccount = require("../models/FacebookAccount");
const PostHistory = require("../models/PostHistory");
const { isValidMp4Buffer } = require("./syncDriveToCloudinaryJob");
const axios = require("axios");
const FormData = require("form-data");

const FB_GRAPH_URL = "https://graph.facebook.com/v21.0";

const POLL_INTERVAL_MS = 30000; // 30 sec
const MAX_POLL_ATTEMPTS = 15; // 15 x 30s = 7.5 minutes cutoff

/**
 * Facebook video processing status poll karta hai jab tak "ready", "error" na mile ya timeout ho.
 * Draft (unpublished) videos bhi same transcoding pipeline se guzarti hain, isliye
 * publish karne se pehle "ready" confirm karna zaroori hai.
 */
const waitForFacebookProcessing = async (videoId, token) => {
  let attempts = 0;

  while (attempts < MAX_POLL_ATTEMPTS) {
    attempts++;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    console.log(`⏳ [DRAFT POLLING] Checking transcode status (Attempt ${attempts}/${MAX_POLL_ATTEMPTS})...`);

    const statusCheck = await axios.get(`${FB_GRAPH_URL}/${videoId}`, {
      params: { fields: "status", access_token: token },
    });

    const videoStatus = statusCheck.data?.status?.video_status;
    console.log(`📉 [DRAFT STATUS]: ${videoStatus}`);

    if (videoStatus === "ready") {
      return true;
    }

    if (videoStatus === "error" || videoStatus === "invalid") {
      throw new Error(
        `Meta transcoding pipeline rejected the draft. Status: "${videoStatus}". Detail: ${JSON.stringify(
          statusCheck.data.status
        )}`
      );
    }
    // "processing" ho to loop continue karega
  }

  throw new Error(
    `Draft processing timed out after ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 60000} minutes — video accepted but never confirmed "ready".`
  );
};

/**
 * 🎯 PHASE 1: Video ko Facebook par DRAFT (published:false) ke roop mein upload karta hai,
 * aur transcoding complete hone tak wait karta hai. Yeh target time se pehle (buffer window
 * mein) chalta hai, taaki exact scheduled second pe sirf ek tez "publish" call karni pade,
 * poora upload+processing nahi.
 */
const runDraftUploadJob = async () => {
  console.log(`\n[DRAFT JOB] 🎬 Draft upload job shuru hua - ${new Date().toISOString()}`);
  let currentVideo = null;

  try {
    const fbAccount = await FacebookAccount.findOne({
      $or: [{ isConnected: true }, { connected: true }, { pageId: { $exists: true, $ne: "" } }],
    });

    if (!fbAccount || !fbAccount.pageId) {
      console.log("[DRAFT JOB] ❌ Facebook Page details nahi mili. Job skip.");
      return;
    }

    const token = fbAccount.accessToken || fbAccount.pageAccessToken;

    // Sirf Cloudinary-backed ("manual") pending videos uthao, jo abhi tak draft upload nahi hui
    currentVideo = await Video.findOne({
      status: "pending",
      source: "manual",
      isUploadedAsDraft: false,
    }).sort({ createdAt: 1 });

    if (!currentVideo) {
      console.log("[DRAFT JOB] ⚠️ Koi pending video nahi mili draft upload ke liye.");
      return;
    }

    // Turant status mark karo taaki dusra overlapping run isi video ko dubara na uthaye
    currentVideo.status = "uploading_draft";
    await currentVideo.save();

    console.log(`[DRAFT JOB] 📥 Fetching from Cloudinary: "${currentVideo.title}"...`);
    const videoResponse = await axios.get(currentVideo.cloudinaryUrl, {
      responseType: "arraybuffer",
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    const videoBuffer = Buffer.from(videoResponse.data);
    const sizeInMB = (videoBuffer.length / (1024 * 1024)).toFixed(2);
    console.log(`[DRAFT JOB] 📊 Fetched. Size: ${sizeInMB} MB.`);

    if (!isValidMp4Buffer(videoBuffer)) {
      throw new Error(`[CRITICAL BLOCKED] Cloudinary se fetched content valid MP4 nahi hai (Size: ${sizeInMB} MB).`);
    }

    const form = new FormData();
    form.append("access_token", token);
    form.append("description", currentVideo.title || "");
    form.append("title", currentVideo.title || "Scheduled Upload");
    form.append("published", "false"); // 🎯 DRAFT MODE — abhi public nahi hoga

    // 🔥 FIX FOR "AD POSTS" CONTAINER: Force Meta to handle this as a standard page draft reel
    form.append("video_state", "DRAFT");
    form.append("reel_placement", "facebook_reels");
    form.append("backdate_policy", "no_backdate");

    form.append("source", videoBuffer, {
      filename: `fb_draft_clip_${Date.now()}.mp4`,
      contentType: "video/mp4",
    });

    console.log(`[DRAFT JOB] 📢 Uploading as DRAFT to Meta...`);
    const { data } = await axios.post(`${FB_GRAPH_URL}/${fbAccount.pageId}/videos`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    const fbVideoId = data.id;
    console.log(`[DRAFT JOB] 📡 Draft accepted. Temp ID: ${fbVideoId}. Waiting for processing to finish...`);

    // Publish se pehle confirm karo processing complete ho chuki hai
    await waitForFacebookProcessing(fbVideoId, token);

    currentVideo.fbVideoId = fbVideoId;
    currentVideo.isUploadedAsDraft = true;
    // status "uploading_draft" hi rehta hai — iska naya matlab ab "draft ready, publish ka wait"
    await currentVideo.save();

    console.log(`[DRAFT JOB] 🎉 Draft fully ready & processed: "${currentVideo.title}" (FB ID: ${fbVideoId})`);
  } catch (err) {
    const errMsg = err.response?.data?.error?.message || err.message;
    console.error("[DRAFT JOB CRASH] ❌", errMsg);

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
      errorMessage: `Draft upload failed: ${errMsg}`,
      postedAt: new Date(),
    });
  }
};

module.exports = { runDraftUploadJob };
