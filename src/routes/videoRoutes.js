const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");
const {
  uploadVideos,
  getPendingVideos,
  deleteVideo,
  clearVideoQueue, // 🎯 FIX: clearVideoQueue ko yahan destructure kar ke add kar diya
} = require("../controllers/videoController");

// "videos" field name se multiple files aayengi (max 100 ek sath)
router.post("/upload", upload.array("videos", 100), uploadVideos);
router.get("/pending", getPendingVideos);

// 🎯 FIX: Isko :id wale route se UPAR rakhna zaroori hai, 
// nahi toh Git/Express "clear-queue" ko ek ID samajh baithega!
router.delete("/clear-queue", clearVideoQueue);

router.delete("/:id", deleteVideo);

module.exports = router;
