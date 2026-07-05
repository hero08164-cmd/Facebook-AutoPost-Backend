const Video = require("../models/Video");
const {
  uploadVideoToCloudinary,
  deleteVideoFromCloudinary,
} = require("../services/cloudinaryService");

/**
 * POST /api/videos/upload
 * Multiple videos (50-100) ek sath upload - field name: "videos"
 * Har file Cloudinary pe jayegi, phir MongoDB me record banega
 */
const uploadVideos = async (req, res) => {
  try {
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, message: "Koi video file nahi mili" });
    }

    const results = [];
    const errors = [];

    // Sequentially upload karte hain taaki Cloudinary free tier rate limit se bacha rahe
    // (Parallel karna hai to Promise.all bhi kar sakte hain, lekin 100 files ek sath
    // bhejne pe free tier throttle kar sakta hai)
    for (const file of files) {
      try {
        const uploadResult = await uploadVideoToCloudinary(
          file.buffer,
          file.originalname
        );

        const video = await Video.create({
          source: "manual",
          cloudinaryUrl: uploadResult.secure_url,
          cloudinaryPublicId: uploadResult.public_id,
          title: file.originalname,
          status: "pending",
        });

        results.push(video);
      } catch (err) {
        errors.push({ file: file.originalname, error: err.message });
      }
    }

    res.status(201).json({
      success: true,
      uploadedCount: results.length,
      failedCount: errors.length,
      videos: results,
      errors,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/videos/pending
 * Sab pending videos (manual + drive) FIFO order me
 */
const getPendingVideos = async (req, res) => {
  try {
    const videos = await Video.find({ status: "pending" }).sort({ createdAt: 1 });
    res.json({ success: true, count: videos.length, videos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/videos/:id
 * Queue se manually ek video hatani ho (post hone se pehle)
 */
const deleteVideo = async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) {
      return res.status(404).json({ success: false, message: "Video nahi mili" });
    }

    // Manual upload thi to Cloudinary se bhi delete karo
    if (video.source === "manual" && video.cloudinaryPublicId) {
      await deleteVideoFromCloudinary(video.cloudinaryPublicId);
    }

    await video.deleteOne();

    res.json({ success: true, message: "Video delete ho gayi" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { uploadVideos, getPendingVideos, deleteVideo };
