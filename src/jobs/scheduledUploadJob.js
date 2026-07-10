// backend/src/jobs/scheduledUploadJob.js
const Video = require("../models/Video");
const FacebookAccount = require("../models/FacebookAccount");
const PostHistory = require("../models/PostHistory");
const { deleteVideoFromCloudinary } = require("../services/cloudinaryService");
const { isValidMp4Buffer } = require("./syncDriveToCloudinaryJob");
const axios = require("axios");
const FormData = require("form-data");

const FB_GRAPH_URL = "https://graph.facebook.com/v21.0";

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
 *
 * Yeh job target time se BUFFER_MINUTES pehle chalta hai (default 60 min) taaki
 * lambi videos ko upload+processing ka time mil jaaye, lekin publish khud Facebook
 * apne system se exact scheduled_publish_time pe karega.
 */

/**
 * "HH:MM" (IST) target time ko aaj/kal ke Unix timestamp mein convert karta hai.
 * Agar target time already nikal chuka hai aaj ke liye, to kal ke liye set karta hai.
 */
const getNextTargetUnixTimestamp = (targetTimeHHMM) => {
  const [targetHour, targetMinute] = targetTimeHHMM.split(":").map(Number);

  // IST mein abhi ka time nikalo
  const nowIST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

  const targetDate = new Date(nowIST);
  targetDate.setHours(targetHour, targetMinute, 0, 0);

  // Agar target time IST mein already beet chuka hai aaj, to kal ke liye set karo
  if (targetDate <= nowIST) {
    targetDate.setDate(targetDate.getDate() + 1);
  }

  // Facebook ka scheduled_publish_time minimum 10 minute future hona chahiye
  const minAllowed = new Date(nowIST.getTime() + 11 * 60 * 1000);
  if (targetDate < minAllowed) {
    targetDate.setTime(minAllowed.getTime());
  }

  return Math.floor(targetDate.getTime() / 1000);
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

    // Sirf Cloudinary-backed ("manual") pending videos
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

    // Yahan hum "posted" mark nahi karte — video abhi bhi Facebook ke paas scheduled state mein hai.
    // Naya status: "scheduled" — taaki tracking clear rahe ki yeh Facebook ke bharose pe hai ab.
    currentVideo.status = "scheduled";
    currentVideo.fbVideoId = fbVideoId;
    currentVideo.isUploadedAsDraft = true;
    await currentVideo.save();

    // Cloudinary cleanup abhi NAHI karenge — Facebook processing complete hone tak file
    // Cloudinary pe rehne dena safer hai (agar schedule fail ho to retry ke liye source bacha rahega).
    // Cleanup ek alag verification job mein hoga jab Facebook confirm kare video "ready"/live hai.

    await PostHistory.create({
      videoRef: currentVideo._id,
      videoTitle: currentVideo.title,
      source: currentVideo.source,
      status: "scheduled",
      fbPostId: fbVideoId,
      postedAt: new Date(scheduledTimestamp * 1000),
    });
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
    });
  }
};

module.exports = { runScheduledUploadJob };
