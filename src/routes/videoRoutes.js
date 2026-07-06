const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");
const {
  uploadVideos,
  getPendingVideos,
  deleteVideo,
} = require("../controllers/videoController");

// "videos" field name se multiple files aayengi (max 100 ek sath)
router.post("/upload", upload.array("videos", 100), uploadVideos);
router.get("/pending", getPendingVideos);
router.delete("/:id", deleteVideo);
// Is route ko baaki routes ke sath add kar do
router.delete("/clear-queue", videoController.clearVideoQueue);

module.exports = router;
