// backend/src/app.js
const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || "*", credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "FB Auto Post API running" });
});

// ---- Routes ----
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/videos", require("./routes/videoRoutes"));
app.use("/api/drive", require("./routes/driveRoutes"));
app.use("/api/schedule", require("./routes/scheduleRoutes"));
app.use("/api/posts", require("./routes/postRoutes")); // 🎯 Plural route perfectly configured

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.statusCode || 500).json({ // 🎯 FIX: Khali space me default status 500 add kiya
    success: false,
    message: err.message || "Internal Server Error",
  });
});

module.exports = app;
