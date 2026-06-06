const express = require('express');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Fetch JSON over HTTPS (works on any Node version without node-fetch).
 */
function httpsGetJSON(url) {
    return new Promise((resolve, reject) => {
        const options = {
            rejectUnauthorized: false,
            headers: {
                'User-Agent': 'ExchangeRateTool/1.0'
            }
        };
        https.get(url, options, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(new Error('Invalid JSON from API'));
                }
            });
        }).on('error', (err) => {
            reject(new Error(`HTTPS request failed: ${err.message}`));
        });
    });
}

function yyyymmddToDdMmYyyy(yyyymmdd) {
    return `${yyyymmdd.slice(6, 8)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(0, 4)}`;
}

function yyyymmddToUnixSeconds(yyyymmdd) {
    const y = Number(yyyymmdd.slice(0, 4));
    const m = Number(yyyymmdd.slice(4, 6)) - 1;
    const d = Number(yyyymmdd.slice(6, 8));
    return Math.floor(Date.UTC(y, m, d, 12, 0, 0) / 1000);
}

function parsePositiveNumber(value) {
    const n = typeof value === 'string' ? Number(value) : value;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Fetch BTC/USD price from CoinGecko market_chart endpoint.
 * This endpoint works without an API key for basic usage.
 * Returns { prices, error } object where prices is array of [timestamp, price] pairs.
 */
async function fetchBtcUsdFromMarketChart(days) {
    try {
        const url = `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}&interval=daily`;
        console.log(`  [BTC API] Requesting CoinGecko market_chart: days=${days}`);
        console.log(`  [BTC API]   URL: ${url}`);
        const data = await httpsGetJSON(url);
        if (data && Array.isArray(data.prices) && data.prices.length > 0) {
            console.log(`  [BTC API]   ✓ Received ${data.prices.length} price points`);
            console.log(`  [BTC API]   Date range: ${new Date(data.prices[0][0]).toISOString()} to ${new Date(data.prices[data.prices.length - 1][0]).toISOString()}`);
            console.log(`  [BTC API]   Prices: $${data.prices[0][1]} to $${data.prices[data.prices.length - 1][1]}`);
            return { prices: data.prices, error: null };
        }
        console.log(`  [BTC API]   ✗ No price data in response`);
        return { prices: null, error: 'No price data returned from CoinGecko market_chart' };
    } catch (err) {
        console.log(`  [BTC API]   ✗ Request failed: ${err.message}`);
        return { prices: null, error: `CoinGecko market_chart failed: ${err.message}` };
    }
}

/**
 * Fetch BTC/USD price from CoinCap historical endpoint.
 * CoinCap is a free alternative that doesn't require an API key.
 */
async function fetchBtcUsdFromCoinCap(date) {
    try {
        const url = `https://api.coincap.io/v2/assets/bitcoin/history?date=${date.slice(6, 8)}-${date.slice(4, 6)}-${date.slice(0, 4)}`;
        const data = await httpsGetJSON(url);
        if (data && data.data && typeof data.data.price === 'number') {
            const usd = parsePositiveNumber(data.data.price);
            if (usd) {
                return usd;
            }
        }
        return null;
    } catch (err) {
        console.warn(`  CoinCap historical failed for ${date}: ${err.message}`);
        return null;
    }
}

/**
 * Cached market_chart data with expiry for efficiency.
 * Key: number of days, Value: { data, timestamp }
 * Also maintains a map of largest successful days for each request window.
 */
const marketChartCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Get market_chart data with automatic fallback to larger windows on cache miss.
 * If days=7 fails, tries days=8, 9, 10... until success.
 */
async function getCachedMarketChart(days) {
    const cacheKey = days;
    
    // Check cache first
    const cached = marketChartCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log(`  [BTC API]   ✓ Cache hit for days=${days} (${Math.round((Date.now() - cached.timestamp) / 1000)}s ago)`);
        return cached.data;
    }

    // Try with retry logic - increment days if request fails
    for (let attempt = 0; attempt <= 5; attempt++) {
        const tryDays = attempt === 0 ? days : days + attempt;
        console.log(`  [BTC API]   → API call attempt ${attempt + 1} for days=${tryDays}`);
        
        const result = await fetchBtcUsdFromMarketChart(tryDays);
        if (result.prices && result.prices.length > 0) {
            // Cache for all days from the requested value up to the actual value used
            for (let d = Math.min(days, tryDays); d <= tryDays; d++) {
                marketChartCache.set(d, { data: result.prices, timestamp: Date.now() });
            }
            console.log(`  [BTC API]   ✓ Served days=${days} using days=${tryDays} window (${result.prices.length} points)`);
            return result.prices;
        }
    }

    console.log(`  [BTC API]   ✗ All attempts failed for days=${days}`);
    return null;
}

