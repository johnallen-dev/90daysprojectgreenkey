(function () {
  'use strict';

  // ── Page source: 'api' (index.html) or 'csv' (csv.html) ─────────────────────
  const PAGE_SOURCE = document.body.dataset.source || 'api';

  // ── Thresholds ──────────────────────────────────────────────────────────────
  const NIGHTS_THRESHOLD = 90;
  const ISK_THRESHOLD    = 2_000_000;
  const AMBER_RATIO      = 0.80;

  // ── Properties subject to 90-day regulation ─────────────────────────────────
  const TRACKED_90_DAYS = new Set([
    'Langholtsvegur 50',
    'Njálsgata 38',
    'Grenimelur 35',
    'Fagraþing 2B',
    'Hrefnugata 8',
    'Brúnavegur 10',
    'Kiðjaberg 66',
    'Brautarholt 20 - 210',
    'Kristnibraut 71',
    'Bergstaðastræti 50',
    'Strandvegur 13',
    'Njálsgata 32B',
    'Asparvík 16',
    'Framnesvegur 19',
    'Bríetartún 11 - 611',
    'Baldursgata 10',
    'Vesturgata 21b',
    'Ugluhólar 6',
    'Bjarnastaðir Sv.2 - 7',
    'Sambyggð 14',
    'Boðaþing 20',
    'Snorrabraut 33'
  ]);

  function is90Days(name) {
    const n = (name || '').trim().toLowerCase();
    return [...TRACKED_90_DAYS].some(t => t.toLowerCase() === n);
  }

  // ── App state ───────────────────────────────────────────────────────────────
  const state = {
    data:      null,
    sortCol:   'nights',
    sortAsc:   false,
    activeTab: 'cards',
    filter:    'all'
  };

  function filterProperties(properties) {
    if (state.filter === '90days')    return properties.filter(p =>  is90Days(p.name));
    if (state.filter === 'non90days') return properties.filter(p => !is90Days(p.name));
    return properties;
  }

  // ── Mock data (matches 2026 Uplisting report screenshot) ────────────────────
  const MOCK_PROPERTIES = [
    { name: 'Brautarholt 20 - 210',   bookings: 20, nights: 75, payout_eur: 8941.44  },
    { name: 'Kristnibraut 71',         bookings: 13, nights: 80, payout_eur: 11324.71 },
    { name: 'Bergstaðastræti 50',      bookings: 10, nights: 52, payout_eur: 16259.91 },
    { name: 'Njálsgata 38',            bookings:  8, nights: 35, payout_eur:  6923.98 },
    { name: 'Strandvegur 13',          bookings:  6, nights: 23, payout_eur:  3866.13 },
    { name: 'Framnesvegur 19',         bookings:  1, nights:  8, payout_eur:  3866.93 },
    { name: 'Ugluhólar 6',             bookings:  2, nights: 12, payout_eur:  3095.69 },
    { name: 'Baldursgata 10',          bookings:  1, nights:  6, payout_eur:  1234.54 },
    { name: 'Sambyggð 14',             bookings:  1, nights:  4, payout_eur:   650.27 },
    { name: 'Njálsgata 32B',           bookings:  0, nights:  0, payout_eur:      0   },
    { name: 'Ásparvik 16',             bookings:  0, nights:  0, payout_eur:      0   },
    { name: 'Brietartún 11 - 611',     bookings:  0, nights:  0, payout_eur:      0   },
    { name: 'Vesturgata 21b',          bookings:  0, nights:  0, payout_eur:      0   },
    { name: 'Bjarnastaðir Sv.2 - 7',  bookings:  0, nights:  0, payout_eur:      0   },
    { name: 'Boðaþing 20',            bookings:  0, nights:  0, payout_eur:      0   },
    { name: 'Snorrabraut 33',          bookings:  0, nights:  0, payout_eur:      0   }
  ];

  // ── Formatters ──────────────────────────────────────────────────────────────
  function fmtISK(n) {
    const abs = Math.abs(Math.round(n));
    return (n < 0 ? '-' : '') + 'kr' + abs.toLocaleString('en-US');
  }

  function fmtEUR(n) {
    if (!n && n !== 0) return '—';
    return '€' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtNights(n) {
    return n + ' night' + (n !== 1 ? 's' : '');
  }

  function fmtPct(ratio) {
    return Math.min(100, Math.round(ratio * 1000) / 10) + '%';
  }

  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  // ── Status ──────────────────────────────────────────────────────────────────
  function getStatus(p) {
    if (p.bookings === 0) return 'empty';
    const nr = p.nights      / NIGHTS_THRESHOLD;
    const ir = p.payout_isk  / ISK_THRESHOLD;
    if (nr >= 1 || ir >= 1)                          return 'red';
    if (nr >= AMBER_RATIO || ir >= AMBER_RATIO)      return 'amber';
    return 'green';
  }

  const STATUS_LABEL = {
    green: 'On Track',
    amber: 'Approaching',
    red:   'Limit Reached',
    empty: 'No bookings'
  };

  // ── CSV parsing ──────────────────────────────────────────────────────────────
  function parseCSVText(text) {
    const rows = [];
    let row = [], field = '', inQuote = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (inQuote && text[i + 1] === '"') { field += '"'; i++; }
        else inQuote = !inQuote;
      } else if (c === ',' && !inQuote) {
        row.push(field.trim()); field = '';
      } else if ((c === '\n' || c === '\r') && !inQuote) {
        if (c === '\r' && text[i + 1] === '\n') i++;
        if (row.length || field) { row.push(field.trim()); rows.push(row); }
        row = []; field = '';
      } else {
        field += c;
      }
    }
    if (field || row.length) { row.push(field.trim()); rows.push(row); }
    return rows;
  }

  function findColIndex(headers, ...terms) {
    for (const term of terms) {
      const idx = headers.findIndex(h => h.includes(term));
      if (idx !== -1) return idx;
    }
    return -1;
  }

  function aggregateCSV(rows) {
    if (rows.length < 2) return null;

    // Fixed Uplisting export columns (0-based)
    const iName    = 1;   // Column B — Property Name
    const iNights  = 16;  // Column Q — Number of Nights
    const iPayout  = 26;  // Column AA — Total Payout (ISK)

    // Status column position may vary — detect by header name
    const headers  = rows[0].map(h => h.toLowerCase().replace(/['"]/g, '').trim());
    const iStatus  = findColIndex(headers, 'status');

    const map = {};
    rows.slice(1).forEach(row => {
      if (!row[iName]) return;
      const status = iStatus >= 0 ? (row[iStatus] || '').toLowerCase() : '';
      if (status.includes('cancel')) return;

      const name       = row[iName].replace(/^"|"$/g, '').trim();
      const nights     = parseFloat(row[iNights]) || 0;
      const payout_eur = parseFloat((row[iPayout] || '').replace(/[^0-9.-]/g, '')) || 0;

      if (!map[name]) map[name] = { name, bookings: 0, nights: 0, payout_eur: 0 };
      map[name].bookings++;
      map[name].nights     += nights;
      map[name].payout_eur  = Math.round((map[name].payout_eur + payout_eur) * 100) / 100;
    });

    return Object.values(map);
  }

  // ── Enrich (used in demo mode — GAS does this server-side when live) ─────────
  function enrichProperties(properties, rate) {
    return properties.map(p => {
      const payout_isk = Math.round(p.payout_eur * rate);
      return {
        ...p,
        payout_isk,
        avg_per_night:    p.nights > 0 ? Math.round((p.payout_eur / p.nights) * 100) / 100 : 0,
        isk_variance:     ISK_THRESHOLD - payout_isk,
        nights_remaining: Math.max(0, NIGHTS_THRESHOLD - p.nights)
      };
    });
  }

  // ── Data loading ─────────────────────────────────────────────────────────────
  async function fetchFxRate() {
    const resp = await fetch('https://api.frankfurter.dev/latest?base=EUR&symbols=ISK');
    if (!resp.ok) throw new Error('FX fetch failed');
    const json = await resp.json();
    return { rate: json.rates.ISK, date: json.date };
  }

  async function loadData() {
    const fx   = await fetchFxRate().catch(() => ({ rate: 143.80, date: 'cached' }));
    const sort = arr => arr.sort((a, b) => {
      if (a.bookings === 0 && b.bookings > 0) return 1;
      if (a.bookings > 0 && b.bookings === 0) return -1;
      return b.nights - a.nights;
    });

    // ── CSV page ────────────────────────────────────────────────────────────
    if (PAGE_SOURCE === 'csv') {
      const csvJson = localStorage.getItem('csvData');
      if (!csvJson) return { rate: fx.rate, rateDate: fx.date,
        updatedAt: new Date().toISOString(), year: new Date().getFullYear(),
        noCsvData: true, properties: [] };
      const saved = JSON.parse(csvJson);
      return {
        rate: fx.rate, rateDate: fx.date,
        updatedAt: saved.uploadedAt,
        year: new Date().getFullYear(),
        usingCsvData: true, fileName: saved.fileName,
        properties: sort(enrichProperties(saved.rawProperties, fx.rate))
      };
    }

    // ── API page ────────────────────────────────────────────────────────────
    const gasUrl = localStorage.getItem('gasUrl');
    if (gasUrl) {
      const resp = await fetch(gasUrl);
      if (!resp.ok) throw new Error(`Server returned HTTP ${resp.status}`);
      return resp.json();
    }

    // Demo mode
    return {
      rate: fx.rate, rateDate: fx.date,
      updatedAt: new Date().toISOString(),
      year: new Date().getFullYear(),
      usingMockData: true,
      properties: sort(enrichProperties(MOCK_PROPERTIES, fx.rate))
    };
  }

  // ── Render: header ───────────────────────────────────────────────────────────
  function renderHeader(data) {
    document.getElementById('rateChip').textContent =
      'EUR / ISK  ' + data.rate.toFixed(2);
    document.getElementById('updatedAt').textContent =
      'Updated ' + fmtTime(data.updatedAt);

    const banner   = document.getElementById('demoBanner');
    const textEl   = document.getElementById('bannerText');
    const linkEl   = document.getElementById('openSettingsLink');
    if (data.usingMockData) {
      textEl.textContent = 'Demo mode — showing sample data. ';
      linkEl.textContent = 'Connect to Uplisting →';
      banner.classList.remove('hidden');
    } else if (data.usingCsvData) {
      textEl.textContent = (data.fileName ? data.fileName + ' uploaded. ' : 'Showing uploaded CSV data. ');
      linkEl.textContent = 'Update →';
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  // ── Render: summary stats ────────────────────────────────────────────────────
  function renderSummary(data, properties) {
    const { year } = data;
    const active  = properties.filter(p => p.bookings > 0).length;
    const amber   = properties.filter(p => getStatus(p) === 'amber').length;
    const red     = properties.filter(p => getStatus(p) === 'red').length;

    document.getElementById('summary').innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${properties.length}</div>
        <div class="stat-label">Total Properties</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${active}</div>
        <div class="stat-label">Active in ${year}</div>
      </div>
      <div class="stat-card stat-amber">
        <div class="stat-value">${amber}</div>
        <div class="stat-label">Approaching Limit</div>
      </div>
      <div class="stat-card stat-red">
        <div class="stat-value">${red}</div>
        <div class="stat-label">Limit Reached</div>
      </div>`;
  }

  // ── Render: progress bar ─────────────────────────────────────────────────────
  function progressBar(ratio, status) {
    const pct = Math.min(100, ratio * 100).toFixed(1);
    return `<div class="progress-track">
      <div class="progress-fill progress-fill--${status}" style="width:${pct}%"></div>
    </div>`;
  }

  // ── Render: single card ──────────────────────────────────────────────────────
  function renderCard(p) {
    const status      = getStatus(p);
    const isEmpty     = status === 'empty';
    const nightsRatio = p.nights     / NIGHTS_THRESHOLD;
    const iskRatio    = p.payout_isk / ISK_THRESHOLD;

    const barStatus = (r) => r >= 1 ? 'red' : r >= AMBER_RATIO ? 'amber' : 'green';

    return `<div class="prop-card${isEmpty ? ' prop-card--empty' : ''}">
      <div class="prop-card__header">
        <h3 class="prop-card__name">${p.name}</h3>
        <span class="badge badge--${status}">${STATUS_LABEL[status]}</span>
      </div>

      ${!isEmpty ? `
      <div class="prop-card__metrics">
        <div class="metric">
          <div class="metric__header">
            <span class="metric__label">ISK Revenue</span>
            <span class="metric__value">${fmtISK(p.payout_isk)}</span>
          </div>
          ${progressBar(iskRatio, barStatus(iskRatio))}
          <div class="metric__footer">
            <span>${fmtPct(iskRatio)} of 2,000,000 ISK</span>
            <span class="${p.isk_variance < 0 ? 'metric__remain--over' : ''}">
              ${p.isk_variance >= 0
                ? fmtISK(p.isk_variance) + ' left'
                : fmtISK(Math.abs(p.isk_variance)) + ' over limit'}
            </span>
          </div>
        </div>

        <div class="metric">
          <div class="metric__header">
            <span class="metric__label">Booked Nights</span>
            <span class="metric__value">${p.nights} / 90</span>
          </div>
          ${progressBar(nightsRatio, barStatus(nightsRatio))}
          <div class="metric__footer">
            <span>${fmtPct(nightsRatio)} of 90 nights</span>
            <span>${p.nights_remaining > 0
              ? p.nights_remaining + ' nights left'
              : '<span class="metric__remain--over">Limit reached</span>'}</span>
          </div>
        </div>
      </div>

      <div class="prop-card__footer">
        <span>${p.bookings} booking${p.bookings !== 1 ? 's' : ''}</span>
        <span>${p.avg_per_night > 0 ? fmtEUR(p.avg_per_night) + '/night avg' : ''}</span>
      </div>` : ''}
    </div>`;
  }

  // ── Render: cards view ───────────────────────────────────────────────────────
  function renderCards(properties) {
    document.getElementById('cardsView').innerHTML =
      properties.map(renderCard).join('');
  }

  // ── Render: table view ───────────────────────────────────────────────────────
  function renderTable(properties) {
    const withBookings = properties.filter(p => p.bookings > 0);
    const noBookings   = properties.filter(p => p.bookings === 0);

    withBookings.sort((a, b) => {
      let va = a[state.sortCol];
      let vb = b[state.sortCol];
      if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
      if (va < vb) return state.sortAsc ? -1 :  1;
      if (va > vb) return state.sortAsc ?  1 : -1;
      return 0;
    });

    const rows = [...withBookings, ...noBookings];

    const cols = [
      { key: 'name',            label: 'Property'   },
      { key: 'bookings',        label: 'Bookings'   },
      { key: 'payout_eur',      label: 'Total EUR'  },
      { key: 'avg_per_night',   label: 'Avg / Night'},
      { key: 'nights',          label: 'Nights'     },
      { key: 'payout_isk',      label: 'Total ISK'  },
      { key: 'isk_variance',    label: '→ 2M ISK'   },
      { key: 'nights_remaining',label: '→ 90 Days'  }
    ];

    const arrow = (key) => {
      if (state.sortCol !== key) return '';
      return state.sortAsc ? ' ↑' : ' ↓';
    };

    const thCols = cols.map(c =>
      `<th class="sortable${state.sortCol === c.key ? ' sort-active' : ''}" data-col="${c.key}">${c.label}${arrow(c.key)}</th>`
    ).join('') + '<th>Status</th>';

    const trRows = rows.map(p => {
      const status  = getStatus(p);
      const isEmpty = status === 'empty';
      return `<tr class="${isEmpty ? 'row--empty' : ''}">
        <td class="td-name">${p.name}</td>
        <td>${p.bookings || '—'}</td>
        <td>${p.payout_eur > 0 ? fmtEUR(p.payout_eur) : '—'}</td>
        <td>${p.avg_per_night > 0 ? fmtEUR(p.avg_per_night) : '—'}</td>
        <td>${p.nights || '—'}</td>
        <td>${p.payout_isk > 0 ? fmtISK(p.payout_isk) : '—'}</td>
        <td class="${!isEmpty && p.isk_variance < 0 ? 'td-over' : ''}">${p.payout_isk > 0 ? fmtISK(p.isk_variance) : '—'}</td>
        <td>${p.nights > 0 ? p.nights_remaining : '—'}</td>
        <td><span class="badge badge--${status}">${STATUS_LABEL[status]}</span></td>
      </tr>`;
    }).join('');

    const el = document.getElementById('tableView');
    el.innerHTML = `<div class="table-wrapper">
      <table class="data-table">
        <thead><tr>${thCols}</tr></thead>
        <tbody>${trRows}</tbody>
      </table>
    </div>`;

    el.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (state.sortCol === col) {
          state.sortAsc = !state.sortAsc;
        } else {
          state.sortCol = col;
          state.sortAsc = false;
        }
        renderTable(state.data.properties);
      });
    });
  }

  // ── Render: all ──────────────────────────────────────────────────────────────
  function renderAll(data) {
    state.data = data;
    renderHeader(data);
    const visible = filterProperties(data.properties);
    renderSummary(data, visible);
    renderCards(visible);
    renderTable(visible);
  }

  // ── Filter switching ─────────────────────────────────────────────────────────
  function switchFilter(filter) {
    state.filter = filter;
    document.querySelectorAll('.filter-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.filter === filter)
    );
    if (state.data) {
      const visible = filterProperties(state.data.properties);
      renderSummary(state.data, visible);
      renderCards(visible);
      renderTable(visible);
    }
  }

  // ── Tab switching ────────────────────────────────────────────────────────────
  function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === tab)
    );
    document.getElementById('cardsView').classList.toggle('hidden', tab !== 'cards');
    document.getElementById('tableView').classList.toggle('hidden', tab !== 'table');
  }

  // ── Settings modal ───────────────────────────────────────────────────────────
  function openSettings() {
    const gasInput = document.getElementById('gasUrlInput');
    if (gasInput) gasInput.value = localStorage.getItem('gasUrl') || '';
    const csvJson = localStorage.getItem('csvData');
    const fileNameEl = document.getElementById('csvFileName');
    const clearCsvEl = document.getElementById('clearCsv');
    if (fileNameEl) {
      if (csvJson) {
        const saved = JSON.parse(csvJson);
        fileNameEl.textContent = saved.fileName || 'file loaded';
        clearCsvEl?.classList.remove('hidden');
      } else {
        fileNameEl.textContent = 'No file chosen';
        clearCsvEl?.classList.add('hidden');
      }
    }
    document.getElementById('settingsModal').classList.remove('hidden');
  }

  function closeSettings() {
    document.getElementById('settingsModal').classList.add('hidden');
  }

  // ── Loading / error states ───────────────────────────────────────────────────
  function showLoading() {
    document.getElementById('refreshBtn').classList.add('spinning');
    document.getElementById('cardsView').innerHTML =
      '<div class="state-message">Loading data…</div>';
    document.getElementById('tableView').innerHTML = '';
  }

  function showError(msg) {
    document.getElementById('refreshBtn').classList.remove('spinning');
    document.getElementById('cardsView').innerHTML = `
      <div class="state-message state-message--error">
        Failed to load: ${msg}<br>
        <a href="#" id="errorSettingsLink">Check settings →</a>
      </div>`;
    document.getElementById('errorSettingsLink')?.addEventListener('click', e => {
      e.preventDefault();
      openSettings();
    });
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  async function init() {
    showLoading();
    try {
      const data = await loadData();
      if (data.noCsvData) {
        document.getElementById('refreshBtn').classList.remove('spinning');
        document.getElementById('cardsView').innerHTML =
          '<div class="state-message">No data uploaded yet.<br>' +
          '<a href="#" id="uploadPromptLink">Upload a CSV from Uplisting →</a></div>';
        document.getElementById('uploadPromptLink')
          ?.addEventListener('click', e => { e.preventDefault(); openSettings(); });
        document.getElementById('summary').innerHTML = '';
        return;
      }
      renderAll(data);
    } catch (e) {
      showError(e.message);
      return;
    }
    document.getElementById('refreshBtn').classList.remove('spinning');
  }

  // ── Wire up events ───────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    // Filter
    document.querySelectorAll('.filter-btn').forEach(btn =>
      btn.addEventListener('click', () => switchFilter(btn.dataset.filter))
    );

    // Tabs
    document.querySelectorAll('.tab').forEach(tab =>
      tab.addEventListener('click', () => switchTab(tab.dataset.tab))
    );

    // Refresh
    document.getElementById('refreshBtn').addEventListener('click', init);

    // Settings open
    document.getElementById('settingsBtn').addEventListener('click', openSettings);
    document.getElementById('openSettingsLink')?.addEventListener('click', e => {
      e.preventDefault();
      openSettings();
    });

    // Settings close
    document.getElementById('closeModal').addEventListener('click', closeSettings);
    document.getElementById('settingsModal').addEventListener('click', e => {
      if (e.target.id === 'settingsModal') closeSettings();
    });

    // Settings save (API page only)
    document.getElementById('saveSettings')?.addEventListener('click', () => {
      const url = document.getElementById('gasUrlInput').value.trim();
      if (url) {
        localStorage.setItem('gasUrl', url);
      } else {
        localStorage.removeItem('gasUrl');
      }
      closeSettings();
      init();
    });

    // Clear saved URL (API page only)
    document.getElementById('clearUrl')?.addEventListener('click', () => {
      if (confirm('Remove saved Apps Script URL and return to demo mode?')) {
        localStorage.removeItem('gasUrl');
        document.getElementById('gasUrlInput').value = '';
        closeSettings();
        init();
      }
    });

    // CSV upload (CSV page only)
    document.getElementById('csvFile')?.addEventListener('change', function (e) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function (evt) {
        const rows = parseCSVText(evt.target.result);
        const rawProperties = aggregateCSV(rows);
        if (!rawProperties) {
          alert('Could not find a "Property" column in this CSV. Please check the file.');
          return;
        }
        if (rawProperties.length === 0) {
          alert('No bookings found in this CSV.');
          return;
        }
        localStorage.removeItem('gasUrl');
        localStorage.setItem('csvData', JSON.stringify({
          rawProperties,
          uploadedAt: new Date().toISOString(),
          fileName: file.name
        }));
        closeSettings();
        init();
      };
      reader.readAsText(file);
    });

    // Clear CSV (CSV page only)
    document.getElementById('clearCsv')?.addEventListener('click', () => {
      localStorage.removeItem('csvData');
      document.getElementById('csvFileName').textContent = 'No file chosen';
      document.getElementById('clearCsv').classList.add('hidden');
      closeSettings();
      init();
    });

    init();
  });
})();
