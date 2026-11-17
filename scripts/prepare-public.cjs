'use strict';
const fs = require('node:fs');
const path = require('node:path');

const publicFiles = ['index.html', 'about.html', 'methodology.html', 'disclaimer.html',
  'assets/app.js', 'assets/styles.css', 'assets/information.css',
  'assets/config.js', 'assets/referrals.js', 'assets/referrals.css'];

function preparePublic(source, destination) {
  // Validate everything first: a missing page must block publication.
  for (const file of publicFiles) {
    const absolute = path.join(source, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw Error('Missing public source: ' + file);
  }
  fs.mkdirSync(destination, { recursive: true });
  if (fs.readdirSync(destination).length) throw Error('Public destination must be empty');
  for (const file of publicFiles) {
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(source, file), target);
  }
  fs.writeFileSync(path.join(destination, '.nojekyll'), '');
}

if (require.main === module) {
  preparePublic(process.cwd(), path.resolve(process.argv[2] || 'public'));
  console.log('Public artifact prepared: ' + publicFiles.length + ' source files and .nojekyll');
}
module.exports = { preparePublic };
