const cloudinary = require("../config/cloudinary");
const streamifier = require("streamifier");

/**
 * Filename ko Cloudinary public_id ke liye safe banata hai.
 * Cloudinary public_id mein sirf letters, numbers, underscores, hyphens, aur
 * slashes allowed hain — #, (), spaces, commas jaisi cheezein reject ho jaati hain.
 */
const sanitizeForPublicId = (filename) => {
  return filename
    .replace(/\.[^/.]+$/, "") // extension hatao
    .replace(/[^a-zA-Z0-9_-]+/g, "_") // koi bhi invalid character underscore se replace karo
    .replace(/_+/g, "_") // multiple underscores ko ek mein compress karo
    .replace(/^_|_$/g, "") // shuru/end ke extra underscore hatao
    .slice(0, 100); // Cloudinary public_id length safe limit
};

/**
 * Ek video buffer ko Cloudinary pe upload karta hai
 * resource_type: "video" - important hai warna image assume karega
 */
const uploadVideoToCloudinary = (fileBuffer, filename) => {
  return new Promise((resolve, reject) => {
    const safeName = sanitizeForPublicId(filename || "video");

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "video",
        folder: "fb-auto-post",
        public_id: `${Date.now()}-${safeName}`,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result); // { secure_url, public_id, duration, ... }
      }
    );
    streamifier.createReadStream(fileBuffer).pipe(uploadStream);
  });
};

/**
 * Video ko Cloudinary se delete karta hai (post hone ke baad cleanup)
 */
const deleteVideoFromCloudinary = async (publicId) => {
  return cloudinary.uploader.destroy(publicId, { resource_type: "video" });
};

module.exports = { uploadVideoToCloudinary, deleteVideoFromCloudinary };
