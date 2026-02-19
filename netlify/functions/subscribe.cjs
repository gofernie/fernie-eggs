const { getSheetsClient } = require("./_sheets.cjs");

function normalizePhone(p) {
  const s = (p || "").toString().trim();
  if (!s) return "";

  if (s.startsWith("+")) return s;

  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

  return "";
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    const sheetId = process.env.SHEET_ID;
    if (!sheetId) throw new Error("Missing SHEET_ID");

    const { phone } = JSON.parse(event.body || "{}");
    const phoneNorm = normalizePhone(phone);

    if (!phoneNorm) {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: false, error: "Invalid phone number" }),
      };
    }

    const sheets = await getSheetsClient();

    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "subscribers!A2:D",
    });

    const rows = existing.data.values || [];
    const found = rows.find((r) => (r[0] || "").trim() === phoneNorm);

    if (found && String(found[2] || "0") !== "1") {
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, already: true }),
      };
    }

    const now = new Date().toISOString();
    const newRow = [phoneNorm, now, "0", ""];

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "subscribers!A:D",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [newRow] },
    });

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: e.message || "subscribe failed" }),
    };
  }
};
