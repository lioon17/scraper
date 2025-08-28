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


function ebayBase() {
  return process.env.EBAY_ENV === 'production'
    ? 'https://api.ebay.com'
    : 'https://api.sandbox.ebay.com';
}

async function getEbayToken() {
  const tokenUrl = `${ebayBase()}/identity/v1/oauth2/token`;
  const basic = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString('base64');

  const resp = await axios.post(
    tokenUrl,
    new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope' // basic Buy scope
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`
      },
      timeout: 20000
    }
  );

  return resp.data.access_token; // use this in Authorization: Bearer ...
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
// Clean Amazon keyword search
app.get('/search/amazon/clean', async (req, res) => {
  try {
    if (!process.env.SEARCHAPI_KEY) return res.status(500).json({ error: 'SEARCHAPI_KEY missing' });

    const { q, amazon_domain = 'amazon.com', delivery_country = 'us', page = '1' } = req.query;
    if (!q) return res.status(400).json({ error: 'Missing q' });

    const params = new URLSearchParams({
      engine: 'amazon_search',
      q,
      amazon_domain,
      delivery_country,
      page
    });

    const r = await axios.get(`https://www.searchapi.io/api/v1/search?${params}`,
      { headers: { Authorization: `Bearer ${process.env.SEARCHAPI_KEY}` }, timeout: 30000 });

    const items = r.data.organic_results || [];
    const data = items.map(i => ({
      asin: i.asin,
      title: i.title,
      link: i.link,
      price: i.price?.value ?? null,
      currency: i.price?.currency ?? null,
      rating: i.rating ?? null,
      reviews: i.reviews ?? 0,
      image: i.thumbnail ?? null,
      badges: i.badges || [],
      delivery: i.delivery ?? null
    }));

    res.json({
      success: true,
      query: q,
      domain: amazon_domain,
      page: Number(page),
      count: data.length,
      data
    });
  } catch (err) {
    const status = err?.response?.status || 500;
    res.status(status).json({ error: 'Amazon keyword search failed' });
  }
});

// ===== eBay OAuth + Browse API (official) =====
const EBAY_IDENTITY_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_BROWSE_BASE = 'https://api.ebay.com/buy/browse/v1';
const EBAY_MARKETPLACE_ID = process.env.EBAY_MARKETPLACE_ID || 'EBAY_US';

const ebayTokenCache = {
  accessToken: null,
  // epoch milliseconds
  expiresAt: 0,
};

// Get or refresh an OAuth token (Client Credentials flow)
async function getEbayAccessToken() {
  const now = Date.now();
  if (ebayTokenCache.accessToken && now < ebayTokenCache.expiresAt - 30_000) {
    return ebayTokenCache.accessToken;
  }

  const basic = Buffer
    .from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`)
    .toString('base64');

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    // General read-only scope is enough for Browse API
    scope: 'https://api.ebay.com/oauth/api_scope',
  });

  const resp = await axios.post(EBAY_IDENTITY_URL, params.toString(), {
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: 20000,
  });

  const { access_token, expires_in } = resp.data; // expires_in in seconds
  ebayTokenCache.accessToken = access_token;
  ebayTokenCache.expiresAt = Date.now() + (expires_in * 1000);
  return access_token;
}

// Small helper to call eBay Browse API with auth + marketplace header
async function ebayBrowseGET(path, query = {}) {
  const token = await getEbayAccessToken();
  const url = new URL(`${EBAY_BROWSE_BASE}${path}`);
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && `${v}` !== '') url.searchParams.set(k, v);
  });

  const resp = await axios.get(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': EBAY_MARKETPLACE_ID,
    },
    timeout: 30000,
  });

  return resp.data;
}

// ---------- /ebay/search  (keyword → results)
// Example: /ebay/search?q=airpods%20pro&limit=10
app.get('/ebay/search', async (req, res) => {
  try {
    if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
      return res.status(500).json({ error: 'Missing EBAY_CLIENT_ID/EBAY_CLIENT_SECRET in .env' });
    }
    const { q, limit = '10', offset = '0' } = req.query;
    if (!q) return res.status(400).json({ error: 'Missing q' });

    // Browse API: item summary search
    const data = await ebayBrowseGET('/item_summary/search', {
      q,
      limit,
      offset,
    });

    // Optional: clean fields for your frontend
    const items = (data.itemSummaries || []).map(it => ({
      item_id: it.itemId,                      // note: composite id like "v1|XXXXXXXX|0"
      title: it.title,
      price: it.price?.value ?? null,
      currency: it.price?.currency ?? null,
      condition: it.condition,
      image: it.image?.imageUrl ?? null,
      seller: it.seller?.username ?? null,
      link: it.itemWebUrl,                    // public product URL
      location: it.itemLocation?.country ?? null,
    }));

    res.json({
      success: true,
      query: q,
      total: data.total || items.length,
      count: items.length,
      items,
      raw: data, // remove if you don’t want to return raw
    });
  } catch (err) {
    console.error('eBay search error:', err?.response?.status, err?.message);
    res.status(err?.response?.status || 500).json({ error: 'eBay search failed' });
  }
});

// ---------- /ebay/item  (item id → details)
// Accepts either composite id "v1|1234567890|0" OR numeric "1234567890"
app.get('/ebay/item', async (req, res) => {
  try {
    if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
      return res.status(500).json({ error: 'Missing EBAY_CLIENT_ID/EBAY_CLIENT_SECRET in .env' });
    }
    let { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // If a plain numeric id is provided, convert to composite form
    if (!id.includes('|')) {
      id = `v1|${id}|0`;
    }

    const data = await ebayBrowseGET(`/item/${encodeURIComponent(id)}`);

    // Optional: clean shape
    const clean = {
      item_id: data.itemId,
      title: data.title,
      price: data.price?.value ?? null,
      currency: data.price?.currency ?? null,
      condition: data.condition,
      image: data.image?.imageUrl ?? null,
      images: (data.additionalImages || []).map(i => i.imageUrl),
      seller: data.seller?.username ?? null,
      categories: (data.categoryPath || '').split('>').map(s => s.trim()).filter(Boolean),
      link: data.itemWebUrl,
      location: data.itemLocation?.country ?? null,
      shipping_options: data.shippingOptions || [],
      returns: data.returnTerms || null,
    };

    res.json({ success: true, data: clean, raw: data }); // drop "raw" if not needed
  } catch (err) {
    console.error('eBay item error:', err?.response?.status, err?.message);
    res.status(err?.response?.status || 500).json({ error: 'eBay item fetch failed' });
  }
});



// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`✅ API running at http://localhost:${PORT}`);
});
