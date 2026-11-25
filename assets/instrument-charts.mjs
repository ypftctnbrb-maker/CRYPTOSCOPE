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
