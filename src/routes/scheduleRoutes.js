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
router.get("/run-now", runNow); 

// 🎯 SABSE ZAROORI: Yeh line exact aisi honi chahiye!
module.exports = router;
