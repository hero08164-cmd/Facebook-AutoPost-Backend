// backend/src/jobs/syncDriveToCloudinaryJob.js
const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");

const jar = new CookieJar();
const client = wrapper(axios.create({ jar }));

const downloadDriveFile = async (fileId) => {
  const baseUrl = `https://docs.google.com/uc?export=download&id=${fileId}`;
  const initial = await client.get(baseUrl, { responseType: "text" });

  let finalUrl = baseUrl;
  const match = initial.data.match(/confirm=([0-9A-Za-z_-]+)/);
  if (match) {
    finalUrl = `${baseUrl}&confirm=${match[1]}`;
  } else if (initial.data.includes("<!DOCTYPE html>")) {
    throw new Error("Drive returned HTML instead of binary — file may need re-sharing or is too large for anonymous bypass.");
  }

  const res = await client.get(finalUrl, {
    responseType: "arraybuffer",
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  return Buffer.from(res.data);
};
