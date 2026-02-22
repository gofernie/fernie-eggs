// netlify/functions/_lib/sheets.cjs
const { GoogleSpreadsheet } = require("google-spreadsheet");

function must(name){
  const v = (process.env[name] || "").trim();
  if(!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function decodeServiceAccount(){
  const b64 = must("GOOGLE_SERVICE_ACCOUNT_JSON_B64");
  const json = Buffer.from(b64, "base64").toString("utf8");
  const creds = JSON.parse(json);

  // google keys often contain literal \n, ensure actual newlines
  if(typeof creds.private_key === "string"){
    creds.private_key = creds.private_key.replace(/\\n/g, "\n");
  }
  return creds;
}

async function getDoc(){
  const sheetId = must("GSHEET_ID");
  const creds = decodeServiceAccount();

  const doc = new GoogleSpreadsheet(sheetId);

  // ✅ This is the critical missing step
  await doc.useServiceAccountAuth(creds);

  // ✅ Load spreadsheet metadata (required before accessing sheets)
  await doc.loadInfo();

  return doc;
}

async function getSheet(doc, title){
  if(!doc) throw new Error("getSheet: doc is required");
  const t = String(title || "").trim();
  if(!t) throw new Error("getSheet: title is required");

  const sheet = doc.sheetsByTitle[t];
  if(!sheet){
    const names = Object.keys(doc.sheetsByTitle || {});
    throw new Error(`Sheet not found: "${t}". Available: ${names.join(", ")}`);
  }
  return sheet;
}

module.exports = { getDoc, getSheet };