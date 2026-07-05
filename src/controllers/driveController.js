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
  makeFilePublic,
  getDirectDownloadLink,
} = require("../services/driveService");

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
 * POST /api/drive/select-folder
 * Body: { folderId, folderName }
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

    let addedCount = 0;
    let skippedCount = 0;

    for (const file of videos) {
      const existing = await Video.findOne({ driveFileId: file.id });
      if (existing) {
        skippedCount++;
        continue;
      }

      try {
        await makeFilePublic(account.refreshToken, file.id);
      } catch (pubErr) {
        console.warn(`File ${file.id} public nahi ho payi, download bypass fallback trigger:`, pubErr.message);
      }

      await Video.create({
        source: "drive",
        driveFileId: file.id,
        driveFileName: file.name,
        driveWebViewLink: getDirectDownloadLink(file.id),
        title: file.name,
        status: "pending",
      });

      addedCount++;
    }

    res.json({
      success: true,
      message: `Folder select ho gaya. ${addedCount} nayi videos queue me add hui, ${skippedCount} pehle se maujood thi (skip ki gayi).`,
      addedCount,
      skippedCount,
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