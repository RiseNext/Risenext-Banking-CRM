"use client";

type Row = Record<string, unknown>;

function escapeCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  const cleaned = text.replace(/"/g, '""');
  return /[",\n]/.test(cleaned) ? `"${cleaned}"` : cleaned;
}

export function toCsv(rows: Row[], headers?: string[]) {
  if (!rows.length) return "";
  const cols = headers ?? Object.keys(rows[0]);
  const body = rows.map((row) => cols.map((col) => escapeCell(row[col])).join(","));
  return [cols.join(","), ...body].join("\n");
}

export function downloadFile(filename: string, content: string, mime = "text/csv;charset=utf-8;") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportCsv(filename: string, rows: Row[], headers?: string[]) {
  downloadFile(filename.endsWith(".csv") ? filename : `${filename}.csv`, toCsv(rows, headers));
}

export function exportJson(filename: string, rows: unknown) {
  downloadFile(
    filename.endsWith(".json") ? filename : `${filename}.json`,
    JSON.stringify(rows, null, 2),
    "application/json",
  );
}

export function exportTallyXml(filename: string, rows: Row[], voucherType = "Receipt") {
  const vouchers = rows
    .map(
      (row) => `    <VOUCHER VCHTYPE="${voucherType}" ACTION="Create">
      <DATE>${escapeXml(row.date)}</DATE>
      <NARRATION>${escapeXml(row.narration ?? row.particulars ?? "")}</NARRATION>
      <PARTYLEDGERNAME>${escapeXml(row.party ?? row.bank ?? "")}</PARTYLEDGERNAME>
      <AMOUNT>${escapeXml(row.amount ?? 0)}</AMOUNT>
    </VOUCHER>`,
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
${vouchers}
  </BODY>
</ENVELOPE>`;

  downloadFile(
    filename.endsWith(".xml") ? filename : `${filename}.xml`,
    xml,
    "application/xml;charset=utf-8;",
  );
}

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
