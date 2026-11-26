# CRYPTOSCOPE PREVIEW

The isolated static package uses the exact candidate `f5f6dba4130c87c1c30bab72719cc2fbb222e6f0` (Draft PR #93). It adds a visible PREVIEW banner to every packaged HTML page and a build manifest. Production source and workflows are kept outside this packaging change.

From this checkout, with Node 22+ and GNU shell utilities:

```sh
bash scripts/prepare-preview.sh /tmp/cryptoscope-preview
(cd /tmp/cryptoscope-preview && sha256sum -c preview-sha256.txt)
python -m http.server 4173 --bind 127.0.0.1 --directory /tmp/cryptoscope-preview
```

Open `http://127.0.0.1:4173/instruments.html` for the market panel. The page reports source and data freshness and labels unavailable values. Browser fixture checks can serve the exact package rather than assembling a fresh copy:

```sh
CATALOGUE_PREVIEW_ROOT=/tmp/cryptoscope-preview CATALOGUE_WIDTH=390 node tests/browser-venue-catalogue.cjs
```

An authorized owner can upload the directory contents to a separate free static site that serves HTTPS without touching the production Pages configuration. Verify the external `preview-sha.txt` and compare uploaded files with the local manifest, including the HTML entry points, module graph, logos and catalogue. Check live APIs separately from browser fixtures. TLS validation stays enabled.

PR #93 provides graphical logos for verified BTC, ETH and SOL mappings. Other assets show a neutral mark pending a verified logo source. The approved graphite/lilac design uses muted green and red for directional market data as well. This package keeps the tested visuals and leaves logo coverage and further palette work for separate review.
