
const express = require('express');
const fs = require('fs');
const WebScraper = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/scrape', async (req, res) => {
  const url = req.query.url;
  const selector = req.query.selector;

  if (!url || !selector) {
    return res.status(400).json({ success: false, message: 'Missing url or selector' });
  }

  const scraper = new WebScraper();
  const data = await scraper.run({ url, selector });

  res.json({ success: true, count: data.length, data });
});


app.listen(PORT, () => {
  console.log(`✅ Express scraper server running at http://localhost:${PORT}`);
});
