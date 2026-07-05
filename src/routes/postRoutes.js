const express = require("express");
const router = express.Router();
const { getPostHistory, getPostStatusByVideoId } = require("../controllers/postController");

router.get("/history", getPostHistory);
router.get("/status/:id", getPostStatusByVideoId);

module.exports = router;
