const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const userAgents = require('user-agents');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');
const { setTimeout } = require('timers/promises');

// Apply stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

class WebScraper {
  constructor(config = {}) {
    this.config = {
      baseURL: 'https://www.ebay.com/sch/i.html?_nkw=watches&_sacat=0&_from=R40&_trksid=p4439441.m570.l1313',
      rateLimit: 3000,
      maxRetries: 3,
      headless: 'new',
      outputFile: 'scraped_data.json',
      stealthMode: true,
      useProxies: false,
      proxyUrl: '',
      selector: 'h3 > a',
      ...config
    };
    
    this.scrapedData = [];
    this.requestCount = 0;
    this.currentUserAgent = new userAgents({ deviceCategory: 'desktop' }).toString();
  }

  async checkRobotsTxt() {
    try {
      const robotsUrl = new URL('/robots.txt', this.config.baseURL).href;
      const response = await axios.get(robotsUrl, {
        headers: { 'User-Agent': this.currentUserAgent }
      });
      
      console.log('Robots.txt contents:');
      console.log(response.data);
      
      // Check for explicit disallow rules
      if (response.data.includes('Disallow: /') || 
          response.data.includes('Disallow: *')) {
        console.warn('⚠️ WARNING: Robots.txt prohibits scraping this site!');
        return false;
      }
      return true;
    } catch (error) {
      console.warn('No robots.txt found. Proceeding with caution.');
      return true;
    }
  }

