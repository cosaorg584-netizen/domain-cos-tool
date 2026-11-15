import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { generateDomains } from './generator.js';
import { checkMany } from './checker.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50kb' }));
app.use(express.static('public'));

// Rate limits — protect OpenAI spend and RDAP abuse
const generateLimiter = rateLimit({ windowMs: 60_000, max: 10 });
const checkLimiter = rateLimit({ windowMs: 60_000, max: 30 });

app.get('/api/config', (req, res) => {
  res.json({ affiliateId: process.env.NAMECHEAP_AFFILIATE_ID || '' });
});

app.post('/api/generate', generateLimiter, async (req, res) => {
  const { keyword, style, tlds, count } = req.body || {};
  if (!keyword || typeof keyword !== 'string' || keyword.length > 60) {
    return res.status(400).json({ error: 'keyword required (max 60 chars)' });
  }
  try {
    const result = await generateDomains(keyword.trim(), { style, tlds, count });
    res.json(result);
  } catch (err) {
    console.error('[generate]', err);
    res.status(500).json({ error: 'generation failed' });
  }
});

app.post('/api/check', checkLimiter, async (req, res) => {
  const { domains } = req.body || {};
  if (!Array.isArray(domains) || domains.length === 0 || domains.length > 40) {
    return res.status(400).json({ error: 'domains array required (1-40)' });
  }
  try {
    const results = await checkMany(domains);
    res.json({ results });
  } catch (err) {
    console.error('[check]', err);
    res.status(500).json({ error: 'check failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`▶ http://localhost:${PORT}`));