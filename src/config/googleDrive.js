const { google } = require("googleapis");

// OAuth2 client - Google Drive login/consent aur token refresh ke liye
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Sirf Drive read access chahiye - videos list/read karne ke liye
const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

// Ek helper jo saved refresh token se authenticated Drive client banata hai
const getDriveClient = (refreshToken) => {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  client.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth: client });
};

module.exports = { oauth2Client, SCOPES, getDriveClient };
