// server.js
require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const WebScraper = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ---------- Health check (for UptimeRobot) ----------
app.get('/ping', (_req, res) => res.status(200).send('OK'));

// ---------- Your HTML scraper endpoint (uses scraper.js) ----------
// Example: /scrape?url=https://books.toscrape.com/&selector=h3%20%3E%20a
app.get('/scrape', async (req, res) => {
  try {
    const { url, selector } = req.query;
    if (!url || !selector) {
      return res.status(400).json({ success: false, message: 'Missing url or selector' });
    }
    const scraper = new WebScraper();
    const data = await scraper.run({ url, selector });
    return res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('Scrape error:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Scrape failed' });
  }
});

// ---------- SearchAPI.io helpers ----------
const SEARCHAPI_ENDPOINT = 'https://www.searchapi.io/api/v1/search';
function requireKey(res) {
  if (!process.env.SEARCHAPI_KEY) {
    res.status(500).json({ error: 'SEARCHAPI_KEY missing. Set it in .env' });
    return false;
  }
  return true;
}

// ---------- Google Shopping (SearchAPI.io) ----------
// Example: /search/google-shopping?q=watches&location=United%20States
app.get('/search/google-shopping', async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const { q, location } = req.query;
    if (!q) return res.status(400).json({ error: 'Missing q' });

    const params = new URLSearchParams({ engine: 'google_shopping', q });
    if (location) params.set('location', location);

    const r = await axios.get(`${SEARCHAPI_ENDPOINT}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${process.env.SEARCHAPI_KEY}` },
      timeout: 30000,
    });
    return res.status(r.status).json(r.data);
  } catch (err) {
    console.error('google-shopping error:', err?.response?.status, err?.message);
    const status = err?.response?.status || 500;
    return res.status(status).json({ error: 'SearchAPI google-shopping failed' });
  }
});

// ---------- Amazon search (SearchAPI.io) ----------
// Example: /search/amazon?q=mechanical+watch
app.get('/search/amazon', async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Missing q' });

    const params = new URLSearchParams({ engine: 'amazon_search', q });
    const r = await axios.get(`${SEARCHAPI_ENDPOINT}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${process.env.SEARCHAPI_KEY}` },
      timeout: 30000,
    });
    return res.status(r.status).json(r.data);
  } catch (err) {
    console.error('amazon search error:', err?.response?.status, err?.message);
    const status = err?.response?.status || 500;
    return res.status(status).json({ error: 'SearchAPI amazon search failed' });
  }
});

// ---------- Amazon product (raw) (SearchAPI.io) ----------
// Example: /search/amazon-product?asin=B0D1XD1ZV3&amazon_domain=amazon.com&delivery_country=us
app.get('/search/amazon-product', async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const { asin, amazon_domain = 'amazon.com', delivery_country = 'us' } = req.query;
    if (!asin) return res.status(400).json({ error: 'Missing asin' });

    const params = new URLSearchParams({
      engine: 'amazon_product',
      asin,
      amazon_domain,
      delivery_country,
    });

    const r = await axios.get(`${SEARCHAPI_ENDPOINT}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${process.env.SEARCHAPI_KEY}` },
      timeout: 30000,
    });
    return res.status(r.status).json(r.data);
  } catch (err) {
    console.error('amazon product error:', err?.response?.status, err?.message);
    const status = err?.response?.status || 500;
    return res.status(status).json({ error: 'SearchAPI amazon product failed' });
  }
});

// ---------- Amazon product (clean) (SearchAPI.io) ----------
// Example: /search/amazon-product/clean?asin=B0D1XD1ZV3&amazon_domain=amazon.com&delivery_country=us
app.get('/search/amazon-product/clean', async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const { asin, amazon_domain = 'amazon.com', delivery_country = 'us' } = req.query;
    if (!asin) return res.status(400).json({ error: 'Missing asin' });

    const params = new URLSearchParams({
      engine: 'amazon_product',
      asin,
      amazon_domain,
      delivery_country,
    });

    const r = await axios.get(`${SEARCHAPI_ENDPOINT}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${process.env.SEARCHAPI_KEY}` },
      timeout: 30000,
    });

    const p = r.data.product;
    if (!p) return res.status(404).json({ error: 'No product found' });

    const clean = {
      asin: p.asin,
      title: p.title,
      link: p.link,
      rating: p.rating ?? null,
      reviews: p.reviews ?? 0,
      price: p.buybox?.price?.value ?? null,
      currency: p.buybox?.price?.currency ?? null,
      original_price: p.buybox?.original_price?.value ?? null,
      in_stock: p.buybox?.availability?.toLowerCase().includes('in stock') ?? false,
      main_image: p.main_image || (p.images?.[0]?.link ?? null),
      images: (p.images || []).map(i => i.link),
      variants: (p.variants || []).map(v => ({
        asin: v.asin,
        title: v.title,
        main_image: v.main_image,
      })),
    };

    return res.json({ success: true, data: clean });
  } catch (err) {
    console.error('amazon product clean error:', err?.response?.status, err?.message);
    const status = err?.response?.status || 500;
    return res.status(status).json({ error: 'Clean product fetch failed' });
  }
});

// eBay keyword/category search (CLEAN)
app.get('/search/ebay/clean', async (req, res) => {
  try {
    const { q, ebay_domain = 'ebay.com' } = req.query;
    if (!q) return res.status(400).json({ error: 'Missing search query (q)' });

    const params = new URLSearchParams({ engine: 'ebay', q, ebay_domain });
    const r = await require('axios').get(
      `https://www.searchapi.io/api/v1/search?${params}`,
      { headers: { Authorization: `Bearer ${process.env.SEARCHAPI_KEY}` }, timeout: 30000 }
    );

    const items = r.data.organic_results || [];
    const data = items.map(i => ({
      item_id: i.item_id,
      title: i.title,
      link: i.link,
      price: i.price?.value ?? null,
      currency: i.price?.currency ?? null,
      seller: i.seller?.name ?? null,
      shipping: i.shipping?.price?.raw ?? null,
      image: i.thumbnail ?? null,
    }));
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    const status = err?.response?.status || 500;
    res.status(status).json({ error: 'Clean eBay search failed' });
  }
});


// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`✅ API running at http://localhost:${PORT}`);
});
