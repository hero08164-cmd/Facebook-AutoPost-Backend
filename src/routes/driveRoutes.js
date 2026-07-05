// backend/src/routes/driveRoutes.js
const express = require("express");
const router = express.Router();
const {
  driveAuth,
  driveCallback,
  driveStatus,
  getFolders,
  getVideosInFolder,
  selectFolder,
  getActiveFolder, // Controller se export kiya hua method
} = require("../controllers/driveController");

// Standard Auth Routes
router.get("/auth", driveAuth);
router.get("/callback", driveCallback);
router.get("/status", driveStatus);

// Folder Processing Routes
router.get("/folders", getFolders);
router.get("/list-folders", getFolders); // Frontend alias mapping
router.get("/folder/:id/videos", getVideosInFolder);

// Active Folder State Sync
router.get("/active-folder", getActiveFolder);

// Folder Switch/Select Core Endpoints (Dono ko same logic par map kar diya)
router.post("/select-folder", selectFolder);
router.post("/switch-folder", selectFolder); 

module.exports = router;