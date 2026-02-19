const { google } = require("googleapis");

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  if (!raw) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_BASE64");

  const decoded = Buffer.from(raw, "base64").toString("utf8");
  const creds = JSON.parse(decoded);

  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheetsClient() {
  const auth = await getAuth().getClient();
  return google.sheets({ version: "v4", auth });
}

module.exports = { getSheetsClient };
