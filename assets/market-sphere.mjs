// The scene projects 3D particles to Canvas 2D and has no WebGL or market-data dependency.
const logos = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana' };
const matches = {
  bybit: /^(BTC|ETH|SOL)(?:USDT|USDC|USD)$/,
  okx: /^(BTC|ETH|SOL)-(?:USDT|USDC|USD)(?:-SWAP)?$/,
  hyperliquid: /^(BTC|ETH|SOL)$/,
  bitfinex: /^(BTC|ETH|SOL)(?:USD|UST|F0:USTF0)$/,
  mexc: /^(BTC|ETH|SOL)_?USDT$/,
};

export function marketLogo(market) {
  if (!market) return 'bitcoin';
  const asset = matches[market.venue]?.exec?.(market.id)?.[1];
  return asset && market.base === asset ? logos[asset] : null;
}

function particles(count) {
  let seed = 8291;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return Array.from({ length: count }, () => {
    const y = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    // Interior points fill the disk. Concentrating every point on the skin produces a ring.
    const radius = .97 * Math.cbrt(random());
    const horizontal = Math.sqrt(1 - y * y) * radius;
    return { x: Math.cos(angle) * horizontal, y: y * radius, z: Math.sin(angle) * horizontal,
      size: .45 + random() * .86 };
  });
}

export function mountMarketSphere(figure, logo) {
  const canvas = figure.querySelector('canvas');
  const context = canvas.getContext('2d', { alpha: true });
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let width = 0, height = 0, points = [], frame = null, visible = true, pageActive = true;
  let elapsed = 0, previous;

  function select(market) {
    const asset = market?.base || (market ? '' : 'BTC');
    const image = marketLogo(market);
    if (logo.dataset.asset === asset && logo.dataset.logo === (image ?? '')) return;
    logo.dataset.asset = asset;
    logo.dataset.logo = image ?? '';
    logo.replaceChildren();
    if (!image) return;
    const element = document.createElement('img');
    element.src = './assets/market-logos/' + image + '.svg';
    element.alt = '';
    element.addEventListener('error', () => element.remove(), { once: true });
    logo.append(element);
  }

  function waves(time, front) {
    const span = width / 24;
    const layerCount = front ? 3 : 5;
    for (let layer = 0; layer < layerCount; layer++) {
      const pathY = x => height * (.49 + layer * .031 + (front ? .07 : -.13)) +
        Math.sin(x / width * 6.6 + time * .60 + layer * .38) * height * (.09 + layer * .012) +
        Math.cos(x / width * 3.9 - time * .4) * height * .06;
      context.beginPath();
      for (let x = -2 * span; x <= width + 2 * span; x += span) context.lineTo(x, pathY(x));
      context.strokeStyle = front ? 'rgba(161,129,189,.012)' : 'rgba(160,126,194,.016)';
      for (const softness of [1.5, 1.14, .81, .48]) {
        context.lineWidth = height * (.17 - layer * .017) * softness;
        context.stroke();
      }
      for (let index = 0; index < 96; index++) {
        const x = ((index * 91.37 + layer * 53.1 + time * (front ? 11 : 7)) % width);
        const jitter = Math.sin((index + 1) * 127.1 + layer * 311.7) * 43758.5453;
        const y = pathY(x) + (jitter - Math.floor(jitter) - .5) * height * .19;
        context.fillStyle = index % 9 ? 'rgba(190,162,210,.15)' : 'rgba(190,162,210,.28)';
        context.fillRect(x, y, index % 9 ? 1 : 1.8, 1);
      }
    }
  }

  function draw() {
    if (!context || !width || !height) return;
    context.clearRect(0, 0, width, height);
    const time = elapsed / 1000;
    waves(time, false);
    const angle = time * .26;
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    const radius = Math.min(height * .44, width * .36);
    for (const p of points) {
      const x = cosine * p.x + sine * p.z;
      const z = cosine * p.z - sine * p.x;
      const y = .96 * p.y + .28 * z;
      const scale = 1 + z * .13;
      const cx = width / 2 + x * radius * scale;
      const cy = height / 2 + y * radius * scale;
      const size = p.size * scale;
      context.fillStyle = z > .4 ? 'rgba(216,184,235,.68)' : z > -.15 ? 'rgba(187,151,214,.47)' : 'rgba(158,127,184,.26)';
      context.fillRect(cx, cy, size, size);
    }
    waves(time, true);
  }

  function tick(now) {
    frame = null;
    if (previous !== undefined) elapsed += Math.min(now - previous, 50);
    previous = now;
    draw();
    update();
  }

  function update() {
    const active = Boolean(context && width && visible && pageActive && !document.hidden && !motion.matches);
    if (active && frame === null) frame = requestAnimationFrame(tick);
    if (!active && frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
      previous = undefined;
    }
  }

  function resize() {
    width = figure.clientWidth;
    height = figure.clientHeight;
    if (!width || !height || !context) return;
    const scale = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    points = particles(width < 500 ? 950 : 2250);
    draw();
    update();
  }

  select();
  if (!context) return { select };
  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(figure);
  const viewObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    update();
  });
  viewObserver.observe(figure);
  resize();
  motion.addEventListener('change', () => { draw(); update(); });
  document.addEventListener('visibilitychange', update);
  window.addEventListener('pagehide', () => { pageActive = false; update(); });
  window.addEventListener('pageshow', () => { pageActive = true; update(); });
  return { select };
}
