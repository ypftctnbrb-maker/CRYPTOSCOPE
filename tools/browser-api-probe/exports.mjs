const csvCell = value => {
  let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};

export function toCsv(rows) {
  const columns = [...new Set(rows.flatMap(Object.keys))];
  return [columns.map(csvCell).join(','), ...rows.map(row => columns.map(key => csvCell(row[key])).join(','))].join('\r\n') + '\r\n';
}

export const toJson = rows => JSON.stringify(rows, null, 2) + '\n';
