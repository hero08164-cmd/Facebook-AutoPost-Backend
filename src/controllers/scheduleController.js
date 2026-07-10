// backend/src/jobs/scheduledUploadJob.js
const Video = require("../models/Video");
const FacebookAccount = require("../models/FacebookAccount");
const PostHistory = require("../models/PostHistory");
const { isValidMp4Buffer } = require("./syncDriveToCloudinaryJob");
const axios = require("axios");
const FormData = require("form-data");

const FB_GRAPH_URL = "https://graph.facebook.com/v21.0";

// India timezone offset — fixed, kabhi DST nahi badalta (5 ghante 30 minute)
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * ⚠️ IMPORTANT FIX (root-cause correction):
 * Pehle wala do-step "draft upload + baad me is_published:true" tareeka Facebook ke
 * apne documentation ke mutabik sirf ADVERTISING ke liye "unpublished video" banata hai
 * (dark post) — isiliye videos "Ad posts" tab mein ja rahi thi, organic Reels/Posts
 * mein kabhi nahi dikh rahi thi.
 *
 * Sahi tareeka: EK hi upload call mein `published: false` + `scheduled_publish_time`
 * (future Unix timestamp) bhejo. Facebook khud us exact time pe organic content ke
 * roop mein publish karega — koi second "publish" cron ki zaroorat nahi.
 */

/**
 * "HH:MM" (IST) target time ko REAL Unix timestamp mein convert karta hai.
 *
 * ⚠️ BUG FIX: Purana version `toLocaleString()` + server ke local timezone (Date object
 * getters/setters) pe depend karta tha — Render ka server UTC mein chalta hai, isliye
 * calculation mein double-shift ho raha tha (video 5.5 ghante LATE publish ho rahi thi).
 * Yeh naya version sirf fixed +5:30 offset ka pure math use karta hai — server ka
 * local timezone kuch bhi ho, result hamesha sahi rahega.
 */
const getNextTargetUnixTimestamp = (targetTimeHHMM) => {
  const [targetHour, targetMinute] = targetTimeHHMM.split(":").map(Number);

  const nowUTCms = Date.now();
  const istNowMs = nowUTCms + IST_OFFSET_MS; // "IST wall-clock" number, UTC ke roop mein represent
  const istNowDate = new Date(istNowMs);

  // Aaj ki date (IST wall-clock ke hisab se) lekar target hour:minute set karo — sab UTC getters/setters
  // use kiye taaki server ka apna local timezone bilkul bhi impact na kare.
  let istTargetMs = Date.UTC(
    istNowDate.getUTCFullYear(),
    istNowDate.getUTCMonth(),
    istNowDate.getUTCDate(),
    targetHour,
    targetMinute,
    0,
    0
  );

  // Agar target time IST mein already beet chuka hai aaj, to kal ke liye set karo
  if (istTargetMs <= istNowMs) {
    istTargetMs += 24 * 60 * 60 * 1000;
  }

  // "IST wall-clock" number ko wapas REAL UTC epoch mein convert karo
  let realTargetUTCms = istTargetMs - IST_OFFSET_MS;

  // Facebook ka scheduled_publish_time minimum 10 minute future hona chahiye
  const minAllowedUTCms = nowUTCms + 11 * 60 * 1000;
  if (realTargetUTCms < minAllowedUTCms) {
    realTargetUTCms = minAllowedUTCms;
  }

  return Math.floor(realTargetUTCms / 1000);
};

const runScheduledUploadJob = async (targetTimeHHMM) => {
  console.log(`\n[SCHEDULE JOB] 🎬 Scheduled upload job shuru hua - ${new Date().toISOString()}`);
  let currentVideo = null;

  try {
    const fbAccount = await FacebookAccount.findOne({
      $or: [{ isConnected: true }, { connected: true }, { pageId: { $exists: true, $ne: "" } }],
    });

    if (!fbAccount || !fbAccount.pageId) {
      console.log("[SCHEDULE JOB] ❌ Facebook Page details nahi mili. Job skip.");
      return;
    }

    const token = fbAccount.accessToken || fbAccount.pageAccessToken;

    currentVideo = await Video.findOne({ status: "pending", source: "manual" }).sort({ createdAt: 1 });

    if (!currentVideo) {
      console.log("[SCHEDULE JOB] ⚠️ Koi pending video nahi mili.");
      return;
    }

    currentVideo.status = "uploading_draft"; // processing-in-progress marker, overlap-prevention ke liye
    await currentVideo.save();

    console.log(`[SCHEDULE JOB] 📥 Fetching from Cloudinary: "${currentVideo.title}"...`);
    const videoResponse = await axios.get(currentVideo.cloudinaryUrl, {
      responseType: "arraybuffer",
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    const videoBuffer = Buffer.from(videoResponse.data);
    const sizeInMB = (videoBuffer.length / (1024 * 1024)).toFixed(2);
    console.log(`[SCHEDULE JOB] 📊 Fetched. Size: ${sizeInMB} MB.`);

    if (!isValidMp4Buffer(videoBuffer)) {
      throw new Error(`[CRITICAL BLOCKED] Cloudinary se fetched content valid MP4 nahi hai (Size: ${sizeInMB} MB).`);
    }

    const scheduledTimestamp = getNextTargetUnixTimestamp(targetTimeHHMM);
    console.log(
      `[SCHEDULE JOB] ⏰ Facebook ko scheduled_publish_time diya jaa raha hai: ${scheduledTimestamp} (Unix) → ${new Date(
        scheduledTimestamp * 1000
      ).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`
    );

    const form = new FormData();
    form.append("access_token", token);
    form.append("description", currentVideo.title || "");
    form.append("title", currentVideo.title || "Scheduled Upload");
    form.append("published", "false"); // Native FB scheduling ke liye required
    form.append("scheduled_publish_time", String(scheduledTimestamp));

    form.append("source", videoBuffer, {
      filename: `fb_scheduled_clip_${Date.now()}.mp4`,
      contentType: "video/mp4",
    });

    console.log(`[SCHEDULE JOB] 📢 Uploading with native Facebook scheduling...`);
    const { data } = await axios.post(`${FB_GRAPH_URL}/${fbAccount.pageId}/videos`, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    const fbVideoId = data.id;
    console.log(`[SCHEDULE JOB] ✅ Facebook ne schedule confirm kar diya. Video ID: ${fbVideoId}`);
    console.log(`[SCHEDULE JOB] 🎉 Yeh video khud Facebook apne system se exact time pe publish karega.`);

    currentVideo.status = "scheduled";
    currentVideo.fbVideoId = fbVideoId;
    currentVideo.isUploadedAsDraft = true;
    await currentVideo.save();

    // ⚠️ BUG FIX: PostHistory model ke "status" enum mein "scheduled" valid value nahi hai
    // (sirf "success"/"failed" allowed hain), isliye yahan PostHistory create NAHI karte.
    // Confirmed "success" entry verifyScheduledJob.js banayega jab Facebook actually
    // publish confirm kar de — yeh zyada accurate bhi hai (upload ≠ confirmed live).

    // Cloudinary cleanup bhi yahan NAHI karte — verifyScheduledJob confirm hone ke baad karega.
  } catch (err) {
    const errMsg = err.response?.data?.error?.message || err.message;
    console.error("[SCHEDULE JOB CRASH] ❌", errMsg);

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
    }).catch((e) => console.error("[SCHEDULE JOB] PostHistory log warning:", e.message));
  }
};

module.exports = { runScheduledUploadJob };
