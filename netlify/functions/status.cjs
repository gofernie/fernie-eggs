// netlify/functions/status.cjs
const { getDoc, getSheet } = require("./_lib/sheets.cjs");

function num(v, fallback = 0){
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function rowGet(r, key){
  if(typeof r.get === "function") return r.get(key);
  return r?.[key];
}

exports.handler = async () => {
  try{
    const doc = await getDoc();
    const sheet = await getSheet(doc, "config");

    await sheet.loadHeaderRow(1);
    const rows = await sheet.getRows({ limit: 1 });
    const r = rows[0];
    if(!r) throw new Error("Config row missing (expected row 2).");

    const dozens = num(rowGet(r, "dozens"), 0);
    const price  = num(rowGet(r, "price"), 7);

    return {
      statusCode: 200,
      headers: { "content-type": "application/json", "cache-control":"no-store" },
      body: JSON.stringify({ dozens, price })
    };
  } catch (e){
    return { statusCode: 500, body: "status error: " + e.message };
  }
};