// backend/src/jobs/syncDriveToCloudinaryJob.js
const Video = require("../models/Video");
const { uploadVideoToCloudinary } = require("../services/cloudinaryService");
const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");

// 🍪 Cookie-jar wala axios client - Drive ke session cookies persist karne ke liye
// (Isके bina confirm-token bypass bahut baar silently fail hota hai)
const jar = new CookieJar();
const driveClient = wrapper(
  axios.create({
    jar,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
  })
);

/**
 * Drive URL se File ID nikalta hai
 */
const extractFileId = (url) => {
  if (!url) return "";
  if (url.includes("/d/")) return url.split("/d/")[1].split("/")[0];
  if (url.includes("id=")) return url.split("id=")[1].split("&")[0];
  return "";
};

/**
 * 🔥 ADVANCED GOOGLE DRIVE BYPASSER (Cookie-Jar Version)
 * Pehli request se session cookie milta hai + confirm token HTML se nikalta hai,
 * dusri request wahi cookie use karke asli binary file kheenchti hai.
 * Bina cookie jar ke yeh flow random cases mein HTML warning page hi return karta hai.
 */
const downloadDriveFileWithToken = async (driveUrl) => {
  const fileId = extractFileId(driveUrl);
  if (!fileId) {
    throw new Error("Invalid Google Drive URL pattern. File ID extract nahi ho paya.");
  }

  const baseUrl = `https://docs.google.com/uc?export=download&id=${fileId}`;

  console.log(`📡 [DRIVE CORE] Checking virus-scan overlay for File ID: ${fileId}...`);

  // Phase 1: Initial request - cookie jar automatically session cookie store karega
  const initialResponse = await driveClient.get(baseUrl, { responseType: "text" });

  let finalUrl = null;

  if (typeof initialResponse.data === "string" && initialResponse.data.includes("confirm=")) {
    const match = initialResponse.data.match(/confirm=([0-9A-Za-z_-]+)/);
    if (match && match[1]) {
      finalUrl = `${baseUrl}&confirm=${match[1]}`;
      console.log(`⚠️ [DRIVE DETECT] Large file warning detected. Confirm token extracted.`);
    }
  }

  // Phase 2: Agar chhoti file hai (koi warning nahi mila), direct binary already mil chuka hoga
  if (!finalUrl) {
    console.log(`🚀 [DRIVE BYPASS] No warning page detected — checking if response is already binary...`);
    const contentType = initialResponse.headers?.["content-type"] || "";
    if (contentType.includes("video") || contentType.includes("octet-stream")) {
      // Chhoti file - already binary mil chuka
      const rebuffered = await driveClient.get(baseUrl, {
        responseType: "arraybuffer",
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      return Buffer.from(rebuffered.data);
    }
    // Fallback attempt with confirm=t (purana tareeka, last resort)
    finalUrl = `${baseUrl}&confirm=t`;
  }

  console.log(`🚀 [DRIVE BYPASS] Downloading real binary stream (session cookie attached)...`);
  const finalDownload = await driveClient.get(finalUrl, {
    responseType: "arraybuffer",
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  return Buffer.from(finalDownload.data);
};

/**
 * 🛡️ MAGIC-BYTE VALIDATION
 * Size-check ek weak proxy hai. Yeh check actually dekhta hai ki file
 * ek valid MP4 container hai ya nahi (ftyp box signature).
 * HTML warning pages / corrupted streams isse hamesha fail honge, chhoti valid clips pass hongi.
 */
const isValidMp4Buffer = (buffer) => {
  if (!buffer || buffer.length < 12) return false;
  const header = buffer.slice(4, 8).toString("ascii");
  return header === "ftyp";
};

/**
 * Isolated core task loop - executes independently from cron service setup
 */
const runDriveToCloudinarySync = async () => {
  console.log(`\n[MORNING SYNC] ☀️ Google Drive to Cloudinary Sync started - ${new Date().toISOString()}`);
  let video = null;

  try {
    // Database check for pending drive entries
    video = await Video.findOne({ status: "pending", source: "drive" }).sort({ createdAt: 1 });
    if (!video) {
      console.log("[MORNING SYNC] 😎 Aaj ke liye koi pending Google Drive video nahi mili.");
      return;
    }

    console.log(`[MORNING SYNC] 🎬 Staging detected for Drive Video: "${video.title}"`);
    console.log(`🚀 [SYNC ENGINE] Downloading raw buffer from Google Drive (cookie-jar bypass)...`);

    const buffer = await downloadDriveFileWithToken(video.driveWebViewLink);
    const sizeInMB = (buffer.length / (1024 * 1024)).toFixed(2);
    console.log(`📥 [SYNC ENGINE] Drive Buffer Fetched. Size: ${sizeInMB} MB.`);

    // 🛡️ Hard validation checkpoint - size-guess nahi, actual file signature check
    if (!isValidMp4Buffer(buffer)) {
      throw new Error(
        `[CRITICAL BLOCKED] Downloaded content is NOT a valid MP4 (missing ftyp signature). Size was ${sizeInMB} MB. This is almost certainly a Google Drive HTML warning page instead of the real video — bypass failed.`
      );
    }

    console.log(`📤 [SYNC ENGINE] Validated MP4 confirmed. Uploading and caching to Cloudinary CDN...`);
    const base64Video = `data:video/mp4;base64,${buffer.toString("base64")}`;
    const cloudinaryResult = await uploadVideoToCloudinary(base64Video);

    if (cloudinaryResult && cloudinaryResult.secure_url) {
      video.source = "manual";
      video.cloudinaryUrl = cloudinaryResult.secure_url;
      video.cloudinaryPublicId = cloudinaryResult.public_id;
      await video.save();
      console.log(`🎉 [SYNC SUCCESS] Drive Video is now safely staged on Cloudinary CDN!`);
    } else {
      throw new Error("Cloudinary did not return a valid secure_url");
    }
  } catch (error) {
    console.error("[MORNING SYNC CRASH] ❌ Drive caching layer failed:", error.message);

    // Video ko failed mark karo taaki silently queue mein pending na pada rahe
    if (video) {
      video.status = "failed";
      video.draftError = `Drive sync failed: ${error.message}`;
      await video.save().catch(() => {});
    }
  }
};

// 🎯 Export explicitly to prevent non-existent property warnings
module.exports = { runDriveToCloudinarySync, downloadDriveFileWithToken, isValidMp4Buffer };
