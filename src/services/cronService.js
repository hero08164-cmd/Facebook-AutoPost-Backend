const cron = require("node-cron");
const Settings = require("../models/Settings");
const { runDailyPostJob } = require("../jobs/dailyPostJob");

let scheduledTask = null; // current active cron task ka reference

/**
 * "HH:mm" (e.g. "18:00") ko cron expression me convert karta hai -> "0 18 * * *"
 */
const timeToCronExpression = (time) => {
  const [hour, minute] = time.split(":").map(Number);
  return `${minute} ${hour} * * *`; // daily at hour:minute
};

/**
 * Naya cron job schedule karta hai given time pe
 * Purana task hoga to pehle usko stop karta hai (taaki 2 jobs ek sath na chalein)
 */
const scheduleJob = (time) => {
  if (scheduledTask) {
    scheduledTask.stop();
  }

  const cronExpression = timeToCronExpression(time);

  scheduledTask = cron.schedule(cronExpression, () => {
    runDailyPostJob();
  });

  console.log(`[CRON SERVICE] Job scheduled at ${time} daily (expression: "${cronExpression}")`);
};

/**
 * Server start hote hi ye call hoga - DB se saved time uthake job schedule karega
 */
const initCronJob = async () => {
  let settings = await Settings.findOne({ key: "app_settings" });

  if (!settings) {
    settings = await Settings.create({
      key: "app_settings",
      cronTime: process.env.DEFAULT_CRON_TIME || "18:00",
    });
  }

  scheduleJob(settings.cronTime);
};

/**
 * Frontend se time change hone par call hoga - job ko naye time pe re-schedule karta hai
 */
const rescheduleJob = (newTime) => {
  scheduleJob(newTime);
};

module.exports = { initCronJob, rescheduleJob };
