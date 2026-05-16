# Exchange Rates App - Local Launch Guide

This app runs a small Node.js server that serves the frontend and proxies NBU API requests through `/api/rates`.

## Prerequisites

- Node.js 18+ (Node.js 20 recommended)
- npm (comes with Node.js)

Check your versions:

```powershell
node -v
npm -v
```

## 1) Install dependencies

From the project root:

```powershell
npm install
```

## 2) Start the app

```powershell
npm start
```

By default, it runs on port `3000`.

## 3) Open in browser

Open:

- http://localhost:3000

## Optional: Run on another port

PowerShell:

```powershell
$env:PORT=4000; npm start
```

Then open:

- http://localhost:4000

## Stop the app

In the terminal where the app is running, press `Ctrl + C`.

## Troubleshooting

- Port already in use:
  - Start on another port using the `PORT` environment variable.
- No data shown:
  - Check your internet connection (the app requests NBU data online).
  - Confirm the app is started with `npm start` (not a static file server).

## Note about `serve.ps1`

`serve.ps1` serves only static files from `public/` and does not provide the `/api/rates` proxy endpoint, so exchange-rate loading will not work fully with that script alone.

## Optional: Run with Docker

Build and run:

```powershell
docker build -t exchange-rates .
docker run --rm -p 3000:3000 exchange-rates
```

Open:

- http://localhost:3000
