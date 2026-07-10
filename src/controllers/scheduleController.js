const Settings = require("../models/Settings");
const { rescheduleJob } = require("../services/cronService");
const { runScheduledUploadJob } = require("../jobs/scheduledUploadJob");

/**
 * GET /api/schedule/time
 */
const getScheduleTime = async (req, res) => {
  try {
    const settings = await Settings.findOne({ key: "app_settings" });
    res.json({ success: true, cronTime: settings?.cronTime || "18:00" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/schedule/time
 * Body: { time: "19:30" }  (24hr format HH:mm)
 */
const updateScheduleTime = async (req, res) => {
  try {
    const { time } = req.body;
    // Basic validation - "HH:mm" format
    const isValid = /^([01]\d|2[0-3]):([0-5]\d)$/.test(time);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: "Time format galat hai. HH:mm format use karo (e.g. 18:00)",
      });
    }
    await Settings.findOneAndUpdate(
      { key: "app_settings" },
      { cronTime: time },
      { upsert: true, new: true }
    );
    // Live re-schedule - server restart nahi karna padega
    rescheduleJob(time);
    res.json({ success: true, message: `Cron time ${time} par update ho gaya`, cronTime: time });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/schedule/run-now
 * Testing ke liye - turant job trigger karo bina wait kiye
 * ⚠️ UPDATE: Ab purani dailyPostJob ki jagah naya runScheduledUploadJob use hota hai
 * (Facebook ke native scheduled_publish_time ke saath). Isko current saved cronTime
 * chahiye hota hai target time ke roop mein, isliye Settings se fetch karke pass kiya jaata hai.
 */
const runNow = async (req, res) => {
  try {
    const settings = await Settings.findOne({ key: "app_settings" });
    const targetTime = settings?.cronTime || "18:00";

    // Response turant bhej do, job background me chalega (video post hone me time lagega)
    res.json({
      success: true,
      message: "Job trigger ho gaya, kuch second me result History me dikhega",
    });

    runScheduledUploadJob(targetTime).catch((err) => {
      console.error("[RUN NOW] Background job error:", err.message);
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getScheduleTime, updateScheduleTime, runNow };
