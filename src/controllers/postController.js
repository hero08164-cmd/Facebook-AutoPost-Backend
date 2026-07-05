const PostHistory = require("../models/PostHistory");

/**
 * GET /api/posts/history
 * Sab posts ki history, latest pehle
 */
const getPostHistory = async (req, res) => {
  try {
    const history = await PostHistory.find().sort({ postedAt: -1 }).limit(100);
    res.json({ success: true, count: history.length, history });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/posts/status/:id
 * Ek specific video ki post history dekhne ke liye
 */
const getPostStatusByVideoId = async (req, res) => {
  try {
    const record = await PostHistory.findOne({ videoRef: req.params.id }).sort({ postedAt: -1 });
    if (!record) {
      return res.status(404).json({ success: false, message: "Is video ki koi post history nahi mili" });
    }
    res.json({ success: true, record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getPostHistory, getPostStatusByVideoId };
