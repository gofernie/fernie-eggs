// netlify/functions/inbound-sms.js
const { getDoc, getSheet } = require("./_lib/sheets.cjs");
const twilio = require("twilio");

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

function nowISO(){ return new Date().toISOString(); }

function digitsOnly(v){
  return norm(v).replace(/\D/g, "");
}

function last10(v){
  const d = digitsOnly(v);
  return d.length >= 10 ? d.slice(-10) : d;
}

// Convert to E.164 for Canada/US
function toE164_NANP(v){
  const d = digitsOnly(v);
  if(!d) return "";
  if(d.length === 10) return `+1${d}`;
  if(d.length === 11 && d.startsWith("1")) return `+${d}`;
  return `+${d}`;
}

exports.handler = async (event) => {
  // ✅ TEMP TEST: proves the function is reachable + deploy is current
  return {
    statusCode: 200,
    body: "Function is alive"
  };

  // ---- everything below won't run until you remove the return above ----
  try{
    const params = new URLSearchParams(event.body || "");
    const fromRaw = params.get("From") || "";
    const bodyRaw = params.get("Body") || "";

    const from10 = last10(fromRaw);
    const replyTo = toE164_NANP(fromRaw);
    const text = upper(bodyRaw);

    const doc = await getDoc();
    const subsSheet = await getSheet(doc, "subscribers");
    const configSheet = await getSheet(doc, "config");

    await subsSheet.loadHeaderRow(1);
    await configSheet.loadHeaderRow(1);

    const subsRows = await subsSheet.getRows();
    const cfgRows = await configSheet.getRows({ limit: 1 });
    const cfgRow = cfgRows[0] || null;

    const sub = subsRows.find(r => last10(rowGet(r, "phone")) === from10);

    const twiml = new twilio.twiml.MessagingResponse();

    if(!sub){
      twiml.message("You’re not on the list yet. Go to the site to join the waitlist.");
      return {
        statusCode: 200,
        headers: { "Content-Type": "text/xml" },
        body: twiml.toString()
      };
    }

    const status = upper(rowGet(sub, "status"));
    const expAt = Date.parse(rowGet(sub, "offer_expires_at") || "");
    const offered = Number(rowGet(sub, "offered_dozens") || 0);

    if(text === "YES"){
      if(status !== "OFFERED" || !offered){
        rowSet(sub, "responded_at", nowISO());
        await sub.save();
        twiml.message("No active offer right now. Reply WAIT to stay in line.");
        return { statusCode: 200, headers: { "Content-Type": "text/xml" }, body: twiml.toString() };
      }

      if(expAt && expAt < Date.now()){
        rowSet(sub, "status", "EXPIRED");
        rowSet(sub, "responded_at", nowISO());
        await sub.save();
        twiml.message("Sorry - that offer expired. Reply WAIT to stay in line for the next restock.");
        return { statusCode: 200, headers: { "Content-Type": "text/xml" }, body: twiml.toString() };
      }

      rowSet(sub, "status", "CLAIMED");
      rowSet(sub, "allocated_dozens", String(offered));
      rowSet(sub, "responded_at", nowISO());
      await sub.save();

      if(cfgRow){
        const refreshed = await subsSheet.getRows();
        let active = 0;
        for(const r of refreshed){
          if(upper(rowGet(r, "status")) === "OFFERED"){
            active += Math.max(0, Number(rowGet(r, "offered_dozens") || 0));
          }
        }
        rowSet(cfgRow, "active_offers", String(active));
        await cfgRow.save();
      }

      twiml.message(`Claimed ✅ You’re down for ${offered} dozen. I’ll follow up about pickup.`);

      try{
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const fromNum = process.env.TWILIO_FROM;
        if(client && fromNum && replyTo){
          await client.messages.create({
            from: fromNum,
            to: replyTo,
            body: `Claimed ✅ You’re down for ${offered} dozen.`
          });
        }
      } catch(_){}

      return { statusCode: 200, headers: { "Content-Type": "text/xml" }, body: twiml.toString() };
    }

    if(text === "NO"){
      if(status === "OFFERED"){
        rowSet(sub, "status", "SKIPPED");
        rowSet(sub, "responded_at", nowISO());
        await sub.save();
      }
      twiml.message("No worries 👍 Reply WAIT if you want to stay in line for the next restock.");
      return { statusCode: 200, headers: { "Content-Type": "text/xml" }, body: twiml.toString() };
    }

    if(text === "WAIT"){
      rowSet(sub, "status", "WAITING");
      rowSet(sub, "responded_at", nowISO());
      await sub.save();
      twiml.message("Got it — you’re still in line ✅");
      return { statusCode: 200, headers: { "Content-Type": "text/xml" }, body: twiml.toString() };
    }

    if(text === "STOP" || text === "UNSUBSCRIBE"){
      rowSet(sub, "opted_out", "1");
      rowSet(sub, "status", "OPTOUT");
      rowSet(sub, "responded_at", nowISO());
      await sub.save();
      twiml.message("You’re opted out. Reply START to re-join.");
      return { statusCode: 200, headers: { "Content-Type": "text/xml" }, body: twiml.toString() };
    }

    rowSet(sub, "responded_at", nowISO());
    await sub.save();
    twiml.message("Got it.");
    return { statusCode: 200, headers: { "Content-Type": "text/xml" }, body: twiml.toString() };

  } catch (e){
    return { statusCode: 500, body: "inbound error: " + e.message };
  }
};