// netlify/functions/_lib/sheets.cjs
const { GoogleSpreadsheet } = require("google-spreadsheet");
const { JWT } = require("google-auth-library");

function must(name){
  const v = process.env[name];
  if(!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function num(v, fallback=0){
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function getDoc(){
  const doc = new GoogleSpreadsheet(must("GSHEET_ID"));

  const b64 = must("GOOGLE_SERVICE_ACCOUNT_JSON_B64");
  const creds = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));

  const auth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  // ✅ new auth pattern
  doc.auth = auth;

  await doc.loadInfo();
  return doc;
}

async function getSheet(doc, title){
  const sheet = doc.sheetsByTitle[title];
  if(!sheet) throw new Error(`Sheet not found: ${title}`);
  return sheet;
}

module.exports = { getDoc, getSheet, num };
