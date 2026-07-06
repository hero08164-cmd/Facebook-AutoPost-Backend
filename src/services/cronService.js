const cron = require("node-cron");
const Settings = require("../models/Settings");
const { runDailyPostJob } = require("../jobs/dailyPostJob");

let scheduledTask = null; // current active cron task ka reference

/**
 * "HH:mm" (e.g. "18:00") ko cron expression me convert karta hai -> "minute hour * * *"
 */
const timeToCronExpression = (time) => {
  const [hour, minute] = time.split(":").map(Number);
  return `${minute} ${hour} * * *`; // daily at hour:minute
};

/**
 * Naya cron job schedule karta hai given time pe
 */
const scheduleJob = (time) => {
  if (scheduledTask) {
    scheduledTask.stop();
    console.log(`[CRON SERVICE] Purani scheduled job ko stop kiya gaya.`);
  }

  const cronExpression = timeToCronExpression(time);

  // 🎯 FIX: 'timezone' config add ki taaki Render UTC ke badle exact IST India time pe execute kare
  scheduledTask = cron.schedule(
    cronExpression, 
    () => {
      console.log(`[CRON] Time match hua! Triggering runDailyPostJob right now...`);
      runDailyPostJob();
    },
    {
      scheduled: true,
      timezone: "Asia/Kolkata" // 🎯 Desi Indian Time Standard (IST)
    }
  );

  console.log(`[CRON SERVICE] Job scheduled at ${time} daily (expression: "${cronExpression}") [Timezone: Asia/Kolkata]`);
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
        cronTime: process.env.DEFAULT_CRON_TIME || "18:00",
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
  scheduleJob(newTime);
};

module.exports = { initCronJob, rescheduleJob };
