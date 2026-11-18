'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const publicFiles = ['index.html', 'about.html', 'methodology.html', 'disclaimer.html', 'where-to-trade.html',
  'assets/app.js', 'assets/styles.css', 'assets/information.css',
  'assets/config.js', 'assets/referrals.js', 'assets/referrals.css', 'assets/referral-market.js'];

function preparePublic(source, destination) {
  const reports = path.join(source, 'reports');
  const reportFiles = fs.existsSync(reports) ? fs.readdirSync(reports, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.html$/.test(entry.name)).map(entry => 'reports/' + entry.name) : [];
  const files = [...publicFiles, ...reportFiles];
  // Validate everything first: a missing page must block publication.
  for (const file of files) {
    const absolute = path.join(source, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw Error('Missing public source: ' + file);
  }
  const versions = new Map(reportFiles.length ? publicFiles.filter(file => file.startsWith('assets/')).map(file =>
    [file, createHash('sha256').update(fs.readFileSync(path.join(source, file))).digest('hex').slice(0, 12)]) : []);
  const refreshReportAssets = html => html.replace(/<(?:script|link)\b[^>]*>/gi, tag =>
    tag.replace(/(\s(?:src|href)\s*=\s*)(["'])(\.\.\/(assets\/[\w.-]+))(?:\?v=[\w-]+)?\2/gi,
      (match, attribute, quote, relative, file) => versions.has(file) ?
        attribute + quote + relative + '?v=' + versions.get(file) + quote : match));
  fs.mkdirSync(destination, { recursive: true });
  if (fs.readdirSync(destination).length) throw Error('Public destination must be empty');
  for (const file of files) {
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (file.startsWith('reports/')) {
      // Latin-1 maps each byte one-to-one; only matched ASCII asset URLs may change.
      const bytes = fs.readFileSync(path.join(source, file));
      fs.writeFileSync(target, Buffer.from(refreshReportAssets(bytes.toString('latin1')), 'latin1'));
    } else fs.copyFileSync(path.join(source, file), target);
  }
  fs.writeFileSync(path.join(destination, '.nojekyll'), '');
}

if (require.main === module) {
  preparePublic(process.cwd(), path.resolve(process.argv[2] || 'public'));
  console.log('Public artifact prepared: ' + publicFiles.length + ' source files and .nojekyll');
}
module.exports = { preparePublic };
