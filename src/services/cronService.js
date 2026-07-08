// backend/src/services/cronService.js
const cron = require("node-cron");
const Settings = require("../models/Settings");
const { runDailyPostJob } = require("../jobs/dailyPostJob");

let scheduledTask = null; // Current active cron task ka reference
let isJobRunning = false; // 🎯 LOCK SYSTEM: Taaki task process hote waqt overlap na ho

/**
 * "HH:mm" (e.g. "18:00") ko uthakar exact 1 ghanta pehle (-1 hour) ka cron expression banata hai
 * Taaki 6:00 PM ke post ke liye upload exact 5:00 PM baje automatic shuru ho jaye!
 */
const timeToCronExpressionWithOffset = (time) => {
  let [hour, minute] = time.split(":").map(Number);

  // Exact 1 ghante ka offset minus karo upload background processing ke liye
  hour = hour - 1;

  // Agar hour minus me chala jaye (e.g. Night 00:30 - 1 hour = 23:30)
  if (hour < 0) {
    hour = 24 + hour;
  }

  return `${minute} ${hour} * * *`; // daily at (targetHour - 1):minute
};

/**
 * Naya cron job schedule karta hai given target public time se 1 hour pehle
 */
const scheduleJob = (targetTime) => {
  if (scheduledTask) {
    scheduledTask.stop();
    console.log(`[CRON SERVICE] Purani scheduled job ko stop kiya gaya.`);
  }

  // 🕒 1 ghante pehle ka expression calculate karo
  const cronExpression = timeToCronExpressionWithOffset(targetTime);

  scheduledTask = cron.schedule(
    cronExpression, 
    async () => {
      console.log(`[CRON] Time match hua for upload window!`);
      
      if (isJobRunning) {
        console.log(`[CRON SERVICE] ⚠️ Ek upload job pehle se process me hai. Is overlapping trigger ko skip kiya jata hai.`);
        return;
      }

      try {
        isJobRunning = true;
        console.log(`🚀 [CRON ENGINE] Background upload process starting now...`);
        await runDailyPostJob();
      } catch (error) {
        console.error(`[CRON SERVICE ERROR]:`, error.message);
      } finally {
        isJobRunning = false;
        console.log(`[CRON SERVICE] Lock released. Ready for next schedule.`);
      }
    },
    {
      scheduled: true,
      timezone: "Asia/Kolkata" // 🎯 India Time Standard (IST)
    }
  );

  console.log(`[CRON SERVICE] 🎯 Target Live Time: ${targetTime} | Background Upload Scheduled at Expression: "${cronExpression}" [Timezone: Asia/Kolkata]`);
};

/**
 * Server start hote hi ye call hoga - DB se saved time uthake job schedule karega
 */
const initCronJob = async () => {
  try {
    let settings = await Settings.findOne({ key: "app_settings" });

    if (!settings) {
      settings = await Settings.create({
        key: "app_settings",
        cronTime: process.env.DEFAULT_CRON_TIME || "18:00", // Default shaam ke 6:00 baje live ka goal
      });
    }

    scheduleJob(settings.cronTime);
  } catch (err) {
    console.error("❌ [CRON INIT ERROR]:", err.message);
  }
};

/**
 * Frontend se time change hone par call hoga - job ko naye time pe re-schedule karta hai
 */
const rescheduleJob = (newTime) => {
  console.log(`[CRON SERVICE] Rescheduling triggered from panel for Target Time: ${newTime}`);
  scheduleJob(newTime);
};

module.exports = { initCronJob, rescheduleJob };
