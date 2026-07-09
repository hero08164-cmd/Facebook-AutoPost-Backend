// backend/src/controllers/driveController.js
const GoogleAccount = require("../models/GoogleAccount");
const Settings = require("../models/Settings");
const Video = require("../models/Video");
const {
  getGoogleAuthUrl,
  getTokensFromCode,
  getGoogleUserEmail,
  listDriveFolders,
  listVideosInFolder,
  downloadFileBuffer,
} = require("../services/driveService");
const { uploadVideoToCloudinary } = require("../services/cloudinaryService");
const { isValidMp4Buffer } = require("../jobs/syncDriveToCloudinaryJob");

/**
 * GET /api/drive/auth
 * User ko Google consent screen pe redirect karo
 */
const driveAuth = (req, res) => {
  const url = getGoogleAuthUrl();
  res.redirect(url);
};

/**
 * GET /api/drive/callback
 * Google se code milega -> tokens banao -> save karo
 */
const driveCallback = async (req, res) => {
  try {
    const { code, error } = req.query;
    if (error || !code) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?drive_connected=false`);
    }

    const tokens = await getTokensFromCode(code);

    // 💡 BUG FIX: Google aksar doosre login par refresh_token nahi bhejta jab tak re-consent na ho.
    // Agar missing hai toh purana wala hi retain rakhna zaroori hai.
    if (!tokens.refresh_token) {
      const existingAccount = await GoogleAccount.findOne();
      if (!existingAccount || !existingAccount.refreshToken) {
        return res.redirect(
          `${process.env.FRONTEND_URL}/settings?drive_connected=false&reason=no_refresh_token`
        );
      }
      tokens.refresh_token = existingAccount.refreshToken; // Rollback to saved token
    }

    let email = "hero08164@gmail.com"; // Default fallback email status
    try {
      if (tokens.access_token) {
        email = await getGoogleUserEmail(tokens.access_token);
      }
    } catch (e) {
      // 401 Unauthorized warning ko bypass karke tokens core functionality block nahi hone dega
      console.error("⚠️ Google email fetch warning (non-fatal, proceeding to sync):", e.message);
    }

    await GoogleAccount.findOneAndUpdate(
      {},
      {
        email,
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        accessTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        connected: true,
      },
      { upsert: true, new: true }
    );

    res.redirect(`${process.env.FRONTEND_URL}/settings?drive_connected=true`);
  } catch (err) {
    console.error("Drive Callback Error:", err.message);
    if (err.response?.data) {
      console.error("Drive Callback Full Detail:", JSON.stringify(err.response.data, null, 2));
    }
    res.redirect(`${process.env.FRONTEND_URL}/settings?drive_connected=false`);
  }
};

/**
 * GET /api/drive/status
 */
const driveStatus = async (req, res) => {
  try {
    const account = await GoogleAccount.findOne({ connected: true });
    if (!account) return res.json({ connected: false });
    res.json({ connected: true, email: account.email });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/drive/folders
 */
const getFolders = async (req, res) => {
  try {
    const account = await GoogleAccount.findOne({ connected: true });
    if (!account) {
      return res.status(400).json({ success: false, message: "Google Drive connected nahi hai" });
    }
    const folders = await listDriveFolders(account.refreshToken);
    res.json({ success: true, folders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/drive/folder/:id/videos
 */
const getVideosInFolder = async (req, res) => {
  try {
    const account = await GoogleAccount.findOne({ connected: true });
    if (!account) {
      return res.status(400).json({ success: false, message: "Google Drive connected nahi hai" });
    }
    const videos = await listVideosInFolder(account.refreshToken, req.params.id);
    res.json({ success: true, count: videos.length, videos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * 🚀 CORE WORKER: Ek folder ki saari videos ko background me process karta hai -
 * har video: Drive se authenticated download -> MP4 validate -> Cloudinary upload
 * -> Video document seedha "manual" source ke saath banao.
 * Yeh function AWAIT nahi kiya jaata selectFolder me (fire-and-forget), taaki
 * HTTP request turant respond kar sake aur bade folders ke liye bhi request
 * timeout na ho. Progress sirf server logs me dikhega.
 */
const processFolderInBackground = async (refreshToken, videos, folderName) => {
  let addedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  console.log(`\n[DRIVE SYNC] 🚀 Background sync shuru: "${folderName}" — ${videos.length} videos mili.`);

  for (const file of videos) {
    try {
      const existing = await Video.findOne({ driveFileId: file.id });
      if (existing) {
        skippedCount++;
        continue;
      }

      console.log(`[DRIVE SYNC] 📥 Downloading (authenticated): "${file.name}"...`);
      const buffer = await downloadFileBuffer(refreshToken, file.id);
      const sizeInMB = (buffer.length / (1024 * 1024)).toFixed(2);

      if (!isValidMp4Buffer(buffer)) {
        throw new Error(`Downloaded content valid MP4 nahi hai (Size: ${sizeInMB} MB)`);
      }

      console.log(`[DRIVE SYNC] 📤 Uploading to Cloudinary: "${file.name}" (${sizeInMB} MB)...`);
      // ⚠️ uploadVideoToCloudinary raw Buffer + filename expect karta hai (base64 string nahi)
      const cloudinaryResult = await uploadVideoToCloudinary(buffer, file.name);

      if (!cloudinaryResult?.secure_url) {
        throw new Error("Cloudinary ne valid secure_url return nahi kiya");
      }

      // 🎯 Seedha "manual" source ke saath banao - "drive" status kabhi nahi banega
      await Video.create({
        source: "manual",
        driveFileId: file.id,
        driveFileName: file.name,
        cloudinaryUrl: cloudinaryResult.secure_url,
        cloudinaryPublicId: cloudinaryResult.public_id,
        title: file.name,
        status: "pending",
      });

      addedCount++;
      console.log(`[DRIVE SYNC] ✅ Cloudinary pe ready: "${file.name}"`);
    } catch (fileErr) {
      failedCount++;
      console.error(`[DRIVE SYNC] ❌ Failed: "${file.name}" — ${fileErr.message}`);
      // Is file ko skip karke agli file pe chale jao, poora batch fail nahi hona chahiye
    }
  }

  console.log(
    `[DRIVE SYNC] 🎉 Background sync complete: "${folderName}" — Added: ${addedCount}, Skipped: ${skippedCount}, Failed: ${failedCount}\n`
  );
};

/**
 * POST /api/drive/select-folder
 * Body: { folderId, folderName }
 *
 * 🎯 NAYA BEHAVIOUR: Folder select hote hi is-turant saari videos Drive se
 * authenticated download hoke Cloudinary pe upload ho jaati hain. Queue mein
 * ab kabhi raw "drive" status wali video nahi dikhegi - sirf Cloudinary-backed
 * ("manual") videos dikhengi. Processing background me hoti hai isliye response
 * turant aata hai; actual upload progress server logs me dikhega.
 */
const selectFolder = async (req, res) => {
  try {
    const { folderId, folderName } = req.body;
    if (!folderId) {
      return res.status(400).json({ success: false, message: "folderId zaroori hai" });
    }

    const account = await GoogleAccount.findOne({ connected: true });
    if (!account) {
      return res.status(400).json({ success: false, message: "Google Drive connected nahi hai" });
    }

    // App Settings update state
    await Settings.findOneAndUpdate(
      { key: "app_settings" },
      { activeDriveFolderId: folderId, activeDriveFolderName: folderName || "Google Drive Folder" },
      { upsert: true, new: true }
    );

    const videos = await listVideosInFolder(account.refreshToken, folderId);

    // Turant respond karo — actual download+upload background me chalega
    res.json({
      success: true,
      message: `Folder select ho gaya. ${videos.length} videos mili — yeh ab background me Cloudinary pe upload ho rahi hain. Kuch minute mein queue me dikhna shuru ho jaayengi.`,
      totalFound: videos.length,
    });

    // Fire-and-forget: response bhej diya, ab yeh background me process hoga
    processFolderInBackground(account.refreshToken, videos, folderName || "Google Drive Folder").catch((err) => {
      console.error("[DRIVE SYNC] ❌ Background processing crash:", err.message);
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/drive/active-folder
 */
const getActiveFolder = async (req, res) => {
  try {
    const settings = await Settings.findOne({ key: "app_settings" });
    if (!settings || !settings.activeDriveFolderId) {
      return res.json({ success: true, active: false });
    }
    res.json({
      success: true,
      active: true,
      folderId: settings.activeDriveFolderId,
      folderName: settings.activeDriveFolderName,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  driveAuth,
  driveCallback,
  driveStatus,
  getFolders,
  getVideosInFolder,
  selectFolder,
  getActiveFolder,
};
