# CRYPTOSCOPE 4.0 visual review

Prior preview #99 used source `f5f6dba4130c87c1c30bab72719cc2fbb222e6f0` in package #95. The baseline screenshots were captured from the local copy whose served application bytes were verified in [#99](https://github.com/ypftctnbrb-maker/CRYPTOSCOPE/issues/99#issuecomment-7234670468). The old page showed separate entry points, BingX placements, no favorites or price intervals, and no six-card overview. The original GIF was unavailable in this environment. This implementation follows Issue #100's written layout.

| Width | Previous preview | New dashboard |
| --- | --- | --- |
| 1920 × 1080 | [RED](red-1920.jpg) | [GREEN](green-1920.jpg) |
| 390 × 844 | [RED](red-390.jpg) | [GREEN](green-390.jpg) · [Full page](green-390-full.jpg) |

GREEN screenshots were captured at application SHA `006f9c53f49adb0daf060fe20fcb272d266aa986` with Chromium and deterministic REST/WS fixtures after changing markets, changing price timeframe and saving a favorite. The fixture prices shown in the screenshots are not production observations. Intervals 15м and 1ч derive from uninterrupted 5-minute OHLCV buckets. The last bucket may be partial. MA 7 requires seven contiguous displayed bars. CVD remains on native 5-minute trade buckets and explicitly labels incomplete REST history. The dashboard uses the current instrument source and observation time. BTC uses the selected BTC venue. Unconnected metrics have no numerical placeholders.

Reproduce the isolated ad-free artifact from the app SHA with `bash scripts/prepare-preview.sh /path/to/new-directory 006f9c53f49adb0daf060fe20fcb272d266aa986 --dashboard`. This mode serves the new dashboard at the root and excludes legacy entry points, referral scripts and reports. The production Pages workflow was not altered.

Browser command (run twice with width/height `1920/1080` and `390/844`):

```sh
DASHBOARD_EVIDENCE=/path/to/evidence CATALOGUE_PREVIEW_ROOT=/path/to/new-directory \
CATALOGUE_WIDTH=390 CATALOGUE_HEIGHT=844 CHROME_BIN=/usr/bin/chromium \
NODE_PATH=/workspace/i66-probe/tools/browser-api-probe/node_modules node tests/browser-venue-catalogue.cjs
```

Both runs exited 0. Static smoke and 57 Node checks exited 0. The new mobile test confirms search/filter, selection, price timeframe, favorites, price/CVD status, six cards, and no referral tags. Physical Safari and live exchange chart delivery were not verified in these runs.
