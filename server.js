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
        https.get(url, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(new Error('Invalid JSON from NBU API'));
                }
            });
        }).on('error', reject);
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

async function fetchBtcUsdHistorical(date) {
    // 1) CoinGecko historical
    const cgDate = yyyymmddToDdMmYyyy(date);
    try {
        const histUrl = `https://api.coingecko.com/api/v3/coins/bitcoin/history?date=${cgDate}&localization=false`;
        const hist = await httpsGetJSON(histUrl);
        const usd = parsePositiveNumber(hist?.market_data?.current_price?.usd);
        if (usd) return usd;
    } catch {
        // continue with fallback source
    }

    // 2) CryptoCompare historical snapshot
    try {
        const ts = yyyymmddToUnixSeconds(date);
        const ccUrl = `https://min-api.cryptocompare.com/data/pricehistorical?fsym=BTC&tsyms=USD&ts=${ts}`;
        const cc = await httpsGetJSON(ccUrl);
        const usd = parsePositiveNumber(cc?.BTC?.USD);
        if (usd) return usd;
    } catch {
        // no-op
    }

    return null;
}

async function fetchBtcUsdLive() {
    // 1) CoinGecko live
    try {
        const liveUrl = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';
        const live = await httpsGetJSON(liveUrl);
        const usd = parsePositiveNumber(live?.bitcoin?.usd);
        if (usd) return usd;
    } catch {
        // continue with fallback source
    }

    // 2) Coinbase live spot
    try {
        const cbUrl = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';
        const cb = await httpsGetJSON(cbUrl);
        const usd = parsePositiveNumber(cb?.data?.amount);
        if (usd) return usd;
    } catch {
        // continue with fallback source
    }

    // 3) Kraken live ticker
    try {
        const krUrl = 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD';
        const kr = await httpsGetJSON(krUrl);
        const pair = kr?.result ? Object.values(kr.result)[0] : null;
        const usd = parsePositiveNumber(Array.isArray(pair?.c) ? pair.c[0] : null);
        if (usd) return usd;
    } catch {
        // no-op
    }

    return null;
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

app.listen(PORT, () => {
    console.log(`\n  Exchange Rate Tool running at:\n  → http://localhost:${PORT}\n`);
});
