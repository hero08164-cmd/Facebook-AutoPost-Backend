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

/**
 * DELETE /api/videos/clear-queue
 * 🎯 NAYA FEATURE: Saari pending/fetched videos ek sath delete karne ke liye
 * Agar folder badal rahe ho, toh ye saara kachra saaf karega
 */
const clearVideoQueue = async (req, res) => {
  try {
    // 1. Pehle database me jitni bhi manual videos hain unka publicId nikal lo
    const manualVideos = await Video.find({ source: "manual", cloudinaryPublicId: { $exists: true } });
    
    // 2. Cloudinary se manual videos ko sequential clear karo taaki space crash na ho
    for (const vid of manualVideos) {
      try {
        await deleteVideoFromCloudinary(vid.cloudinaryPublicId);
      } catch (cloudErr) {
        console.error(`Cloudinary cleanup failed for ${vid.title}:`, cloudErr.message);
      }
    }

    // 3. Ab poori collection ko database se khali kar do
    const result = await Video.deleteMany({});

    return res.json({
      success: true,
      message: `Queue poori tarah saaf! Total ${result.deletedCount} videos database aur Cloudinary se uda di gayi hain. Now ready for new folder.`
    });
  } catch (err) {
    console.error("Error clearing video queue:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 🎯 Export me clearVideoQueue ko add kar diya hai
module.exports = { uploadVideos, getPendingVideos, deleteVideo, clearVideoQueue };
