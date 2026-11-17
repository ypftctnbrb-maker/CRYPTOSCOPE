'use strict';
const fs = require('node:fs');
const path = require('node:path');
const escape = text => String(text).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);
function renderDailyReport({ date, text }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) throw Error('Invalid date');
  if (typeof text !== 'string' || !text.trim()) throw Error('Report text is required');
  const template = fs.readFileSync(path.join(__dirname, '../about.html'), 'utf8');
  const top = '<div data-bingx-placement="report-top" data-bingx-label="Торговать на BingX"></div>';
  const bottom = '<div data-bingx-placement="report-bottom" data-bingx-label="Торговать на BingX"></div>';
  const content = '<p class="eyebrow">CRYPTOSCOPE · ежедневный отчёт</p><h1>Обзор рынка · ' + escape(date) + '</h1>' + top +
    '<article><p>' + escape(text).replace(/\n/g, '</p><p>') + '</p></article>' + bottom;
  return template.replace(/<title>[^<]*<\/title>/, '<title>Обзор рынка ' + escape(date) + ' | CRYPTOSCOPE</title>')
    .replace(/<main id="content">[\s\S]*?(?=<footer>)/, '<main id="content">\n' + content + '\n')
    .replaceAll('href="./', 'href="../').replaceAll('src="./', 'src="../');
}
if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw Error('Usage: node scripts/render-daily-report.cjs input.json reports/YYYY-MM-DD.html');
  const html = renderDailyReport(JSON.parse(fs.readFileSync(input, 'utf8')));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, html);
}
module.exports = { renderDailyReport };
