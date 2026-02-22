// netlify/functions/reserve.cjs
const { getDoc, getSheet, num } = require("./_lib/sheets.cjs");

function clampInt(n, min, max){
  n = Math.trunc(Number(n));
  if(!Number.isFinite(n)) n = min;
  return Math.max(min, Math.min(max, n));
}

exports.handler = async (event) => {
  try{
    if(event.httpMethod !== "POST"){
      return { statusCode: 405, body: "Method not allowed" };
    }

    const body = JSON.parse(event.body || "{}");
    const phone = (body.phone || "").toString().trim();
    const qty = clampInt(body.dozens_requested ?? 1, 1, 12);

    if(!phone) return { statusCode: 400, body: "Missing phone" };

    const created_at = new Date().toISOString();

    const doc = await getDoc();
    const subs = await getSheet(doc, "subscribers");
    await subs.loadHeaderRow();

    // If you want “one active reservation per phone”, enforce it here:
    const rows = await subs.getRows();
    const active = rows.find(r =>
      (String(r.phone || "").trim() === phone) &&
      (String(r.status || "").toUpperCase() === "WAITING" || String(r.status || "").toUpperCase() === "OFFERED")
    );
    if(active){
      return { statusCode: 200, body: "Already in line" };
    }

    await subs.addRow({
      phone,
      created_at,
      opted_out: 0,
      last_notified_date: created_at,   // you said you expect it filled
      dozens_requested: qty,
      status: "WAITING",
      offer_sent_at: "",
      offer_expires_at: "",
      allocated_dozens: "",
      responded_at: "",
      offered_dozens: ""
    });

    // Frontend expects plain text OK
    return { statusCode: 200, body: "OK" };
  } catch (e){
    return { statusCode: 500, body: "reserve error: " + e.message };
  }
};
