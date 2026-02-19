const { getSheetsClient } = require("./_sheets.cjs");

exports.handler = async () => {
  try {
    const sheetId = process.env.SHEET_ID;
    if (!sheetId) throw new Error("Missing SHEET_ID");

    const sheets = await getSheetsClient();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "config!A1:B2",
    });

    const rows = res.data.values || [];
    const kv = Object.fromEntries(rows.map((r) => [r[0], r[1]]));

    const dozens = Number(kv.dozens || 0);

    return {
      statusCode: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
      body: JSON.stringify({ dozens }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: e.message || "status failed" }),
    };
  }
};
