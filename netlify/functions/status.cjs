// netlify/functions/status.cjs
const { getDoc, getSheet, num } = require("./_lib/sheets.cjs");

async function readConfig(){
  const doc = await getDoc();
  const sheet = await getSheet(doc, "config");
  const rows = await sheet.getRows();

  const cfg = {};
  for(const r of rows){
    const key = (r._rawData?.[0] ?? "").toString().trim();
    const val = (r._rawData?.[1] ?? "").toString().trim();
    if(key) cfg[key] = val;
  }
  return cfg;
}

exports.handler = async () => {
  try{
    const cfg = await readConfig();
    const dozens = num(cfg.dozens, 0);
    // price is optional - default to 7 if you want
    const price = num(cfg.price, 7);

    return {
      statusCode: 200,
      headers: { "content-type": "application/json", "cache-control":"no-store" },
      body: JSON.stringify({ dozens, price })
    };
  } catch (e){
    return { statusCode: 500, body: "status error: " + e.message };
  }
};
