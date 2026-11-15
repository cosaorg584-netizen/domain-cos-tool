import OpenAI from 'openai';

// ---------- Lazy OpenAI client ----------
// Do NOT create at top of file. Create only when we actually call the AI.
let _client = null;
function getClient() {
  if (_client) return _client;
  const key = (process.env.OPENAI_API_KEY || '').trim();
  if (!key) return null;
  _client = new OpenAI({ apiKey: key });
  return _client;
}

// ---------- Cache ----------
const cache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 60;

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.t > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.v;
}

function setCached(key, value) {
  cache.set(key, { v: value, t: Date.now() });
}

// ---------- Prompt ----------
function buildPrompt(keyword, { count, style, tlds }) {
  const styleGuides = {
    brandable: 'invented, catchy, pronounceable, like Spotify, Stripe, Notion',
    compound: 'two real words joined, like Shopify, Snapchat, Mailchimp',
    short: 'as short as possible, 4-7 letters, like Vercel, Figma, Arc',
    keyword: 'clearly contains or hints at the keyword, like CoffeeClub, TeaHouse',
    playful: 'fun, whimsical, modern startup vibe, like Notion, Loom, Linear',
  };

  return `You are a professional domain-name consultant.

Generate ${count} unique, available-sounding domain names for the topic "${keyword}".
Style: ${styleGuides[style] || styleGuides.brandable}
Allowed TLDs: ${tlds.join(', ')}

Rules:
- Return ONLY a JSON array of objects. No markdown, no commentary.
- Each object: { "name": "example", "tld": "com", "why": "one short reason" }
- "name" must be lowercase, no spaces, no hyphens, no numbers, 3-20 chars.
- "why" must be under 12 words.
- Do not repeat names. Mix TLDs across results.
- Avoid trademarked or offensive terms.

Example output:
[{"name":"brewhaus","tld":"com","why":"German-inspired coffee vibe"},{"name":"brewly","tld":"io","why":"Short, modern, tech-friendly"}]`;
}

// ---------- OpenAI call ----------
async function callOpenAI(keyword, options) {
  const client = getClient();
  if (!client) throw new Error('No API key available');

  const prompt = buildPrompt(keyword, options);

  const res = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.9,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You output strict JSON only. Never wrap in markdown fences.' },
      { role: 'user', content: prompt + '\n\nWrap the array inside {"domains": [...]}.' },
    ],
  });

  const raw = res.choices[0].message.content.trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    parsed = JSON.parse(cleaned);
  }

  const list = parsed.domains || parsed;
  if (!Array.isArray(list)) throw new Error('AI returned non-array');

  return list
    .filter(d => d && typeof d.name === 'string' && typeof d.tld === 'string')
    .map(d => ({
      domain: `${d.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.${d.tld.toLowerCase()}`,
      why: (d.why || '').slice(0, 80),
      source: 'ai',
    }))
    .filter(d => d.domain.split('.')[0].length >= 3);
}

// ---------- Fallback ----------
const prefixes = ['get', 'try', 'go', 'my', 'the', 'hey', 'use', 'join', 'weare'];
const suffixes = ['ly', 'ify', 'hub', 'lab', 'base', 'kit', 'flow', 'nest', 'stack', 'zone'];

function fallbackGenerate(keyword, { count, tlds }) {
  const k = keyword.toLowerCase().replace(/[^a-z0-9]/g, '');
  const out = new Set();
  for (const p of prefixes) out.add(`${p}${k}.com`);
  for (const s of suffixes) out.add(`${k}${s}.com`);
  for (const tld of tlds) out.add(`${k}.${tld}`);
  return [...out].slice(0, count).map(domain => ({
    domain,
    why: 'Rule-based fallback',
    source: 'fallback',
  }));
}

// ---------- Public API ----------
export async function generateDomains(keyword, options = {}) {
  const opts = {
    count: Math.min(Math.max(options.count || 20, 5), 40),
    style: options.style || 'brandable',
    tlds: Array.isArray(options.tlds) && options.tlds.length
      ? options.tlds.slice(0, 6)
      : ['com', 'io', 'ai', 'co'],
  };

  const cacheKey = JSON.stringify({ keyword: keyword.toLowerCase(), ...opts });
  const cached = getCached(cacheKey);
  if (cached) return { ...cached, cached: true };

  let domains;
  let usedAI = true;

  try {
    domains = await callOpenAI(keyword, opts);
    if (domains.length === 0) throw new Error('Empty AI response');
  } catch (err) {
    console.warn('[generate] AI failed, using fallback:', err.message);
    domains = fallbackGenerate(keyword, opts);
    usedAI = false;
  }

  const seen = new Set();
  domains = domains.filter(d => (seen.has(d.domain) ? false : seen.add(d.domain)));

  const result = { keyword, domains, usedAI };
  setCached(cacheKey, result);
  return result;
}