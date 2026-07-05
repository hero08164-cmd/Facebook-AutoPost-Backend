const FacebookAccount = require("../models/FacebookAccount");
const {
  getFacebookLoginUrl,
  exchangeCodeForUserToken,
  getLongLivedUserToken,
  getUserPages,
} = require("../services/facebookService");

/**
 * GET /api/auth/facebook/login
 * Frontend isko hit karega -> user ko FB login/consent page pe redirect karo
 */
const facebookLogin = (req, res) => {
  const url = getFacebookLoginUrl();
  res.redirect(url);
};

/**
 * GET /api/auth/facebook/callback
 * FB is URL par redirect karega with ?code=xxxx
 */
const facebookCallback = async (req, res) => {
  try {
    const { code, error } = req.query;

    if (error || !code) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/settings?fb_connected=false`
      );
    }

    // Step 1: code -> short lived token
    const shortLivedToken = await exchangeCodeForUserToken(code);

    // Step 2: short lived -> long lived (60 din) user token
    const longLivedToken = await getLongLivedUserToken(shortLivedToken);

    // Step 3: user ke pages fetch karo (page token yahi milta hai, non-expiring)
    const pages = await getUserPages(longLivedToken);

    if (!pages || pages.length === 0) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/settings?fb_connected=false&reason=no_pages`
      );
    }

    // Abhi ke liye pehla page use karte hain
    // (Agar multiple pages ka UI chahiye to /api/auth/facebook/pages banake frontend se select karwa sakte hain)
    const page = pages[0];

    await FacebookAccount.findOneAndUpdate(
      {},
      {
        pageId: page.id,
        pageName: page.name,
        pageAccessToken: page.access_token,
        connected: true,
      },
      { upsert: true, new: true }
    );

    return res.redirect(
      `${process.env.FRONTEND_URL}/settings?fb_connected=true`
    );
  } catch (err) {
    console.error("FB Callback Error:", err.response?.data || err.message);
    return res.redirect(
      `${process.env.FRONTEND_URL}/settings?fb_connected=false`
    );
  }
};

/**
 * GET /api/auth/facebook/status
 * Frontend dashboard load hote hi ye check karega ki FB connected hai ya nahi
 */
const facebookStatus = async (req, res) => {
  try {
    const account = await FacebookAccount.findOne({ connected: true });
    if (!account) {
      return res.json({ connected: false });
    }
    res.json({
      connected: true,
      pageName: account.pageName,
      pageId: account.pageId,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/auth/facebook/disconnect
 * Page disconnect karna ho to
 */
const facebookDisconnect = async (req, res) => {
  try {
    await FacebookAccount.updateMany({}, { connected: false });
    res.json({ success: true, message: "Facebook disconnected" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/auth/facebook/manual-connect
 * Body: { pageId, pageName, pageAccessToken }
 * OAuth ki jhanjhat ke bina - Graph API Explorer se generate kiya hua
 * long-lived Page Access Token seedha yahan paste karke save kar sakte ho
 */
const facebookManualConnect = async (req, res) => {
  try {
    const { pageId, pageName, pageAccessToken } = req.body;

    if (!pageId || !pageAccessToken) {
      return res.status(400).json({
        success: false,
        message: "pageId aur pageAccessToken dono zaroori hain",
      });
    }

    await FacebookAccount.findOneAndUpdate(
      {},
      {
        pageId,
        pageName: pageName || "Unnamed Page",
        pageAccessToken,
        connected: true,
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: "Facebook Page connect ho gayi" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  facebookLogin,
  facebookCallback,
  facebookStatus,
  facebookDisconnect,
  facebookManualConnect,
};