  async scrapeStatic(url, selector) {
    try {
      // Rotate user agent
      this.currentUserAgent = new userAgents({ deviceCategory: 'desktop' }).toString();
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.currentUserAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
        },
        timeout: 15000,
        httpsAgent: this.config.useProxies && this.config.proxyUrl 
          ? new HttpsProxyAgent(this.config.proxyUrl) 
          : undefined
      });
      
      const $ = cheerio.load(response.data);
      const results = [];
      
      $(selector).each((i, element) => {
        results.push({
          title: $(element).attr('title') || $(element).text().trim(),
          url: $(element).attr('href')
        });
      });
      
      return results;
    } catch (error) {
      console.error(`Static scrape error: ${error.message}`);
      throw error;
    }
  }

  async scrapeDynamic(url, selector) {
    const browser = await puppeteer.launch({
      headless: this.config.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1366,768',
        this.config.useProxies && this.config.proxyUrl 
          ? `--proxy-server=${this.config.proxyUrl.split('://')[1]}`
          : ''
      ].filter(Boolean),
    });
    
    try {
      const page = await browser.newPage();
      
      // Set stealth headers
      if (this.config.stealthMode) {
        await page.setUserAgent(this.currentUserAgent);
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'en-US,en;q=0.9',
          'Upgrade-Insecure-Requests': '1'
        });
        
        // Evade automation detection
        await page.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
          Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
          Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        });
      }

      await page.goto(url, { 
        waitUntil: 'networkidle2', 
        timeout: 60000 
      });
      
      // Wait for selector with timeout
      try {
        await page.waitForSelector(selector, { timeout: 10000 });
      } catch (waitError) {
        console.warn('Selector not found, proceeding with available content');
      }
      
      return await page.evaluate((sel) => {
        const elements = Array.from(document.querySelectorAll(sel));
        return elements.map(el => ({
          title: el.title || el.innerText.trim(),
          url: el.href
        }));
      }, selector);
    } catch (error) {
      console.error(`Dynamic scrape error: ${error.message}`);
      throw error;
    } finally {
      await browser.close();
    }
  }

  async scrapePagination() {
    let pageNum = 1;
    let hasNextPage = true;
    
    while (hasNextPage && pageNum < 10) { // Safety limit
      try {
        // Amazon-specific URL pattern
        const url = this.config.baseURL.includes('amazon')
          ? `${this.config.baseURL}&page=${pageNum}`
          : `${this.config.baseURL}catalogue/page-${pageNum}.html`;
          
        console.log(`📄 Scraping page ${pageNum}`);
        
        const pageData = await this.scrapeWithRetry(
          url, 
          this.config.selector,
          this.config.baseURL.includes('amazon') // Use dynamic for Amazon
        );
        
        this.scrapedData = [...this.scrapedData, ...pageData];
        pageNum++;
        
        if (pageData.length === 0) {
          console.log('No more data found. Ending pagination.');
          hasNextPage = false;
        }
        
        // Random delay to simulate human behavior
        const delay = this.config.rateLimit + Math.random() * 2000;
        await setTimeout(delay);
      } catch (error) {
        console.error(`Pagination error: ${error.message}`);
        hasNextPage = false;
      }
    }
  }

  async scrapeWithRetry(url, selector, isDynamic = false) {
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        this.requestCount++;
        console.log(`↗️ Request #${this.requestCount} (Attempt ${attempt}) to ${url.substring(0, 60)}...`);
        
        return isDynamic 
          ? await this.scrapeDynamic(url, selector)
          : await this.scrapeStatic(url, selector);
      } catch (error) {
        if (attempt === this.config.maxRetries) {
          console.error(`🚨 Final attempt failed: ${error.message}`);
          throw error;
        }
        
        // Calculate delay with jitter
        const baseDelay = Math.min(2000 * Math.pow(2, attempt), 30000);
        const jitter = Math.random() * 1000;
        const delay = baseDelay + jitter;
        
        console.warn(`🔄 Retry ${attempt} in ${Math.round(delay)}ms...`);
        await setTimeout(delay);
        
        // Rotate user agent for next attempt
        this.currentUserAgent = new userAgents({ deviceCategory: 'desktop' }).toString();
      }
    }
  }

  saveData() {
    try {
      const ext = this.config.outputFile.split('.').pop();
      
      if (ext === 'json') {
        fs.writeFileSync(
          this.config.outputFile, 
          JSON.stringify(this.scrapedData, null, 2)
        );
      } else if (ext === 'csv') {
        const header = Object.keys(this.scrapedData[0]).join(',');
        const rows = this.scrapedData.map(item => 
          Object.values(item).map(val => 
            `"${String(val).replace(/"/g, '""')}"`
          ).join(',')
        );
        fs.writeFileSync(this.config.outputFile, [header, ...rows].join('\n'));
      }
      
      console.log(`✅ Saved ${this.scrapedData.length} items to ${this.config.outputFile}`);
    } catch (error) {
      console.error('Data save error:', error.message);
    }
  }

  async run() {
    console.log('🚀 Starting web scraper');
    console.log(`Target site: ${this.config.baseURL}`);
    console.log(`User Agent: ${this.currentUserAgent}`);
    
    // Check robots.txt
    const allowed = await this.checkRobotsTxt();
    if (!allowed) {
      console.error('❌ Aborting due to robots.txt restrictions');
      return;
    }
    
    try {
      console.log('🔍 Starting initial scrape...');
      const initialData = await this.scrapeWithRetry(
        this.config.baseURL,
        this.config.selector,
        this.config.baseURL.includes('amazon')
      );
      this.scrapedData = initialData;
      console.log(`📦 Initial scrape found ${initialData.length} items`);
      
      // Handle pagination
      console.log('➡️ Starting pagination...');
      await this.scrapePagination();
      
      // Save results
      this.saveData();
      console.log(`✨ Total requests: ${this.requestCount}`);
      console.log('🎉 Scraping complete!');
    } catch (error) {
      console.error(`❌ Critical error: ${error.message}`);
      console.error('Scraping aborted');
    }
  }
}

// Execution
(async () => {
  // For Amazon scraping (use with proxies)
  /*
  const scraper = new WebScraper({
    baseURL: 'https://www.amazon.com/s?k=watches',
    selector: 'h2 a.a-link-normal', // Amazon product link selector
    useProxies: true,
    proxyUrl: 'http://user:pass@proxy-ip:port', // Replace with real proxy
    rateLimit: 5000,
    stealthMode: true,
    outputFile: 'amazon_watches.csv'
  });
  */
  
  // For learning (books.toscrape.com)
  const scraper = new WebScraper({
    baseURL: 'https://www.ebay.com/sch/i.html?_nkw=watches&_sacat=0&_from=R40&_trksid=p4439441.m570.l1313',
    selector: 'h3 > a',
    outputFile: 'books.json'
  });
  
  await scraper.run();
})();