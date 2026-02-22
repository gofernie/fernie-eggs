/* netlify/functions/restock.cjs */

const { getDoc, getSheet } = require("./_lib/sheets.cjs");
const twilio = require("twilio");

function must(name){
  const v = process.env[name];
  if(!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function nowISO(){ return new Date().toISOString(); }

function clampInt(v, min, max){
  let n = Math.trunc(Number(v));
  if(!Number.isFinite(n)) n = min;
  return Math.max(min, Math.min(max, n));
}

function norm(v){ return String(v ?? "").trim(); }
function upper(v){ return norm(v).toUpperCase(); }

function rowGet(r, key){
  if(typeof r.get === "function") return r.get(key);
  return r?.[key];
}

function rowSet(r, key, val){
  if(typeof r.set === "function") r.set(key, val);
  else r[key] = val;
}

function safeNum(v, fallback=0){
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

exports.handler = async (event) => {
  try{
    if(event.httpMethod !== "POST"){
      return { statusCode: 405, body: "Method not allowed" };
    }

    const body = JSON.parse(event.body || "{}");

    if(norm(body.key) !== norm(process.env.ADMIN_KEY)){
      return { statusCode: 401, body: "Unauthorized" };
    }

    const newDozens = clampInt(body.dozens, 0, 999);

    const doc = await getDoc();
    const configSheet = await getSheet(doc, "config");
    const subsSheet = await getSheet(doc, "subscribers");

    await configSheet.loadHeaderRow(1);
    const configRows = await configSheet.getRows({ limit:1 });
    const configRow = configRows[0];

    const holdMinutes = Math.max(
      30,
      safeNum(rowGet(configRow, "hold_minutes"), 30)
    );

    rowSet(configRow, "dozens", newDozens);
    rowSet(configRow, "last_restock_date", nowISO().slice(0,10));
    await configRow.save();

    if(newDozens <= 0){
      rowSet(configRow, "active_offers", 0);
      await configRow.save();
      return {
        statusCode: 200,
        body: JSON.stringify({ ok:true, dozens:newDozens, sent:0 })
      };
    }

    await subsSheet.loadHeaderRow(1);
    const subsRows = await subsSheet.getRows();

    const client = twilio(
      must("TWILIO_ACCOUNT_SID"),
      must("TWILIO_AUTH_TOKEN")
    );
    const from = must("TWILIO_FROM");

    let available = newDozens;
    let sent = 0;

    for(const r of subsRows){

      if(available <= 0) break;

      if(upper(rowGet(r,"status")) !== "WAITING") continue;

      const phone = rowGet(r,"phone");
      if(!phone) continue;

      const msg = `Eggs are in. Reply YES within ${holdMinutes} min to claim 1 dozen.`;

      await client.messages.create({
        from,
        to: phone.startsWith("+") ? phone : `+1${phone}`,
        body: msg
      });

      rowSet(r,"status","OFFERED");
      rowSet(r,"offer_sent_at", nowISO());
      rowSet(r,"offer_expires_at",
        new Date(Date.now() + holdMinutes*60000).toISOString()
      );

      await r.save();

      available--;
      sent++;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok:true,
        dozens:newDozens,
        sent
      })
    };

  } catch(e){
    return {
      statusCode: 500,
      body: "restock error: " + e.message
    };
  }
};