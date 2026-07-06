const PostHistory = require("../models/PostHistory");

/**
 * GET /api/posts/history
 * Sab posts ki history, latest pehle
 */
const getPostHistory = async (req, res) => {
  try {
    // 🎯 Note: Agar database me 'postedAt' ki jagah 'createdAt' use ho raha ho, toh ise 'createdAt' kar dena.
    const history = await PostHistory.find().sort({ postedAt: -1 }).limit(100);
    
    return res.json({ 
      success: true, 
      count: history.length, 
      history 
    });
  } catch (err) {
    console.error("Error in getPostHistory controller:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/posts/status/:id
 * Ek specific video ki post history dekhne ke liye
 */
const getPostStatusByVideoId = async (req, res) => {
  try {
    const record = await PostHistory.findOne({ videoRef: req.params.id }).sort({ postedAt: -1 });
    
    // 🎯 FIX: 404 Error status code hataya taaki Frontend console me crash na ho (AxiosError runtime safe)
    if (!record) {
      return res.json({ 
        success: true, 
        posted: false, 
        message: "Is video ki koi post history nahi mili" 
      });
    }
    
    // Dono parameters bhej rahe hain taaki agar frontend 'record' ya 'post' me se kuch bhi dhoondhe, toh chal jaye
    return res.json({ 
      success: true, 
      posted: true, 
      record, 
      post: record 
    });
  } catch (err) {
    console.error("Error in getPostStatusByVideoId controller:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { 
  getPostHistory, 
  getPostStatusByVideoId 
};
