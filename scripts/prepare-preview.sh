#!/usr/bin/env bash
set -euo pipefail

# Build from the approved candidate, even when the checkout has local edits.
base=${2:-f5f6dba4130c87c1c30bab72719cc2fbb222e6f0}
dashboard=${3:-}
if [[ -n "$dashboard" && "$dashboard" != "--dashboard" ]]; then exit 2; fi
destination=${1:?Usage: bash scripts/prepare-preview.sh /path/to/new-directory [sha --dashboard]}
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
mkdir "$scratch/source" "$scratch/public"
git -C "$repo" archive "$base" | tar -x -C "$scratch/source"
(cd "$scratch/source" && node scripts/prepare-public.cjs "$scratch/public")
node - "$scratch/public" "$base" "$dashboard" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [root, sha, mode] = process.argv.slice(2);
if (mode === '--dashboard') {
  const catalogue = fs.readFileSync(path.join(root, 'instruments.html'), 'utf8');
  fs.writeFileSync(path.join(root, 'index.html'), catalogue.replace('<body>', '<body data-default-market>'));
  for (const name of ['about.html', 'methodology.html', 'disclaimer.html', 'where-to-trade.html', 'reports',
    'assets/app.js', 'assets/config.js', 'assets/information.css', 'assets/referrals.js',
    'assets/referrals.css', 'assets/referral-market.js', 'assets/styles.css']) {
    fs.rmSync(path.join(root, name), { recursive: true, force: true });
  }
}
for (const file of fs.readdirSync(root, { recursive: true })) {
  if (!file.endsWith('.html')) continue;
  const target = path.join(root, file);
  const html = fs.readFileSync(target, 'utf8');
  const marker = /<body(?:\s[^>]*)?>/i;
  if (!marker.test(html)) throw Error('Missing body in ' + file);
  const banner = '<aside aria-label="Тестовая сборка" style="padding:8px 16px;background:#31253e;color:#f3eaf7;text-align:center">CRYPTOSCOPE PREVIEW · Тестовая сборка · ' +
    sha.slice(0, 12) + '</aside>';
  fs.writeFileSync(target, html.replace(marker, '$&\n' + banner));
}
fs.writeFileSync(path.join(root, 'preview-sha.txt'), sha + '\n');
NODE
(cd "$scratch/public" && find . -type f ! -name preview-sha256.txt -print0 |
  LC_ALL=C sort -z | xargs -0 sha256sum > preview-sha256.txt)
mkdir -- "$destination"
cp -a "$scratch/public/." "$destination/"
