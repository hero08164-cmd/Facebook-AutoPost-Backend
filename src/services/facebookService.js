const axios = require("axios");
const FacebookAccount = require("../models/FacebookAccount");

const FB_GRAPH_URL = "https://graph.facebook.com/v21.0";

/**
 * Step 1: Facebook login/consent URL banata hai
 */
const getFacebookLoginUrl = () => {
  const params = new URLSearchParams({
    client_id: process.env.FB_APP_ID,
    redirect_uri: process.env.FB_REDIRECT_URI,
    scope: [
      "pages_show_list",
      "pages_manage_posts",
      "pages_read_engagement",
      "publish_video",
    ].join(","),
    response_type: "code",
  });

  return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
};

/**
 * Step 2: Callback se mile "code" ko short-lived user access token me exchange karo
 */
const exchangeCodeForUserToken = async (code) => {
  const { data } = await axios.get(`${FB_GRAPH_URL}/oauth/access_token`, {
    params: {
      client_id: process.env.FB_APP_ID,
      client_secret: process.env.FB_APP_SECRET,
      redirect_uri: process.env.FB_REDIRECT_URI,
      code,
    },
  });
  return data.access_token;
};

/**
 * Step 3: Short-lived token ko long-lived (60 din) user token me convert karo
 */
const getLongLivedUserToken = async (shortLivedToken) => {
  const { data } = await axios.get(`${FB_GRAPH_URL}/oauth/access_token`, {
    params: {
      grant_type: "fb_exchange_token",
      client_id: process.env.FB_APP_ID,
      client_secret: process.env.FB_APP_SECRET,
      fb_exchange_token: shortLivedToken,
    },
  });
  return data.access_token;
};

/**
 * Step 4: User ke Pages list karo
 */
const getUserPages = async (longLivedUserToken) => {
  const { data } = await axios.get(`${FB_GRAPH_URL}/me/accounts`, {
    params: { access_token: longLivedUserToken },
  });
  return data.data;
};

/**
 * 🎯 SYSTEM 2.0 - STEP A: Video ko Facebook par DRAFT (Unpublished) upload karna
 */
const uploadVideoAsDraft = async (pageId, pageAccessToken, videoUrl, description = "") => {
  let finalPageId = pageId;
  let finalToken = pageAccessToken;

  if (!finalPageId || !finalToken) {
    const dbAccount = await FacebookAccount.findOne();
    if (dbAccount) {
      finalPageId = dbAccount.pageId;
      finalToken = dbAccount.accessToken;
    }
  }

  if (!finalPageId || !finalToken) {
    throw new Error("Facebook Credentials completely missing or undefined!");
  }

  console.log(`🚀 [FB DRAFT UPLOAD] Downloading heavy movie clip buffer for Page ID: ${finalPageId}`);

  const videoResponse = await axios.get(videoUrl, {
    responseType: "arraybuffer",
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  const videoBuffer = Buffer.from(videoResponse.data);

  console.log(`📥 [FB DRAFT UPLOAD] File cached. Size: ${(videoBuffer.length / (1024 * 1024)).toFixed(2)} MB. Formatting multipart form...`);

  const FormData = require("form-data");
  const form = new FormData();
  form.append("access_token", finalToken);
  form.append("description", description);
  form.append("title", description || "New Movie Clip");
  form.append("published", "false"); // Draft Mode

  form.append("source", videoBuffer, {
    filename: `movie_clip_${Date.now()}.mp4`,
    contentType: "video/mp4",
  });

  console.log(`📢 [FB DRAFT UPLOAD] Sending multipart stream as DRAFT to Facebook...`);

  const { data } = await axios.post(
    `${FB_GRAPH_URL}/${finalPageId}/videos`,
    form,
    {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    }
  );

  console.log(`✅ [FB DRAFT SUCCESS] Video uploaded as Draft! Facebook Video ID: ${data.id}`);
  return data;
};

/**
 * 🎯 SYSTEM 2.0 - STEP B: Pehle se uploaded Draft video ko INSTANT PUBLIC karna
 * FIX: Token ko URL parameters me explicitly pass kiya hai taaki Permission block bypass ho jaye!
 */
const publishDraftVideo = async (pageAccessToken, videoId) => {
  let finalToken = pageAccessToken;

  if (!finalToken) {
    const dbAccount = await FacebookAccount.findOne();
    if (dbAccount) finalToken = dbAccount.accessToken;
  }

  if (!finalToken || !videoId) {
    throw new Error("Missing access token or videoId for instant publishing!");
  }

  console.log(`⚡ [FB INSTANT PUBLISH] Triggering public action for Video ID: ${videoId}`);

  // 🎯 FIX: Query string parameters me token bhejna aur 'is_published' use karna full-proof hai
  const { data } = await axios.post(
    `${FB_GRAPH_URL}/${videoId}`,
    {
      is_published: true // Command to make it live
    },
    {
      params: {
        access_token: finalToken // URL level authorization bypass
      }
    }
  );

  console.log(`🎉 [FB PUBLISH SUCCESS] Video is now live on Page!`);
  return data; 
};

module.exports = {
  getFacebookLoginUrl,
  exchangeCodeForUserToken,
  getLongLivedUserToken,
  getUserPages,
  uploadVideoAsDraft,
  publishDraftVideo,
};
