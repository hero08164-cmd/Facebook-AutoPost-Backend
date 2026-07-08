// backend/src/jobs/syncDriveToCloudinaryJob.js
const Video = require("../models/Video");
const { uploadVideoToCloudinary } = require("../services/cloudinaryService");
const axios = require("axios");

/**
 * Google Drive raw download link formatting layer (No circular imports here)
 */
const formatDriveUrl = (url) => {
  if (!url) return "";
  if (url.includes("drive.google.com")) {
    let fileId = "";
    if (url.includes("/d/")) fileId = url.split("/d/")[1].split("/")[0];
    else if (url.includes("id=")) fileId = url.split("id=")[1].split("&")[0];
    
    if (fileId) return `https://docs.google.com/uc?export=download&id=${fileId}&confirm=t`;
  }
  return url;
};

/**
 * Isolated core task loop - executes independently from cron service setup
 */
const runDriveToCloudinarySync = async () => {
  console.log(`\n[MORNING SYNC] ☀️ Google Drive to Cloudinary Sync started - ${new Date().toISOString()}`);

  try {
    // Database check for pending drive entries
    const video = await Video.findOne({ status: "pending", source: "drive" }).sort({ createdAt: 1 });

    if (!video) {
      console.log("[MORNING SYNC] 😎 Aaj ke liye koi pending Google Drive video nahi mili.");
      return;
    }

    console.log(`[MORNING SYNC] 🎬 Staging detected for Drive Video: "${video.title}"`);
    const targetDownloadUrl = formatDriveUrl(video.driveWebViewLink);

    console.log(`🚀 [SYNC ENGINE] Downloading raw buffer from Google Drive...`);
    const response = await axios.get(targetDownloadUrl, {
      responseType: "arraybuffer",
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const buffer = Buffer.from(response.data);
    console.log(`📥 [SYNC ENGINE] Drive Buffer Fetched. Size: ${(buffer.length / (1024 * 1024)).toFixed(2)} MB.`);

    console.log(`📤 [SYNC ENGINE] Uploading and caching directly to Cloudinary CDN server...`);
    const base64Video = `data:video/mp4;base64,${buffer.toString("base64")}`;
    const cloudinaryResult = await uploadVideoToCloudinary(base64Video); 

    if (cloudinaryResult && cloudinaryResult.secure_url) {
      video.source = "manual";
      video.cloudinaryUrl = cloudinaryResult.secure_url;
      video.cloudinaryPublicId = cloudinaryResult.public_id;
      await video.save();

      console.log(`🎉 [SYNC SUCCESS] Drive Video is now safely staged on Cloudinary CDN!`);
    } else {
      throw new Error("Cloudinary did not return a valid secure secure_url");
    }

  } catch (error) {
    console.error("[MORNING SYNC CRASH] ❌ Drive caching layer failed:", error.message);
  }
};

// 🎯 Export explicitly to prevent non-existent property warnings
module.exports = { runDriveToCloudinarySync };
