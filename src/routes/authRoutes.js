const express = require("express");
const router = express.Router();
const {
  facebookLogin,
  facebookCallback,
  facebookStatus,
  facebookDisconnect,
  facebookManualConnect,
} = require("../controllers/authController");

router.get("/facebook/login", facebookLogin);
router.get("/facebook/callback", facebookCallback);
router.get("/facebook/status", facebookStatus);
router.delete("/facebook/disconnect", facebookDisconnect);
router.post("/facebook/manual-connect", facebookManualConnect);

module.exports = router;
