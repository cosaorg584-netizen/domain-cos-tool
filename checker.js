import fetch from 'node-fetch';

const RDAP = {
  com: 'https://rdap.verisign.com/com/v1/domain/',
  net: 'https://rdap.verisign.com/net/v1/domain/',
  org: 'https://rdap.publicinterestregistry.org/rdap/domain/',
  io:  'https://rdap.nic.io/domain/',
  ai:  'https://rdap.identitydigital.services/rdap/domain/',
  co:  'https://rdap.nic.co/domain/',
  dev: 'https://rdap.nic.google/domain/',
  app: 'https://rdap.nic.google/domain/',
  xyz: 'https://rdap.centralnic.com/xyz/domain/',
};

const cache = new Map();
const TTL = 1000 * 60 * 30; // 30 min

export async function checkOne(domain) {
  const key = domain.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;

  const tld = key.split('.').pop();
  const base = RDAP[tld];
  let result;

  if (!base) {
    result = { domain: key, status: 'unknown', note: 'TLD not supported' };
  } else {
    try {
      const res = await fetch(base + key, {
        timeout: 5000,
        headers: { Accept: 'application/rdap+json' },
      });
      if (res.status === 404) result = { domain: key, status: 'available' };
      else if (res.status === 200) result = { domain: key, status: 'taken' };
      else result = { domain: key, status: 'unknown', note: `HTTP ${res.status}` };
    } catch (e) {
      result = { domain: key, status: 'unknown', note: 'lookup failed' };
    }
  }

  cache.set(key, { v: result, t: Date.now() });
  return result;
}

export async function checkMany(domains, concurrency = 5) {
  const out = [];
  for (let i = 0; i < domains.length; i += concurrency) {
    const batch = domains.slice(i, i + concurrency);
    out.push(...(await Promise.all(batch.map(checkOne))));
  }
  return out;
}