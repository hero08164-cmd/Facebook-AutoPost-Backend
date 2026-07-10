// backend/src/services/cronService.js
const cron = require("node-cron");
const Settings = require("../models/Settings");
const { runScheduledUploadJob } = require("../jobs/scheduledUploadJob");
const { runVerifyScheduledJob } = require("../jobs/verifyScheduledJob");

// Upload kitni der PEHLE ho, target time se (long videos ko processing time dene ke liye).
// Publishing khud Facebook apne native scheduler se exact target time pe karega —
// isliye humein alag se "publish" cron ki zaroorat nahi.
const UPLOAD_BUFFER_MINUTES = 60;

// Har kitni der mein verify karein ki scheduled videos actually publish hui ya nahi
const VERIFY_INTERVAL_MINUTES = 15;

let uploadTask = null;
let verifyTask = null;
let currentTargetTime = null;
let isUploadJobRunning = false;
let isVerifyJobRunning = false;

/**
 * "HH:MM" time se X minutes PEHLE ka cron expression banata hai
 */
const timeToCronExpressionWithBuffer = (time, bufferMinutes) => {
  let [hour, minute] = time.split(":").map(Number);
  minute = minute - bufferMinutes;
  while (minute < 0) {
    minute += 60;
    hour -= 1;
  }
  while (hour < 0) hour += 24;
  return `${minute} ${hour} * * *`;
};

/**
 * Upload cron (buffer pehle) + Verify cron (periodic) schedule karta hai.
 * Actual PUBLISH TIME Facebook khud apne native scheduler se control karta hai
 * (scheduled_publish_time parameter ke through) — humara code sirf upload
 * aur baad mein verification handle karta hai.
 */
const scheduleJob = (targetTime) => {
  currentTargetTime = targetTime;

  // --- UPLOAD CRON (target se buffer pehle) ---
  if (uploadTask) {
    uploadTask.stop();
    console.log(`[CRON SERVICE] Purani upload job ko stop kiya gaya.`);
  }

  const uploadExpression = timeToCronExpressionWithBuffer(targetTime, UPLOAD_BUFFER_MINUTES);

  uploadTask = cron.schedule(
    uploadExpression,
    async () => {
      console.log(`\n[CRON] 📤 Upload window hit! (${UPLOAD_BUFFER_MINUTES} min pehle target ke)`);
      if (isUploadJobRunning) {
        console.log(`[CRON SERVICE] ⚠️ Upload job pehle se chal raha hai, skip.`);
        return;
      }
      try {
        isUploadJobRunning = true;
        await runScheduledUploadJob(currentTargetTime);
      } catch (error) {
        console.error(`[CRON SERVICE ERROR - upload]:`, error.message);
      } finally {
        isUploadJobRunning = false;
        console.log(`[CRON SERVICE] Upload job lock released.`);
      }
    },
    { scheduled: true, timezone: "Asia/Kolkata" }
  );

  // --- VERIFY CRON (har VERIFY_INTERVAL_MINUTES mein chalta hai, independent) ---
  if (!verifyTask) {
    verifyTask = cron.schedule(
      `*/${VERIFY_INTERVAL_MINUTES} * * * *`,
      async () => {
        if (isVerifyJobRunning) return;
        try {
          isVerifyJobRunning = true;
          await runVerifyScheduledJob();
        } catch (error) {
          console.error(`[CRON SERVICE ERROR - verify]:`, error.message);
        } finally {
          isVerifyJobRunning = false;
        }
      },
      { scheduled: true, timezone: "Asia/Kolkata" }
    );
    console.log(`[CRON SERVICE] 🔍 Verify job set: har ${VERIFY_INTERVAL_MINUTES} minute mein chalega.`);
  }

  console.log(
    `[CRON SERVICE] 🎯 Target Live Goal: ${targetTime} | Upload Window: "${uploadExpression}" (${UPLOAD_BUFFER_MINUTES} min pehle) | Actual publish Facebook ke native scheduler se hoga [Timezone: Asia/Kolkata]`
  );
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
