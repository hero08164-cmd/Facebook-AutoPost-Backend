// backend/server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

// Exact folder structure ke hisab se internal modules ka import
const FacebookAccount = require('./src/models/FacebookAccount');
require('./src/services/cronService'); // Exact path for cronService

const app = express();

// CORS Production setting setup
app.use(cors({ origin: process.env.FRONTEND_URL || "*", credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint for Render/Uptime monitoring
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "FB Auto Post API running smoothly" });
});

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/fb-poster')
  .then(() => {
    console.log('✅ MongoDB Connected');
    syncFacebookCredentials(); // Database connect hote hi .env se settings sync hogi
  })
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Environment Variables se Facebook credentials automatically sync/update karne ka core logic
async function syncFacebookCredentials() {
  try {
    const pageId = process.env.FB_PAGE_ID;
    const accessToken = process.env.FB_PAGE_ACCESS_TOKEN;

    if (!pageId || !accessToken) {
      console.log('⚠️ [FB SYNC] FB_PAGE_ID ya FB_PAGE_ACCESS_TOKEN .env file me missing hai. Sync skip kiya gaya.');
      return;
    }

    // Database me exact .env credentials save/update (upsert) honge
    await FacebookAccount.findOneAndUpdate(
      {}, // Single account state maintain karne ke liye empty filter
      {
        pageId: pageId.trim(),
        accessToken: accessToken.trim(),
        pageName: 'FilmyTv (Auto Configured)',
        isConnected: true,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );
    console.log('✅ [FB SYNC] Facebook credentials successfully loaded from backend .env!');
  } catch (error) {
    console.error('❌ [FB SYNC] Error syncing Facebook credentials:', error.message);
  }
}

// Tumhere directory structure ke mutabik correct routes import path mapping
const authRoutes = require('./src/routes/authRoutes');
const driveRoutes = require('./src/routes/driveRoutes');
const videoRoutes = require('./src/routes/videoRoutes');
const scheduleRoutes = require('./src/routes/scheduleRoutes');
const postRoutes = require('./src/routes/postRoutes');

// API URL Endpoints base setups
app.use('/api/auth', authRoutes);
app.use('/api/drive', driveRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/posts', postRoutes); // 🎯 FIX: '/api/post' ko badal kar '/api/posts' (plural) kiya!

// 404 handler (Catch-all)
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found on this server: ${req.originalUrl}` });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("💥 Server Error:", err.stack);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

module.exports = app;
