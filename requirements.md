# Requirements — Exchange Rates Tool

## 1. Overview

A browser-based exchange rate dashboard that displays current and historical rates for fiat currencies, Bitcoin, Gold, and Silver. Fiat and commodity rates are sourced from the National Bank of Ukraine (NBU); Bitcoin rates are sourced from third-party crypto APIs. A lightweight Node.js proxy server eliminates browser CORS restrictions.

---

## 2. Functional Requirements

### 2.1 Rate Cards (Current Rates)

| ID | Requirement |
|----|-------------|
| FR-01 | Display the latest rate for USD/UAH. |
| FR-02 | Display the latest rate for EUR/UAH. |
| FR-03 | Display the derived cross rate EUR/USD. |
| FR-04 | Display the latest Bitcoin/USD rate. |
| FR-05 | Display the latest Gold (XAU)/USD rate. |
| FR-06 | Display the latest Silver (XAG)/USD rate. |
| FR-07 | Show the day-over-day change (absolute value, percentage, and directional arrow ▲/▼) for each card. |
| FR-08 | Show the "As of \<date\>" label reflecting the most recent data date. |

### 2.2 Historical Data

| ID | Requirement |
|----|-------------|
| FR-09 | Support configurable time periods: **7 days**, **30 days** (default), **90 days**. |
| FR-10 | Fetch data for each calendar day in the selected period in parallel batches of 10 requests. |
| FR-11 | Silently skip days for which no data is available (e.g. weekends, public holidays). |

### 2.3 Currency Pairs

| ID | Requirement |
|----|-------------|
| FR-12 | Support selection of the following pairs for the chart and table: USD/UAH, UAH/USD, EUR/UAH, UAH/EUR, EUR/USD, USD/EUR, Bitcoin/USD, Gold/USD, Silver/USD. |
| FR-13 | Derived inverse pairs (UAH/USD, UAH/EUR, USD/EUR) must be computed client-side from NBU data. |

### 2.4 Chart View

| ID | Requirement |
|----|-------------|
| FR-14 | Render an interactive line chart for the selected pair and period using Chart.js v4. |
| FR-15 | Chart must be responsive and maintain proper aspect ratio. |
| FR-16 | Tooltip must show the exact rate value on hover. |
| FR-17 | Suppress individual data-point dots when the dataset exceeds 60 data points (show on hover only). |

### 2.5 Table View

| ID | Requirement |
|----|-------------|
| FR-18 | Display a scrollable table of date and rate values, sorted newest-first. |
| FR-19 | Omit rows where the selected pair's value is unavailable. |

### 2.6 View Toggle

| ID | Requirement |
|----|-------------|
| FR-20 | Allow the user to switch between **Chart only**, **Table only**, and **Both** views. |

### 2.7 CSV Export

| ID | Requirement |
|----|-------------|
| FR-21 | Export the currently displayed pair's historical data as a CSV file. |
| FR-22 | CSV filename must include the selected pair and current date (e.g. `exchange_rates_20260511.csv`). |
| FR-23 | CSV must contain a header row (`Date,<pair label>`) and one row per data point. |

### 2.8 Manual Refresh

| ID | Requirement |
|----|-------------|
| FR-24 | Provide a refresh button (⟳) that re-fetches all data for the current period. |

### 2.9 Error Handling

| ID | Requirement |
|----|-------------|
| FR-25 | Display a user-facing error message when data cannot be loaded. |
| FR-26 | Show a loading overlay/spinner while data is being fetched. |

---

## 3. Backend API Requirements

### 3.1 `GET /api/rates`

| ID | Requirement |
|----|-------------|
| BR-01 | Accept an optional `date` query parameter in `YYYYMMDD` format. |
| BR-02 | Validate `date` with a strict 8-digit regex; reject malformed values by omitting the parameter (returns today's rates). |
| BR-03 | Proxy the request to the NBU StatService JSON endpoint and return the response verbatim. |
| BR-04 | Return HTTP 502 with a JSON error body on upstream failure. |

### 3.2 `GET /api/btc-usd`

| ID | Requirement |
|----|-------------|
| BR-05 | Accept an optional `date` query parameter in `YYYYMMDD` format. |
| BR-06 | For a historical date, attempt to fetch Bitcoin/USD from CoinGecko historical API; fall back to CryptoCompare if unavailable. |
| BR-07 | For the current date or no date, attempt live price from CoinGecko, then Coinbase, then Kraken in order. |
| BR-08 | Return `{ "usd": <number> }` on success. |
| BR-09 | Return HTTP 404 if historical data is not available for the requested date. |
| BR-10 | Return HTTP 502 if all upstream sources fail. |

### 3.3 Static File Serving

| ID | Requirement |
|----|-------------|
| BR-11 | Serve all files under `public/` as static assets on the root path. |

---

## 4. External Data Sources

| Source | Purpose | Fallback |
|--------|---------|----------|
| NBU StatService (`bank.gov.ua`) | Fiat currency rates (USD, EUR, XAU, XAG) | None |
| CoinGecko | Bitcoin/USD (historical & live) | CryptoCompare (historical), Coinbase (live) |
| CryptoCompare | Bitcoin/USD historical fallback | — |
| Coinbase | Bitcoin/USD live fallback | Kraken |
| Kraken | Bitcoin/USD live fallback (3rd) | — |

---

## 5. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-01 | The server must start on `PORT` environment variable; default to port **3000**. |
| NFR-02 | All HTTPS requests from the server must use Node's built-in `https` module (no external HTTP libraries). |
| NFR-03 | The frontend must function as a single-page application with no page reloads. |
| NFR-04 | Numeric rates must be displayed to **4 decimal places**. |
| NFR-05 | The application must be containerisable via Docker with a multi-stage build. |
| NFR-06 | The Docker image must run as a non-root user (`app`). |
| NFR-07 | Production Docker image must be based on `node:20-alpine`. |
| NFR-08 | The API endpoints must sanitise and validate all query parameters before use. |

---

## 6. Technical Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 |
| Web framework | Express 4 |
| Frontend | Vanilla JavaScript (IIFE, strict mode) |
| Charting | Chart.js v4 (CDN) |
| Containerisation | Docker (multi-stage, Alpine) |
| Package manager | npm |

---

## 7. Deployment

- **Local:** `npm start` → `http://localhost:3000`
- **Docker:** multi-stage `Dockerfile` producing a minimal Alpine image, exposed on port 3000.
- **Environment variable:** `PORT` — overrides the default listen port.
- `NODE_ENV=production` is set inside the Docker image.
