const { extractImages, extractColorWorth, cleanImageUrl, fileNameOf } = require('./wikiExtract.js');

const HOSTS = {
  'aj-item-worth': 'aj-item-worth.fandom.com',
  animaljam: 'animaljam.fandom.com'
};
const IMG_HOST = 'static.wikia.nocookie.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

const COLORS = ['Rainbow', 'Black', 'White', 'Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Pink', 'Orange', 'Brown', 'Gray', 'Grey', 'Cyan', 'Magenta', 'Gold', 'Silver'];

const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';
function looksLikeDate(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (new RegExp(`\\b(${MONTHS})\\s+\\d{1,2},?\\s*\\d{4}\\b`, 'i').test(t)) return true;
  if (new RegExp(`^(${MONTHS})\\.?$`, 'i').test(t)) return true;
  if (new RegExp(`^(${MONTHS})\\s+(19|20)?\\d{1,4}\\.?$`, 'i').test(t)) return true;
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(t)) return true;
  if (/^(19|20)\d{2}$/.test(t)) return true;
  return false;
}

function colorFromFilename(name) {
  const decoded = decodeURIComponent(String(name)).replace(/_/g, ' ');
  for (const c of COLORS) {
    if (new RegExp(`(^|[^a-z])${c}([^a-z]|$)`, 'i').test(decoded)) return c === 'Grey' ? 'Gray' : c;
  }
  return null;
}

function apiFor(source) {
  return `https://${HOSTS[source] || HOSTS['aj-item-worth']}/api.php`;
}

const RETRY_BACKOFFS = [2000, 5000, 15000, 30000, 60000];
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithBackoff(url, opts = {}, fetchImpl = fetch, backoffs = RETRY_BACKOFFS) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, opts);
    if (res.ok || (res.status !== 429 && res.status !== 503) || attempt >= backoffs.length) return res;
    const retryAfter = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffs[attempt]);
  }
}

async function fetchJson(params, source = 'aj-item-worth', fetchImpl = fetch) {
  const qs = new URLSearchParams({ format: 'json', ...params });
  const res = await fetchWithBackoff(`${apiFor(source)}?${qs}`, { headers: { 'User-Agent': UA } }, fetchImpl);
  if (!res.ok) throw new Error(`wiki API ${res.status}`);
  return res.json();
}

async function fetchPageImages(title, { source = 'aj-item-worth', fetchImpl = fetch } = {}) {
  const data = await fetchJson({ action: 'parse', page: title, prop: 'text', redirects: '1' }, source, fetchImpl);
  if (data.error) return { title, resolved: null, images: [], error: data.error.code };
  const html = data.parse.text['*'];
  return { title, resolved: data.parse.title, images: extractImages(html) };
}

async function fetchPageColorWorth(title, { source = 'aj-item-worth', fetchImpl = fetch } = {}) {
  const data = await fetchJson({ action: 'parse', page: title, prop: 'text', redirects: '1' }, source, fetchImpl);
  if (data.error) return { title, resolved: null, colorWorth: [], error: data.error.code };
  const html = data.parse.text['*'];
  return { title, resolved: data.parse.title, colorWorth: extractColorWorth(html) };
}

async function resolvePageTitle(name, source = 'aj-item-worth', fetchImpl = fetch) {
  const data = await fetchJson({ action: 'query', titles: name, redirects: '1' }, source, fetchImpl);
  const pages = data.query && data.query.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  return page && !page.missing ? page.title : null;
}

module.exports = {
  colorFromFilename, cleanImageUrl, fileNameOf, extractImages, extractColorWorth, fetchPageImages, fetchPageColorWorth,
  resolvePageTitle, apiFor, fetchJson, fetchWithBackoff, sleep, looksLikeDate, COLORS, HOSTS, IMG_HOST
};
