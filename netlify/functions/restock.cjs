const twilio = require("twilio");
const { getSheetsClient } = require("./_sheets.cjs");

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    const sheetId = process.env.SHEET_ID;
    const adminKey = process.env.ADMIN_KEY;
    if (!sheetId) throw new Error("Missing SHEET_ID");
    if (!adminKey) throw new Error("Missing ADMIN_KEY");

    const { key, dozens } = JSON.parse(event.body || "{}");
    if (key !== adminKey) return { statusCode: 401, body: "Unauthorized" };

    const newDozens = Math.max(0, Number(dozens || 0));
    const t = todayStr();

    const sheets = await getSheetsClient();

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: "config!B1",
      valueInputOption: "RAW",
      requestBody: { values: [[String(newDozens)]] },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: "config!B2",
      valueInputOption: "RAW",
      requestBody: { values: [[t]] },
    });

    if (newDozens <= 0) {
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, sent: 0, note: "dozens is 0 - no notifications" }),
      };
    }

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "subscribers!A2:D",
    });

    const rows = res.data.values || [];

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    if (!sid || !token || !from) throw new Error("Missing Twilio env vars");

    const client = twilio(sid, token);

    let sent = 0;

    for (let i = 0; i < rows.length; i++) {
      const phone = (rows[i][0] || "").trim();
      const optedOut = String(rows[i][2] || "0") === "1";
      const lastNotified = String(rows[i][3] || "");

      if (!phone || optedOut) continue;
      if (lastNotified === t) continue;

      await client.messages.create({
        to: phone,
        from,
        body: "🥚 Fernie Eggs are back in stock. Reply STOP to opt out.",
      });

      sent++;

      const sheetRowNumber = i + 2;
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `subscribers!D${sheetRowNumber}`,
        valueInputOption: "RAW",
        requestBody: { values: [[t]] },
      });
    }

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, sent }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: e.message || "restock failed" }),
    };
  }
};
