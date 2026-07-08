// backend/src/services/cronService.js
const cron = require("node-cron");
const Settings = require("../models/Settings");
const { runDailyPostJob } = require("../jobs/dailyPostJob");
const { runDriveToCloudinarySync } = require("../jobs/syncDriveToCloudinaryJob"); // ☀️ Morning Sync Import

let scheduledTask = null; // Current active evening cron
let morningSyncTask = null; // ☀️ Subah ka task reference
let isJobRunning = false;

const timeToCronExpressionWith20MinBuffer = (time) => {
  let [hour, minute] = time.split(":").map(Number);
  minute = minute - 20;
  if (minute < 0) {
    minute = 60 + minute;
    hour = hour - 1;
    if (hour < 0) hour = 23;
  }
  return `${minute} ${hour} * * *`;
};

/**
 * Dono Jobs ko schedule karne wala Master Engine
 */
const scheduleJob = (targetTime) => {
  // --- EVENING POST LOOP SHIFT ---
  if (scheduledTask) {
    scheduledTask.stop();
    console.log(`[CRON SERVICE] Purani scheduled evening job ko stop kiya gaya.`);
  }

  const eveningExpression = timeToCronExpressionWith20MinBuffer(targetTime);

  scheduledTask = cron.schedule(
    eveningExpression, 
    async () => {
      console.log(`\n[CRON] ⏰ 20-Minute Window Match Hua! Evening publish action triggered...`);
      if (isJobRunning) return;
      try {
        isJobRunning = true;
        await runDailyPostJob();
      } catch (error) {
        console.error(`[CRON SERVICE ERROR]:`, error.message);
      } finally {
        isJobRunning = false;
        console.log(`[CRON SERVICE] Evening Lock released.`);
      }
    },
    { scheduled: true, timezone: "Asia/Kolkata" }
  );

  // --- ☀️ MORNING DRIVE TO CLOUDINARY SYNC LOOP (Sharp 06:00 AM IST) ---
  if (morningSyncTask) {
    morningSyncTask.stop();
  }

  morningSyncTask = cron.schedule(
    "0 6 * * *", // 🎯 Badlaav: Everyday sharp at 06:00 AM India Time
    async () => {
      console.log(`\n[CRON] ☀️ Sharp 6:00 AM Ho Gaya! Starting Google Drive Auto-Sync...`);
      await runDriveToCloudinarySync();
    },
    { scheduled: true, timezone: "Asia/Kolkata" }
  );

  console.log(`[CRON SERVICE] ☀️ Morning Drive-Sync locked daily at: "06:00 AM" [IST]`);
  console.log(`[CRON SERVICE] 🎯 Target Live Goal: ${targetTime} | Background Upload Scheduled at Expression: "${eveningExpression}" (20 Mins Earlier) [Timezone: Asia/Kolkata]`);
};

const initCronJob = async () => {
  try {
    let settings = await Settings.findOne({ key: "app_settings" });
    if (!settings) {
      settings = await Settings.create({
        key: "app_settings",
        cronTime: process.env.DEFAULT_CRON_TIME || "18:00", 
      });
    }
    scheduleJob(settings.cronTime);
  } catch (err) {
    console.error("❌ [CRON INIT ERROR]:", err.message);
  }
};

const rescheduleJob = (newTime) => {
  console.log(`[CRON SERVICE] Panel rescheduling triggered for target: ${newTime}`);
  scheduleJob(newTime);
};

module.exports = { initCronJob, rescheduleJob };
