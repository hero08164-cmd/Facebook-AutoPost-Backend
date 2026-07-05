const multer = require("multer");

// Memory storage - file buffer seedha Cloudinary ko stream karenge, disk pe save nahi karenge
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("video/")) {
    cb(null, true);
  } else {
    cb(new Error("Sirf video files allowed hain"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB per video (Cloudinary free tier ke hisab se adjust karo)
  },
});

module.exports = upload;
