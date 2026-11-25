import { InputError } from './engine.mjs';
export function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function reportCSV(report) {
  if (!report || !Array.isArray(report.issues)) throw new InputError('Report required');
  const fields = [
    'code',
    'severity',
    'side',
    'kind',
    'sourceId',
    'targetId',
    'field',
    'expected',
    'actual',
  ];
  return (
    [fields, ...report.issues.map((row) => fields.map((k) => row[k]))]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n') + '\r\n'
  );
}
