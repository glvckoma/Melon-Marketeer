const zlib = require('zlib');
const { promisify } = require('util');
const { Readable } = require('stream');
const { createHash } = require('node:crypto');

const inflateRaw = promisify(zlib.inflateRaw);

const HASH_KEY = 'W3 7r4Ck h4X0r3rs';
const API_URL = 'https://ajcontent.akamaized.net';

function hash(input) {
  let inc = 0;
  let out = '';
  input = `${HASH_KEY}${input}`;
  while (inc < input.length) {
    if (inc % 2 === 0) out = out + input.charAt(inc);
    else out = input.charAt(inc) + out;
    inc++;
  }
  return createHash('md5').update(out).digest('hex');
}

async function decodeDefpack(version, id) {
  const url = `${API_URL}/${version}/defPacks/${hash(String(id))}`;
  const response = await fetch(url, { headers: { Host: 'ajcontent.akamaized.net' } });
  if (response.status !== 200) {
    throw new Error(`HTTP ${response.status} fetching pack ${id} v${version}`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('json')) {
    return await response.json();
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error(`empty buffer for pack ${id}`);
  const decompressed = await inflateRaw(buffer);
  const firstByte = decompressed[0];
  if (firstByte !== 0x0a && firstByte !== 0x11) {
    throw new Error(`invalid AMF3 marker 0x${firstByte.toString(16)} for pack ${id}`);
  }
  const amfjs = require('amfjs');
  const { AMF3, AMFDecoder } = amfjs.default ?? amfjs;
  const stream = new Readable();
  stream.push(decompressed);
  stream.push(null);
  const decoder = new AMFDecoder(stream);
  const result = decoder.decode(AMF3);
  if (typeof result !== 'object' || result === null) {
    throw new Error(`AMF3 decode returned ${typeof result} for pack ${id}`);
  }
  return result;
}

async function packExists(version, id = '1000') {
  try {
    const r = await fetch(`${API_URL}/${version}/defPacks/${hash(String(id))}`, { headers: { Host: 'ajcontent.akamaized.net' } });
    return r.status === 200;
  } catch {
    return false;
  }
}

async function detectLatestVersion(startVersion = 1811) {
  let cur = startVersion;
  let lastGood = startVersion;
  let upper = null;
  for (let step = 10; step <= 300 && !upper; step += 10) {
    if (await packExists(cur + step)) { lastGood = cur + step; cur += step; }
    else upper = cur + step;
  }
  if (!upper) upper = lastGood + 100;
  let lo = lastGood;
  let hi = upper;
  let latest = lastGood;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (await packExists(mid)) { latest = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return latest;
}

module.exports = { hash, decodeDefpack, detectLatestVersion };
