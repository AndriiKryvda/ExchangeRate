(() => {
    'use strict';

    /* ── Configuration ──────────────────────────────── */
    const API_BASE = '/api/rates';
    const BTC_API_BASE = '/api/btc-usd';
    const PAIR_META = {
        USD_UAH: { label: 'USD / UAH', color: '#16a34a', bg: 'rgba(22,163,74,0.10)', precision: 4 },
        UAH_USD: { label: 'UAH / USD', color: '#dc2626', bg: 'rgba(220,38,38,0.10)', precision: 4 },
        EUR_UAH: { label: 'EUR / UAH', color: '#2563eb', bg: 'rgba(37,99,235,0.10)', precision: 4 },
        UAH_EUR: { label: 'UAH / EUR', color: '#7c3aed', bg: 'rgba(124,58,237,0.10)', precision: 4 },
        EUR_USD: { label: 'EUR / USD', color: '#d97706', bg: 'rgba(217,119,6,0.10)', precision: 4 },
        USD_EUR: { label: 'USD / EUR', color: '#0891b2', bg: 'rgba(8,145,178,0.10)', precision: 4 },
        BTC_USD: { label: 'Bitcoin / USD', color: '#ea580c', bg: 'rgba(234,88,12,0.10)', precision: 4 },
        XAU_USD: { label: 'Gold / USD', color: '#ca8a04', bg: 'rgba(202,138,4,0.10)', precision: 4 },
        XAG_USD: { label: 'Silver / USD', color: '#94a3b8', bg: 'rgba(148,163,184,0.10)', precision: 4 },
    };

    /* ── State ──────────────────────────────────────── */
    const state = {
        period: 30,
        view: 'chart',
        pair: 'USD_UAH',
        data: [],
        chart: null,
    };

    /* ── Shorthand ──────────────────────────────────── */
    const $ = (id) => document.getElementById(id);

    /* ── Bootstrap ──────────────────────────────────── */
    document.addEventListener('DOMContentLoaded', () => {
        bindEvents();
        loadData();
    });

    /* ── Event Binding ──────────────────────────────── */
    function bindEvents() {
        document.querySelectorAll('.period-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                setActiveButton('.period-btn', btn);
                state.period = Number(btn.dataset.period);
                loadData();
            });
        });

        document.querySelectorAll('.view-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                setActiveButton('.view-btn', btn);
                state.view = btn.dataset.view;
                applyView();
            });
        });

        $('pair-select').addEventListener('change', (e) => {
            state.pair = e.target.value;
            if (state.data.length) {
                renderChart();
                renderTable();
            }
        });

        $('refresh-btn').addEventListener('click', () => loadData());
        $('export-csv').addEventListener('click', exportCSV);
    }

    function setActiveButton(selector, active) {
        document.querySelectorAll(selector).forEach((b) => b.classList.remove('active'));
        active.classList.add('active');
    }

    /* ── Data Loading ───────────────────────────────── */
    async function loadData() {
        showLoading(true);
        showError(false);

        try {
            // Fetch all BTC data in a single bulk request
            const btcBulkResult = await fetchBtcBulkData();
            
            // Fetch NBU rates for each day
            const dates = generateDates(state.period);
            const results = [];
            const BATCH = 10;

            for (let i = 0; i < dates.length; i += BATCH) {
                const batch = dates.slice(i, i + BATCH);
                const batchResults = await Promise.all(batch.map(fetchDay));
                results.push(...batchResults);
            }

            state.data = results.filter(Boolean).sort((a, b) => a.date - b.date);

            // Merge BTC data into state.data
            mergeBtcData(btcBulkResult);

            if (state.data.length === 0) {
                showError(true, 'No exchange‑rate data available for the selected period.');
            } else {
                renderCards();
                renderChart();
                renderTable();
                applyView();
            }
        } catch (err) {
            console.error(err);
            showError(true, 'Failed to load exchange rates. Please try again later.');
        }

        showLoading(false);
    }

    async function fetchDay(date) {
        const ds = fmtAPI(date);

        // Fetch NBU rates
        const res = await fetch(`${API_BASE}?date=${ds}`);
        if (!res.ok) {
            return null;
        }

        const arr = await res.json();
        const usd = arr.find((r) => r.cc === 'USD');
        const eur = arr.find((r) => r.cc === 'EUR');
        const xau = arr.find((r) => r.cc === 'XAU');
        const xag = arr.find((r) => r.cc === 'XAG');

        if (!usd || !eur) return null;
        const result = {
            date,
            label: fmtDisplay(date),
            USD_UAH: usd.rate,
            UAH_USD: 1 / usd.rate,
            EUR_UAH: eur.rate,
            UAH_EUR: 1 / eur.rate,
            EUR_USD: eur.rate / usd.rate,
            USD_EUR: usd.rate / eur.rate,
        };
        if (xau) result.XAU_USD = xau.rate / usd.rate;
        if (xag) result.XAG_USD = xag.rate / usd.rate;
        return result;
    }

    /**
     * Fetch BTC data in bulk using market_chart endpoint.
     * Returns a map of date -> price for efficient merging.
     */
    async function fetchBtcBulkData() {
        try {
            const url = `/api/btc-bulk?days=${state.period}`;
            const res = await fetch(url);
            if (!res.ok) {
                console.warn(`[App] BTC bulk fetch failed: ${res.status}`);
                return {};
            }
            const data = await res.json();
            console.log(`[App] BTC bulk data received: ${Object.keys(data).length} dates, range: ${data.startDate || 'N/A'} to ${data.endDate || 'N/A'}`);
            console.log(`[App] BTC sample prices: ${JSON.stringify(Object.entries(data).slice(0, 5))}`);
            return data.prices || {};
        } catch (err) {
            console.warn(`[App] BTC bulk fetch error:`, err);
            return {};
        }
    }

    /**
     * Merge BTC prices into state.data by date.
     * BTC prices use ISO date keys (YYYY-MM-DD), state.data uses date objects.
     */
    function mergeBtcData(btcPrices) {
        if (!btcPrices || Object.keys(btcPrices).length === 0) return;
        
        console.log(`[App] Merging ${Object.keys(btcPrices).length} BTC prices into ${state.data.length} data points`);
        
        for (const entry of state.data) {
            // Convert to YYYY-MM-DD format for matching
            const isoKey = entry.date.toISOString().split('T')[0];
            
            if (btcPrices[isoKey] != null && btcPrices[isoKey] > 0) {
                entry.BTC_USD = btcPrices[isoKey];
                console.log(`[App]   ✓ Merged BTC $${btcPrices[isoKey].toFixed(2)} for ${entry.label} (${isoKey})`);
            }
        }
    }

    /* ── Rate Cards ─────────────────────────────────── */
    function renderCards() {
        const latest = state.data[state.data.length - 1];
        const prev = state.data.length > 1 ? state.data[state.data.length - 2] : null;

        fillCard('usd-uah', latest.USD_UAH, prev?.USD_UAH, 'USD_UAH');
        fillCard('eur-uah', latest.EUR_UAH, prev?.EUR_UAH, 'EUR_UAH');
        fillCard('eur-usd', latest.EUR_USD, prev?.EUR_USD, 'EUR_USD');
        if (latest.BTC_USD != null) fillCard('btc-usd', latest.BTC_USD, prev?.BTC_USD, 'BTC_USD');
        if (latest.XAU_USD != null) fillCard('xau-usd', latest.XAU_USD, prev?.XAU_USD, 'XAU_USD');
        if (latest.XAG_USD != null) fillCard('xag-usd', latest.XAG_USD, prev?.XAG_USD, 'XAG_USD');

        $('as-of-date').textContent = `As of ${latest.label}`;
    }

    function fillCard(prefix, value, prevValue, pair) {
        const precision = PAIR_META[pair]?.precision ?? 4;
        $(prefix + '-value').textContent = value.toFixed(precision);
        const el = $(prefix + '-change');
        if (prevValue != null) {
            const diff = value - prevValue;
            const pct = ((diff / prevValue) * 100).toFixed(2);
            const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '—';
            el.textContent = `${arrow} ${Math.abs(diff).toFixed(precision)}  (${Math.abs(pct)}%)`;
            el.className = 'change ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : '');
        } else {
            el.textContent = '';
        }
    }

    /* ── Chart ──────────────────────────────────────── */
    function renderChart() {
        const pair = state.pair;
        const meta = PAIR_META[pair];
        const precision = meta.precision ?? 4;
        const labels = state.data.map((d) => d.label);
        const values = state.data.map((d) => d[pair] ?? null);

        if (state.chart) state.chart.destroy();

        state.chart = new Chart($('rates-chart'), {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: meta.label,
                    data: values,
                    borderColor: meta.color,
                    backgroundColor: meta.bg,
                    tension: 0.3,
                    pointRadius: state.data.length > 60 ? 0 : 3,
                    pointHoverRadius: 5,
                    borderWidth: 2,
                    fill: true,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                if (ctx.parsed.y == null) return `${ctx.dataset.label}: N/A`;
                                return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(precision)}`;
                            },
                        },
                    },
                    legend: {
                        position: 'top',
                        labels: { usePointStyle: true, padding: 16, font: { size: 13 } },
                    },
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 15 },
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: meta.label, font: { weight: 'bold' } },
                        grid: { color: 'rgba(0,0,0,0.06)' },
                    },
                },
            },
        });
    }

    /* ── Table ──────────────────────────────────────── */
    function renderTable() {
        const pair = state.pair;
        const meta = PAIR_META[pair];
        const precision = meta.precision ?? 4;
        $('table-pair-header').textContent = meta.label;

        const tbody = $('rates-tbody');
        tbody.innerHTML = '';
        const sorted = [...state.data].reverse();
        for (const row of sorted) {
            if (row[pair] == null) continue;
            const tr = document.createElement('tr');
            tr.innerHTML =
                `<td>${row.label}</td>` +
                `<td>${row[pair].toFixed(precision)}</td>`;
            tbody.appendChild(tr);
        }
    }

    /* ── CSV Export ──────────────────────────────────── */
    function exportCSV() {
        if (!state.data.length) return;
        const meta = PAIR_META[state.pair];
        const precision = meta.precision ?? 4;
        const header = `Date,${meta.label}`;
        const rows = [...state.data].reverse().map(
            (r) => (r[state.pair] == null ? null : `${r.label},${r[state.pair].toFixed(precision)}`)
        ).filter(Boolean);
        const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `exchange_rates_${fmtAPI(new Date())}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    /* ── View Toggle ────────────────────────────────── */
    function applyView() {
        const v = state.view;
        $('chart-section').style.display = v === 'chart' || v === 'both' ? '' : 'none';
        $('table-section').style.display = v === 'table' || v === 'both' ? '' : 'none';
    }

    /* ── Helpers ─────────────────────────────────────── */
    function generateDates(days) {
        const arr = [];
        const now = new Date();
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            arr.push(d);
        }
        return arr;
    }

    function fmtAPI(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}${m}${day}`;
    }

    function fmtDisplay(d) {
        const day = String(d.getDate()).padStart(2, '0');
        const m = String(d.getMonth() + 1).padStart(2, '0');
        return `${day}.${m}.${d.getFullYear()}`;
    }

    function showLoading(show) {
        $('loading-overlay').style.display = show ? 'flex' : 'none';
    }

    function showError(show, msg) {
        const el = $('error-msg');
        el.style.display = show ? 'block' : 'none';
        if (msg) el.textContent = msg;
    }
})();
