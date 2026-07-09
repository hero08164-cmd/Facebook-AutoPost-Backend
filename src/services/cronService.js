// backend/src/services/cronService.js
const cron = require("node-cron");
const Settings = require("../models/Settings");
const { runDraftUploadJob } = require("../jobs/draftUploadJob");
const { runPublishScheduledJob } = require("../jobs/publishScheduledJob");

// 🎯 Draft upload kitni der PEHLE ho, target time se (long videos ke liye buffer).
// Change karne ke liye bas yeh number badlo.
const DRAFT_UPLOAD_BUFFER_MINUTES = 60;

let draftTask = null; // Draft-upload cron (target - buffer)
let publishTask = null; // Exact-time publish cron
let isDraftJobRunning = false;
let isPublishJobRunning = false;

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
 * "HH:MM" time ka EXACT cron expression banata hai (bina buffer ke)
 */
const timeToExactCronExpression = (time) => {
  const [hour, minute] = time.split(":").map(Number);
  return `${minute} ${hour} * * *`;
};

/**
 * Dono Jobs (draft-upload + exact-publish) ko schedule karne wala Master Engine
 */
const scheduleJob = (targetTime) => {
  // --- PHASE 1: DRAFT UPLOAD (target time se buffer pehle) ---
  if (draftTask) {
    draftTask.stop();
    console.log(`[CRON SERVICE] Purani draft-upload job ko stop kiya gaya.`);
  }

  const draftExpression = timeToCronExpressionWithBuffer(targetTime, DRAFT_UPLOAD_BUFFER_MINUTES);

  draftTask = cron.schedule(
    draftExpression,
    async () => {
      console.log(`\n[CRON] 📤 Draft-upload window hit! (${DRAFT_UPLOAD_BUFFER_MINUTES} min pehle target ke)`);
      if (isDraftJobRunning) {
        console.log(`[CRON SERVICE] ⚠️ Draft job pehle se chal raha hai, skip.`);
        return;
      }
      try {
        isDraftJobRunning = true;
        await runDraftUploadJob();
      } catch (error) {
        console.error(`[CRON SERVICE ERROR - draft]:`, error.message);
      } finally {
        isDraftJobRunning = false;
        console.log(`[CRON SERVICE] Draft job lock released.`);
      }
    },
    { scheduled: true, timezone: "Asia/Kolkata" }
  );

  // --- PHASE 2: EXACT-TIME PUBLISH (target time pe bilkul exact) ---
  if (publishTask) {
    publishTask.stop();
    console.log(`[CRON SERVICE] Purani publish job ko stop kiya gaya.`);
  }

  const publishExpression = timeToExactCronExpression(targetTime);

  publishTask = cron.schedule(
    publishExpression,
    async () => {
      console.log(`\n[CRON] ⚡ Exact target time hit! Publish action triggered...`);
      if (isPublishJobRunning) {
        console.log(`[CRON SERVICE] ⚠️ Publish job pehle se chal raha hai, skip.`);
        return;
      }
      try {
        isPublishJobRunning = true;
        await runPublishScheduledJob();
      } catch (error) {
        console.error(`[CRON SERVICE ERROR - publish]:`, error.message);
      } finally {
        isPublishJobRunning = false;
        console.log(`[CRON SERVICE] Publish job lock released.`);
      }
    },
    { scheduled: true, timezone: "Asia/Kolkata" }
  );

  console.log(
    `[CRON SERVICE] 🎯 Target Live Goal: ${targetTime} | Draft Upload: "${draftExpression}" (${DRAFT_UPLOAD_BUFFER_MINUTES} min pehle) | Exact Publish: "${publishExpression}" [Timezone: Asia/Kolkata]`
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
