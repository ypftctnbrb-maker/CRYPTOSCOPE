// Field numbers from mexcdevelop/websocket-proto. Only public kline and deal messages are decoded.
const utf8 = new TextDecoder('utf-8', { fatal: true });

function fields(bytes) {
  let offset = 0;
  function varint() {
    let value = 0;
    for (let shift = 0; shift <= 63 && offset < bytes.length; shift += 7) {
      const byte = bytes[offset++];
      value += (byte & 127) * 2 ** shift;
      if (byte < 128) return value;
    }
    throw Error('Invalid protobuf varint');
  }

  const result = new Map();
  while (offset < bytes.length) {
    const tag = varint();
    const field = tag >>> 3;
    const wire = tag & 7;
    let value;
    if (!field || tag > 0xffffffff) throw Error('Invalid protobuf tag');
    if (wire === 0) {
      value = varint();
    } else {
      const size = wire === 2 ? varint() : wire === 1 ? 8 : wire === 5 ? 4 : -1;
      if (!Number.isSafeInteger(size) || size < 0 || offset + size > bytes.length) throw Error('Invalid protobuf length');
      value = bytes.subarray(offset, offset + size);
      offset += size;
    }
    const values = result.get(field) ?? [];
    values.push(value);
    result.set(field, values);
  }
  return result;
}

const first = (row, key) => row.get(key)?.[0];
const string = (row, key) => {
  const value = first(row, key);
  return value instanceof Uint8Array ? utf8.decode(value) : '';
};
const integer = (row, key) => {
  const value = first(row, key);
  return Number.isSafeInteger(value) ? value : null;
};

export function decodeMexc(frame, channel, symbol) {
  if (!(frame instanceof ArrayBuffer)) return null;
  try {
    const wrapper = fields(new Uint8Array(frame));
    if (string(wrapper, 1) !== channel || string(wrapper, 3) !== symbol) return null;
    const deals = first(wrapper, 314);
    if (deals instanceof Uint8Array && channel.startsWith('spot@public.aggre.deals.')) {
      return { trades: (fields(deals).get(1) ?? []).map(bytes => {
        const row = fields(bytes);
        return { p: string(row, 1), v: string(row, 2), T: integer(row, 3), t: integer(row, 4), i: string(row, 5) };
      }) };
    }
    const kline = first(wrapper, 308);
    if (kline instanceof Uint8Array && channel.startsWith('spot@public.kline.')) {
      const row = fields(kline);
      if (string(row, 1) !== 'Min5') return null;
      return { candle: [integer(row, 2) * 1000, string(row, 3), string(row, 5), string(row, 6),
        string(row, 4), string(row, 7)], timestamp: integer(wrapper, 6) ?? integer(wrapper, 5) };
    }
    return null;
  } catch {
    return null;
  }
}
