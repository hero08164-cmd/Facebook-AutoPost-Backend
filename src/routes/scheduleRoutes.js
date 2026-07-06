const Settings = require("../models/Settings");
const { runDailyPostJob } = require("../jobs/dailyPostJob"); // 🎯 Sahi path check karna apne project structure ke hisab se
const { rescheduleJob } = require("../services/cronService");

// Existing getScheduleTime aur updateScheduleTime...

/**
 * GET/POST /api/schedule/run-now
 * 🎯 Manual/Instant Trigger logic
 */
const runNow = async (req, res) => {
  try {
    console.log("⚡ [MANUAL TRIGGER] Client requested instant video post job...");
    
    // Core cron job function ko direct trigger kiya
    await runDailyPostJob();

    return res.json({
      success: true,
      message: "Daily post job execute kar di gayi hai! Backend logs check karein ki video post hui ya fail.",
    });
  } catch (err) {
    console.error("❌ Error in runNow controller:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// module.exports me runNow hona zaroori hai
module.exports = {
  // getScheduleTime,
  // updateScheduleTime,
  runNow
};
