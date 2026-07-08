// backend/src/services/cronService.js
const cron = require("node-cron");
const Settings = require("../models/Settings");
const { runDailyPostJob } = require("../jobs/dailyPostJob");

let scheduledTask = null; // Current active cron task ka reference
let isJobRunning = false; // 🎯 LOCK SYSTEM: Taaki task process hote waqt overlap na ho

/**
 * "HH:mm" (e.g. "18:00") me se exact 20 minute minus karke background upload cron expression banata hai
 * Taaki 6:00 PM ke target ke liye processing exact 5:40 PM par automatically shuru ho jaye!
 */
const timeToCronExpressionWith20MinBuffer = (time) => {
  let [hour, minute] = time.split(":").map(Number);

  // 🎯 Heavy videos (up to 500MB+) ke liye 20 minute ka processing buffer offset minus karo
  minute = minute - 20;
  
  if (minute < 0) {
    minute = 60 + minute; // Minutes ko handle karne ke liye hour se borrow kiya
    hour = hour - 1;
    if (hour < 0) {
      hour = 23; // Agar raat ke 12:10 se 20 min minus karein toh pichle din ka 11:50 PM ho jaye
    }
  }

  return `${minute} ${hour} * * *`; // daily execution format
};

/**
 * Naya cron job schedule karta hai given target public time se 20 minute pehle
 */
const scheduleJob = (targetTime) => {
  if (scheduledTask) {
    scheduledTask.stop();
    console.log(`[CRON SERVICE] Purani scheduled job ko stop kiya gaya.`);
  }

  // 🕒 20 minute pehle ka expression calculate karo
  const cronExpression = timeToCronExpressionWith20MinBuffer(targetTime);

  scheduledTask = cron.schedule(
    cronExpression, 
    async () => {
      console.log(`\n[CRON] ⏰ 20-Minute Window Match Hua! Direct publish action triggered...`);
      
      if (isJobRunning) {
        console.log(`[CRON SERVICE] ⚠️ Ek upload job pehle se process me hai. Is overlapping trigger ko skip kiya jata hai.`);
        return;
      }

      try {
        isJobRunning = true;
        console.log(`🚀 [CRON ENGINE] 500MB+ buffer streaming initiated via network layer...`);
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

  console.log(`[CRON SERVICE] 🎯 Target Live Goal: ${targetTime} | Background Upload Automatically Scheduled at Expression: "${cronExpression}" (20 Mins Earlier) [Timezone: Asia/Kolkata]`);
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
