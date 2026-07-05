const { google } = require("googleapis");
const axios = require("axios");
const { oauth2Client, SCOPES, getDriveClient } = require("../config/googleDrive");

/**
 * Step 1: Google consent screen ka URL banata hai
 * access_type: "offline" -> refresh_token milega (zaroori hai, warna baar baar login karna padega)
 * prompt: "consent" -> hamesha refresh_token de (Google sirf pehli baar deta hai by default)
 */
const getGoogleAuthUrl = () => {
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
};

/**
 * Step 2: callback se mile code ko tokens me exchange karo
 */
const getTokensFromCode = async (code) => {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens; // { access_token, refresh_token, expiry_date, ... }
};

/**
 * User ki email nikalne ke liye (identification/display ke liye)
 * NOTE: googleapis library ka "oauth2().userinfo.get()" helper kabhi kabhi
 * "missing authentication credential" error deta hai (library ka internal
 * quirk) - isliye seedha REST endpoint ko axios se call kar rahe hain, jo
 * zyada reliable hai
 */
const getGoogleUserEmail = async (accessToken) => {
  const { data } = await axios.get("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data.email;
};

/**
 * User ki Drive me sab folders list karo (root + nested sab, trashed exclude)
 */
const listDriveFolders = async (refreshToken) => {
  const drive = getDriveClient(refreshToken);
  const { data } = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: "files(id, name, parents)",
    pageSize: 200,
  });
  return data.files;
};

/**
 * Ek specific folder ke andar sirf video files list karo
 */
const listVideosInFolder = async (refreshToken, folderId) => {
  const drive = getDriveClient(refreshToken);
  const { data } = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'video/' and trashed=false`,
    fields: "files(id, name, mimeType, webViewLink, createdTime)",
    pageSize: 1000,
  });
  return data.files;
};

/**
 * Video file ko "Anyone with link can view" bana do
 * Zaroori hai kyunki Facebook Graph API file_url se video fetch karta hai -
 * agar file private hui to FB usko download nahi kar payega
 */
const makeFilePublic = async (refreshToken, fileId) => {
  const drive = getDriveClient(refreshToken);
  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
  });
};

/**
 * Public direct-download link banata hai jo Facebook ko diya ja sakta hai
 */
const getDirectDownloadLink = (fileId) => {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
};

module.exports = {
  getGoogleAuthUrl,
  getTokensFromCode,
  getGoogleUserEmail,
  listDriveFolders,
  listVideosInFolder,
  makeFilePublic,
  getDirectDownloadLink,
};