const cloudinary = require("../config/cloudinary");
const streamifier = require("streamifier");

/**
 * Ek video buffer ko Cloudinary pe upload karta hai
 * resource_type: "video" - important hai warna image assume karega
 */
const uploadVideoToCloudinary = (fileBuffer, filename) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "video",
        folder: "fb-auto-post",
        public_id: `${Date.now()}-${filename.replace(/\.[^/.]+$/, "")}`,
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