/**
 * Find the closest price for a given date from market_chart prices array.
 * Matches by comparing the timestamp (converted to date string).
 */
function findPriceForDate(prices, targetDate) {
    const targetMs = Date.UTC(
        Number(targetDate.slice(0, 4)),
        Number(targetDate.slice(4, 6)) - 1,
        Number(targetDate.slice(6, 8)),
        12, 0, 0
    );

    let closest = null;
    let minDiff = Infinity;

    for (const [timestamp, price] of prices) {
        const diff = Math.abs(timestamp - targetMs);
        if (diff < minDiff) {
            minDiff = diff;
            closest = price;
        }
    }

    // Only return if within 2 days (to handle timezone/nearest-day matching)
    if (minDiff <= 2 * 24 * 60 * 60 * 1000 && closest != null && closest > 0) {
        return closest;
    }
    return null;
}

async function fetchBtcUsdHistorical(date) {
    // Determine how many days back this date is from today
    const today = new Date();
    const todayStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const target = new Date(
        Number(date.slice(0, 4)),
        Number(date.slice(4, 6)) - 1,
        Number(date.slice(6, 8))
    );
    const daysDiff = Math.ceil((today - target) / (1000 * 60 * 60 * 24)) + 1;

    console.log(`  [BTC API] Looking up date: ${date} (${yyyymmddToDdMmYyyy(date)}), daysDiff=${daysDiff}`);

    // For dates within the last 30 days, use market_chart (most reliable free endpoint)
    if (daysDiff <= 30 && daysDiff >= 1) {
        const prices = await getCachedMarketChart(daysDiff);
        if (prices && prices.length > 0) {
            const usd = findPriceForDate(prices, date);
            if (usd) {
                console.log(`  [BTC API]   ✓ Found: BTC/USD = $${usd} for ${date}`);
                return usd;
            }
            console.log(`  [BTC API]   ✗ No exact match for ${date} in market_chart data (closest match was outside 2-day window)`);
        }
    }

    // For older dates (31-90 days), use market_chart with days=90
    if (daysDiff > 30 && daysDiff <= 90) {
        const prices90 = await getCachedMarketChart(90);
        if (prices90 && prices90.length > 0) {
            const usd = findPriceForDate(prices90, date);
            if (usd) {
                console.log(`  [BTC API]   ✓ Found: BTC/USD = $${usd} for ${date} (from 90-day window)`);
                return usd;
            }
            console.log(`  [BTC API]   ✗ No match for ${date} in 90-day data`);
        }
    }

    // Try CoinCap as fallback
    console.log(`  [BTC API]   → Trying CoinCap fallback for ${date}...`);
    const coinCapPrice = await fetchBtcUsdFromCoinCap(date);
    if (coinCapPrice) {
        console.log(`  [BTC API]   ✓ CoinCap: BTC/USD = $${coinCapPrice} for ${date}`);
        return coinCapPrice;
    }
    console.log(`  [BTC API]   ✗ CoinCap failed for ${date}`);

    // Last resort: try CoinGecko daily endpoint
    console.log(`  [BTC API]   → Trying CoinGecko history endpoint for ${date}...`);
    try {
        const cgDate = yyyymmddToDdMmYyyy(date);
        const url = `https://api.coingecko.com/api/v3/coins/bitcoin/history?date=${cgDate}&localization=false`;
        const data = await httpsGetJSON(url);
        if (data && data.market_data && data.market_data.current_price && data.market_data.current_price.usd) {
            const usd = parsePositiveNumber(data.market_data.current_price.usd);
            if (usd) {
                console.log(`  [BTC API]   ✓ CoinGecko history: BTC/USD = $${usd} for ${date}`);
                return usd;
            }
        }
    } catch (err) {
        console.warn(`  [BTC API]   ✗ CoinGecko history failed for ${date}: ${err.message}`);
    }

    console.log(`  [BTC API]   ✗ No data available for ${date}`);
    return null;
}

async function fetchBtcUsdLive() {
    // CoinGecko live
    const liveUrl = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';
    const live = await httpsGetJSON(liveUrl);
    const usd = parsePositiveNumber(live?.bitcoin?.usd);
    return usd || null;
}

/**
 * Proxy endpoint — avoids browser CORS issues.
 * Query params:
 *   date  – YYYYMMDD (optional, validated)
 */
