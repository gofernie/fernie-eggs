// netlify/functions/restock.cjs
const { getDoc, getSheet, num } = require("./_lib/sheets.cjs");
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

function norm(v){
  return String(v ?? "").trim();
}

function upper(v){
  return norm(v).toUpperCase();
}

function rowGet(r, key){
  if(typeof r.get === "function") return r.get(key);
  return r?.[key];
}

function rowSet(r, key, val){
  if(typeof r.set === "function") r.set(key, val);
  else r[key] = val;
}

function digitsOnly(v){
  return norm(v).replace(/\D/g, "");
}

// ✅ Convert to E.164 for Canada/US
function toE164_NANP(v){
  const d = digitsOnly(v);
  if(!d) return "";
  if(d.length === 10) return `+1${d}`;
  if(d.length === 11 && d.startsWith("1")) return `+${d}`;
  return `+${d}`;
}

// ✅ Store canonical digits in sheet: 11-digit starting with 1
function canonicalPhoneDigits(v){
  const d = digitsOnly(v);
  if(!d) return "";
  if(d.length === 10) return `1${d}`;
  if(d.length === 11 && d.startsWith("1")) return d;
  return d;
}

/**
 * CONFIG (horizontal)
 * Row 1 = headers
 * Row 2 = values
 */
async function readConfig(sheet){
  await sheet.loadHeaderRow(1);

  const keys = (sheet.headerValues || [])
    .map(h => String(h || "").trim())
    .filter(Boolean);

  const rows = await sheet.getRows({ limit: 1 });
  const row = rows[0];
  if(!row) throw new Error("Config row missing (expected row 2).");

  const cfg = {};
  for(const k of keys){
    const normKey = k.trim().toLowerCase();
    cfg[normKey] = norm(rowGet(row, k));
  }

  return { cfg, row };
}

async function setConfigValue(configRow, key, value){
  if(!configRow) throw new Error("Config row missing.");
  rowSet(configRow, key, String(value));
  await configRow.save();
}

exports.handler = async (event) => {
  try{
    if(event.httpMethod !== "POST"){
      return { statusCode: 405, body: "Method not allowed" };
    }

    const body = JSON.parse(event.body || "{}");
    const provided = norm(body.key);
    const expected = norm(process.env.ADMIN_KEY);

    if(!expected || provided !== expected){
      return { statusCode: 401, body: "Unauthorized" };
    }

    const newDozens = clampInt(body.dozens, 0, 999);

    const doc = await getDoc();
    const configSheet = await getSheet(doc, "config");
    const subsSheet = await getSheet(doc, "subscribers");

    const { cfg, row: configRow } = await readConfig(configSheet);
    const holdMinutes = Math.max(30, num(cfg.hold_minutes, 30));

    await setConfigValue(configRow, "dozens", newDozens);
    await setConfigValue(configRow, "last_restock_date", nowISO().slice(0, 10));

    if(newDozens <= 0){
      await setConfigValue(configRow, "active_offers", 0);
      return {
        statusCode: 200,
        body: JSON.stringify({ ok:true, dozens:newDozens, sent:0, note:"Marked sold out." })
      };
    }

    await subsSheet.loadHeaderRow(1);
    const subsRows = await subsSheet.getRows();
    const now = Date.now();

    for(const r of subsRows){
      if(upper(rowGet(r, "status")) !== "OFFERED") continue;

      const exp = Date.parse(rowGet(r, "offer_expires_at") || "");
      if(exp && exp < now){
        rowSet(r, "status", "EXPIRED");
        rowSet(r, "offered_dozens", "");
        await r.save();
      }
    }

    let activeOffers = 0;
    for(const r of subsRows){
      if(upper(rowGet(r, "status")) === "OFFERED"){
        activeOffers += Math.max(0, Number(rowGet(r, "offered_dozens") || 0));
      }
    }
    await setConfigValue(configRow, "active_offers", activeOffers);

    let availableToOffer = Math.max(0, newDozens - activeOffers);
    if(availableToOffer <= 0){
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok:true,
          dozens:newDozens,
          sent:0,
          note:`No stock available (active_offers=${activeOffers}).`
        })
      };
    }

    const client = twilio(must("TWILIO_ACCOUNT_SID"), must("TWILIO_AUTH_TOKEN"));
    const from = must("TWILIO_FROM");

    const waiting = subsRows
      .filter(r => upper(rowGet(r, "status")) === "WAITING" && norm(rowGet(r, "opted_out") || "0") !== "1")
      .sort((a,b) => Date.parse(rowGet(a, "created_at") || 0) - Date.parse(rowGet(b, "created_at") || 0));

    let sent = 0;

    for(const r of waiting){
      if(availableToOffer <= 0) break;

      const requested = Math.max(1, Number(rowGet(r, "dozens_requested") || 1));
      const offered = Math.min(requested, availableToOffer);

      const expAt = new Date(Date.now() + holdMinutes * 60000).toISOString();

      const msg =
        offered < requested
          ? `Eggs are in. I can offer ${offered} dozen right now (you requested ${requested}). Reply YES within ${holdMinutes} min to claim ${offered}, or reply WAIT to stay in line.`
          : `Eggs are in. Reply YES within ${holdMinutes} min to claim ${offered} dozen. Reply NO to skip.`;

      const rawPhone = norm(rowGet(r, "phone"));
      const to = toE164_NANP(rawPhone);
      if(!to) continue;

      await client.messages.create({ from, to, body: msg });

      // store canonical digits in sheet (prevents Sheets stripping +)
      rowSet(r, "phone", canonicalPhoneDigits(rawPhone));
      rowSet(r, "status", "OFFERED");
      rowSet(r, "offer_sent_at", nowISO());
      rowSet(r, "offer_expires_at", expAt);
      rowSet(r, "offered_dozens", String(offered));
      rowSet(r, "last_notified_date", nowISO());

      await r.save();

      availableToOffer -= offered;
      sent++;
    }

    const refreshed = await subsSheet.getRows();
    let active2 = 0;
    for(const r of refreshed){
      if(upper(rowGet(r, "status")) === "OFFERED"){
        active2 += Math.max(0, Number(rowGet(r, "offered_dozens") || 0));
      }
    }
    await setConfigValue(configRow, "active_offers", active2);

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok:true,
        dozens:newDozens,
        sent,
        hold_minutes: holdMinutes,
        active_offers: active2
      })
    };

  } catch (e){
    return { statusCode: 500, body: "restock error: " + e.message };
  }
};
