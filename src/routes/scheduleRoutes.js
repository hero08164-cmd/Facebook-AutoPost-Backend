const express = require("express");
const router = express.Router();
const {
  getScheduleTime,
  updateScheduleTime,
  runNow,
} = require("../controllers/scheduleController");

router.get("/time", getScheduleTime);
router.put("/time", updateScheduleTime);
router.post("/run-now", runNow);

module.exports = router;
