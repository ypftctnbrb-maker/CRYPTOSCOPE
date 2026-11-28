const layout = { background: { color: '#191620' }, textColor: '#cbc3d4' };
const grid = { vertLines: { color: '#2b2534' }, horzLines: { color: '#2b2534' } };
export const chartStyle = { layout, grid, rightPriceScale: { borderColor: '#3b3148' },
  timeScale: { borderColor: '#3b3148', timeVisible: true } };
export const candleStyle = {
  upColor: '#83a995', wickUpColor: '#83a995', borderUpColor: '#83a995',
  downColor: '#b7777b', wickDownColor: '#b7777b', borderDownColor: '#b7777b',
};

export function createCvdChart(host, unit) {
  let chart, historySeries, liveSeries, resize, frame;
  let history = [], live = [];
  const points = bars => bars.map(({ time, open, high, low, close }) =>
    ({ time: time / 1000, open, high, low, close }));

  function paint() {
    frame = null;
    const historical = live.length ? history.filter(bar => bar.time < live[0].time) : history;
    host.hidden = !historical.length && !live.length;
    host.dataset.historyBars = historical.length;
    host.dataset.liveBars = live.length;
    if (host.hidden) return;
    const newChart = !chart;
    if (newChart) {
      chart = window.LightweightCharts.createChart(host, {
        ...chartStyle, width: host.clientWidth, height: host.clientHeight,
      });
      const priceFormat = { type: 'custom', formatter: value =>
        value.toLocaleString('ru-RU', { maximumSignificantDigits: 9 }) + (unit ? ' ' + unit : '') };
      historySeries = chart.addCandlestickSeries({ ...candleStyle, priceFormat, priceLineVisible: false, lastValueVisible: false,
        upColor: '#637a6e', downColor: '#79565f', wickUpColor: '#83a995', wickDownColor: '#b7777b',
        borderUpColor: '#637a6e', borderDownColor: '#79565f' });
      liveSeries = chart.addCandlestickSeries({ ...candleStyle, priceFormat });
      resize = new ResizeObserver(() => chart.applyOptions({ width: host.clientWidth, height: host.clientHeight }));
      resize.observe(host);
    }
    historySeries.setData(points(historical));
    historySeries.setMarkers(historical.filter((bar, index) => index === 0 || historical[index - 1].segment !== bar.segment)
      .map(bar => ({ time: bar.time / 1000, position: 'aboveBar', color: '#bca8cb', shape: 'circle' })));
    liveSeries.setData(points(live));
    liveSeries.setMarkers(live.length
      ? [{ time: live[0].time / 1000, position: 'belowBar', color: '#bca8cb', shape: 'circle' }]
      : []);
    if (newChart) chart.timeScale().fitContent();
  }

  function schedule() {
    frame ??= requestAnimationFrame(paint);
  }

  return {
    setHistory(bars) { history = bars; schedule(); },
    setLive(bars) { live = bars; schedule(); },
    stop() {
      if (frame != null) cancelAnimationFrame(frame);
      resize?.disconnect();
      chart?.remove();
      host.hidden = true;
      delete host.dataset.historyBars;
      delete host.dataset.liveBars;
    },
  };
}

// The venue adapters all supply five-minute bars. Larger intervals keep only
// contiguous coverage and allow a partial bucket at the right edge.
export function groupPriceBars(rows, minutes) {
  const width = minutes * 60;
  const buckets = [];
  for (const row of rows) {
    const time = Math.floor(row.time / width) * width;
    let bucket = buckets.at(-1);
    if (bucket?.time !== time) {
      bucket = { ...row, time, complete: row.time === time, last: row.time };
      buckets.push(bucket);
    } else {
      bucket.complete &&= row.time === bucket.last + 300;
      bucket.last = row.time;
      bucket.high = Math.max(bucket.high, row.high);
      bucket.low = Math.min(bucket.low, row.low);
      bucket.close = row.close;
      bucket.volume = bucket.volume == null || row.volume == null ? null : bucket.volume + row.volume;
    }
  }
  return buckets.filter((row, index) => row.complete &&
    (index === buckets.length - 1 || row.last + 300 === row.time + width))
    .map(({ complete, last, ...row }) => row);
}

export function movingAverage(rows, periods = 7, seconds = 300) {
  return rows.flatMap((row, index) => {
    if (index < periods - 1 || row.time - rows[index - periods + 1].time !== (periods - 1) * seconds) return [];
    const sample = rows.slice(index - periods + 1, index + 1);
    return [{ time: row.time, value: sample.reduce((sum, bar) => sum + bar.close, 0) / periods }];
  });
}
