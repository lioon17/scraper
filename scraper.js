
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const userAgents = require('user-agents');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');
const { setTimeout } = require('timers/promises');

puppeteer.use(StealthPlugin());

class WebScraper {
  constructor(config = {}) {
    this.config = {
      rateLimit: 3000,
      maxRetries: 3,
      headless: 'new',
      outputFile: null,       // optional: set to null unless saving is desired
      stealthMode: true,
      useProxies: false,
      proxyUrl: '',
      ...config
    };
    this.scrapedData = [];
    this.requestCount = 0;
    this.currentUserAgent = new userAgents({ deviceCategory: 'desktop' }).toString();
  }


    async checkRobotsTxt(targetUrl) {
    try {
      const robotsUrl = new URL('/robots.txt', targetUrl).href;
      const response = await axios.get(robotsUrl, {
        headers: { 'User-Agent': this.currentUserAgent }
      });
      console.log('Robots.txt contents:\n' + response.data);
      if (response.data.includes('Disallow: /') || response.data.includes('Disallow: *')) {
        console.warn('⚠️ WARNING: Robots.txt prohibits scraping this site!');
        return false;
      }
      return true;
    } catch (_) {
      console.warn('No robots.txt found. Proceeding.');
      return true;
    }
  }


async scrapeStatic(url, selector) {
  try {
    this.currentUserAgent = new userAgents({ deviceCategory: 'desktop' }).toString();
    const response = await axios.get(url, {
      headers: {
        'User-Agent': this.currentUserAgent,
        'Accept': 'text/html',
      },
      timeout: 15000,
      httpsAgent: this.config.useProxies && this.config.proxyUrl 
        ? new HttpsProxyAgent(this.config.proxyUrl) 
        : undefined
    });

    const $ = cheerio.load(response.data);
    const results = [];

    $(selector).each((i, el) => {
      const title = $(el).attr('title') || $(el).text().trim();
      const href = $(el).attr('href');
      
      // Attempt to find associated image (assumes image is in parent or sibling)
      const parent = $(el).closest('.product_pod');
      const imgSrc = parent.find('img').attr('src');

      // Resolve full image URL
      const imageUrl = imgSrc
        ? new URL(imgSrc, url).href
        : null;

      results.push({
        title,
        url: href,
        image: imageUrl
      });
    });

    return results;
  } catch (error) {
    console.error(`Static scrape error: ${error.message}`);
    throw error;
  }
}


  async scrapeWithRetry(url, selector) {
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        this.requestCount++;
        console.log(`Attempt ${attempt}: ${url}`);
        return await this.scrapeStatic(url, selector);
      } catch (error) {
        if (attempt === this.config.maxRetries) throw error;
        const delay = 2000 * attempt + Math.random() * 1000;
        console.log(`Retrying in ${Math.round(delay)}ms...`);
        await setTimeout(delay);
      }
    }
  }

  saveData() {
    fs.writeFileSync(this.config.outputFile, JSON.stringify(this.scrapedData, null, 2));
  }

   async run({ url, selector }) {
    console.log('🚀 Starting web scraper');
    console.log(`Target site: ${url}`);
    const allowed = await this.checkRobotsTxt(url);
    if (!allowed) return [];

    try {
      const data = await this.scrapeWithRetry(url, selector);
      this.scrapedData = data;

      if (this.config.outputFile) {
        this.saveData();
        console.log(`💾 Saved ${data.length} items to ${this.config.outputFile}`);
      }

      return data;
    } catch (err) {
      console.error('❌ Scraping failed:', err.message);
      return [];
    }
  }
}

module.exports = WebScraper;
