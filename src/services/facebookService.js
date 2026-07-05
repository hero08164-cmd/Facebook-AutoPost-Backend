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
 * Direct Multipart Binary Video Upload to Facebook Page 
 * (Sabse reliable method jo token validation check ke sath directly post karta hai)
 */
const postVideoToPage = async (pageId, pageAccessToken, videoUrl, description = "") => {
  let finalPageId = pageId;
  let finalToken = pageAccessToken;

  // 🛡️ Fallback database sync check
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

  console.log(`🚀 [FB DIRECT UPLOAD] Downloading video buffer for Page ID: ${finalPageId}`);

  // Step 1: Video buffer array download karo
  const videoResponse = await axios.get(videoUrl, {
    responseType: "arraybuffer",
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  const videoBuffer = Buffer.from(videoResponse.data);

  console.log(`📥 [FB DIRECT UPLOAD] File downloaded. Size: ${(videoBuffer.length / (1024 * 1024)).toFixed(2)} MB. Creating Multipart Form...`);

  // Step 2: Form Data create karo direct dynamic multipart upload ke liye
  const FormData = require("form-data");
  const form = new FormData();
  form.append("access_token", finalToken);
  form.append("description", description);
  form.append("title", description || "New Video Upload");
  
  // Binary stream configuration directly attach karein
  form.append("source", videoBuffer, {
    filename: `video_${Date.now()}.mp4`,
    contentType: "video/mp4",
  });

  console.log(`📢 [FB DIRECT UPLOAD] Sending multipart stream directly to Facebook endpoint: ${FB_GRAPH_URL}/${finalPageId}/videos`);

  // Step 3: Direct Graph API single hit call
  const { data } = await axios.post(
    `${FB_GRAPH_URL}/${finalPageId}/videos`,
    form,
    {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    }
  );

  console.log(`🎉 [FB SUCCESS] Video posted directly! Post ID: ${data.id}`);
  return data;
};

module.exports = {
  getFacebookLoginUrl,
  exchangeCodeForUserToken,
  getLongLivedUserToken,
  getUserPages,
  postVideoToPage,
};