app.get('/api/rates', async (req, res) => {
    try {
        const { date } = req.query;
        let url =
            'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json';
        if (date && /^\d{8}$/.test(date)) {
            url += `&date=${date}`;
        }
        const data = await httpsGetJSON(url);
        res.json(data);
    } catch (err) {
        console.error('NBU API error:', err.message);
        res.status(502).json({ error: 'Failed to fetch rates from NBU API' });
    }
});

/**
 * BTC/USD endpoint via CoinGecko.
 * Query params:
 *   date  – YYYYMMDD (optional)
 */
app.get('/api/btc-usd', async (req, res) => {
    try {
        const { date } = req.query;

        if (date && /^\d{8}$/.test(date)) {
            const usd = await fetchBtcUsdHistorical(date);
            if (usd) {
                return res.json({ usd });
            }

            const today = new Date();
            const todayStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
            if (date !== todayStr) {
                return res.status(404).json({ error: 'BTC/USD not available for the requested date' });
            }
        }

        const usd = await fetchBtcUsdLive();
        if (usd) {
            return res.json({ usd });
        }

        return res.status(502).json({ error: 'Failed to fetch BTC/USD' });
    } catch (err) {
        console.error('CoinGecko API error:', err.message);
        return res.status(502).json({ error: 'Failed to fetch BTC/USD from CoinGecko' });
    }
});

/**
 * BTC/USD bulk endpoint — returns all prices for a given period in a single response.
 * Uses CoinGecko market_chart endpoint to get all data in one API call.
 * Query params:
 *   days  – number of days (required)
 */
app.get('/api/btc-bulk', async (req, res) => {
    try {
        const { days } = req.query;
        const daysNum = parseInt(days, 10);

        if (!daysNum || daysNum < 1 || daysNum > 90) {
            return res.status(400).json({ error: 'Invalid days parameter. Must be 1-90.' });
        }

        console.log(`\n  [BTC BULK] Requested: ${daysNum} days of BTC/USD data`);

        // Use market_chart endpoint (single API call)
        const url = `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${daysNum}&interval=daily`;
        console.log(`  [BTC BULK]   URL: ${url}`);

        const data = await httpsGetJSON(url);

        if (!data || !Array.isArray(data.prices) || data.prices.length === 0) {
            console.log(`  [BTC BULK]   ✗ No data from CoinGecko`);
            return res.status(502).json({ error: 'No BTC data available' });
        }

        // Convert prices array to date-keyed object with ISO date keys (YYYY-MM-DD)
        const prices = {};
        let minPrice = Infinity;
        let maxPrice = -Infinity;
        let minDate = '';
        let maxDate = '';

        for (const [timestamp, price] of data.prices) {
            const dateStr = new Date(timestamp).toISOString().split('T')[0];
            prices[dateStr] = price;

            if (price < minPrice) { minPrice = price; minDate = dateStr; }
            if (price > maxPrice) { maxPrice = price; maxDate = dateStr; }
        }

        const startDate = data.prices[0] ? new Date(data.prices[0][0]).toISOString().split('T')[0] : 'N/A';
        const endDate = data.prices[data.prices.length - 1] ? new Date(data.prices[data.prices.length - 1][0]).toISOString().split('T')[0] : 'N/A';

        console.log(`  [BTC BULK]   ✓ Received ${data.prices.length} price points`);
        console.log(`  [BTC BULK]   Date range: ${startDate} to ${endDate}`);
        console.log(`  [BTC BULK]   Prices: $${minPrice.toFixed(2)} to $${maxPrice.toFixed(2)}`);
        console.log(`  [BTC BULK]   Min price: $${minPrice.toFixed(2)} on ${minDate}`);
        console.log(`  [BTC BULK]   Max price: $${maxPrice.toFixed(2)} on ${maxDate}`);
        console.log(`  [BTC BULK]   Sample: ${JSON.stringify(Object.entries(prices).slice(0, 5))}\n`);

        return res.json({
            startDate,
            endDate,
            dataPoints: data.prices.length,
            minPrice: minPrice.toFixed(2),
            maxPrice: maxPrice.toFixed(2),
            prices
        });
    } catch (err) {
        console.error(`  [BTC BULK]   ✗ Error: ${err.message}`);
        return res.status(502).json({ error: 'Failed to fetch BTC/USD bulk data' });
    }
});

app.listen(PORT, () => {
    console.log(`\n  Exchange Rate Tool running at:\n  → http://localhost:${PORT}\n`);
});
