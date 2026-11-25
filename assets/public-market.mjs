export function finite(value) {
  return (typeof value === 'number' || typeof value === 'string' && value.trim()) &&
    Number.isFinite(Number(value)) ? Number(value) : null;
}

export function candle(time, open, high, low, close, volume) {
  const values = [time, open, high, low, close, volume].map(finite);
  if (values.slice(0, 5).some(value => !(value > 0)) || values[5] === null || values[5] < 0) return null;
  const [ms, o, h, l, c, v] = values;
  return { time: ms / 1000, open: o, high: h, low: l, close: c, volume: v };
}

export function trade(id, time, price, quantity, side) {
  if (typeof id !== 'string' && !Number.isSafeInteger(id) || id === '' ||
      !['Buy', 'Sell'].includes(side) || ![time, price, quantity].every(value => finite(value) > 0)) return null;
  return { id: String(id), time: Number(time), price: Number(price), quantity: Number(quantity), side };
}

export function snapshot(source, unit, rows, kind) {
  const normalized = [...new Map(rows.filter(Boolean).map(row => [row.id ?? row.time, row])).values()]
    .sort((a, b) => a.time - b.time);
  return { source, unit, timestamp: normalized.length ? normalized.at(-1).time * (kind === 'candles' ? 1000 : 1) : null,
    [kind]: normalized };
}

export function rest() {
  let retryAt = 0;
  return async (url, signal, body) => {
    const rateLimited = () => Object.assign(Error('REST rate limited'), { retryAt });
    if (Date.now() < retryAt) throw rateLimited();
    const response = await fetch(url, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      ...(body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (response.status === 429) {
      const now = Date.now();
      const after = response.headers.get('Retry-After');
      const deadline = /^\d+$/.test(after ?? '') ? now + Number(after) * 1000 : Date.parse(after);
      retryAt = Math.max(now + 30000, Number.isFinite(deadline) ? Math.min(deadline, now + 120000) : 0);
      throw rateLimited();
    }
    if (!response.ok) throw Error('HTTP ' + response.status);
    return response.json();
  };
}

export function subscribe(url, message, receive, onDisconnect, ping) {
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  let heartbeat;
  socket.onopen = () => {
    socket.send(JSON.stringify(message));
    if (ping) heartbeat = setInterval(() => socket.readyState === 1 && socket.send(JSON.stringify(ping)), 15000);
  };
  socket.onmessage = ({ data }) => {
    let frame;
    try { frame = typeof data === 'string' ? JSON.parse(data) : data; } catch { return; }
    receive(frame);
  };
  socket.onerror = socket.onclose = onDisconnect;
  return () => {
    clearInterval(heartbeat);
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    socket.close();
  };
}
