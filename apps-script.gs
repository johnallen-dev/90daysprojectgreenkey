// ── Constants ──────────────────────────────────────────────────────────────────
const NIGHTS_THRESHOLD = 90;
const ISK_THRESHOLD = 2000000;

// ── Web App entry point ────────────────────────────────────────────────────────
function doGet() {
  try {
    const payload = buildResponse();
    return ContentService
      .createTextOutput(JSON.stringify(payload))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── Main response builder ──────────────────────────────────────────────────────
function buildResponse() {
  const props = PropertiesService.getScriptProperties();
  const uplistingKey = props.getProperty('UPLISTING_KEY');
  const usingMockData = !uplistingKey;

  const rawProperties = usingMockData
    ? getMockProperties()
    : fetchFromUplisting(uplistingKey);

  const fxData = fetchFxRate();
  const rate = fxData.rate;

  const properties = rawProperties
    .map(p => enrichProperty(p, rate))
    .sort((a, b) => {
      if (a.bookings === 0 && b.bookings > 0) return 1;
      if (a.bookings > 0 && b.bookings === 0) return -1;
      return b.nights - a.nights;
    });

  return {
    rate,
    rateDate: fxData.date,
    updatedAt: new Date().toISOString(),
    year: new Date().getFullYear(),
    usingMockData,
    properties
  };
}

// ── Property enrichment ────────────────────────────────────────────────────────
function enrichProperty(p, rate) {
  const payout_isk = Math.round(p.payout_eur * rate);
  const avg_per_night = p.nights > 0
    ? Math.round((p.payout_eur / p.nights) * 100) / 100
    : 0;
  return {
    name: p.name,
    bookings: p.bookings,
    nights: p.nights,
    payout_eur: Math.round(p.payout_eur * 100) / 100,
    avg_per_night,
    payout_isk,
    isk_variance: ISK_THRESHOLD - payout_isk,
    nights_remaining: Math.max(0, NIGHTS_THRESHOLD - p.nights)
  };
}

// ── Frankfurter FX rate ────────────────────────────────────────────────────────
function fetchFxRate() {
  try {
    const resp = UrlFetchApp.fetch(
      'https://api.frankfurter.dev/latest?base=EUR&symbols=ISK',
      { muteHttpExceptions: true }
    );
    if (resp.getResponseCode() === 200) {
      const json = JSON.parse(resp.getContentText());
      return { rate: json.rates.ISK, date: json.date };
    }
  } catch (e) {}
  return { rate: 143.80, date: 'fallback' };
}

// ── Uplisting API ──────────────────────────────────────────────────────────────
function fetchFromUplisting(apiKey) {
  const baseUrl = 'https://connect.uplisting.io';
  // Auth: Basic base64(apiKey) — no colon, no email
  const auth    = 'Basic ' + Utilities.base64Encode(apiKey);
  const headers = { Authorization: auth };
  const year    = new Date().getFullYear();
  const from    = year + '-01-01';
  const to      = year + '-12-31';

  // Step 1: fetch all listings (per_page=100 required — default is 4)
  const propsResp = UrlFetchApp.fetch(baseUrl + '/properties?per_page=100',
    { headers, muteHttpExceptions: true });
  if (propsResp.getResponseCode() !== 200)
    throw new Error('Properties fetch failed: HTTP ' + propsResp.getResponseCode());

  // Properties use JSON:API format: { data: [{ id, attributes: { name } }] }
  const propsBody = JSON.parse(propsResp.getContentText());
  const listings  = Array.isArray(propsBody) ? propsBody : (propsBody.data || []);

  // Step 2: seed map with all listings at 0 so properties with no bookings still appear
  const map = {};
  listings.forEach(function(listing) {
    const name = (listing.attributes && (listing.attributes.nickname || listing.attributes.name)) || listing.name || 'Unknown';
    map[name] = { name, bookings: 0, nights: 0, payout_eur: 0 };
  });

  // Step 3: fetch bookings per listing — omit page/per_page (causes empty results)
  listings.forEach(function(listing) {
    const listingId = listing.id;
    const name      = (listing.attributes && (listing.attributes.nickname || listing.attributes.name)) || listing.name || 'Unknown';

    const bResp = UrlFetchApp.fetch(
      baseUrl + '/bookings/' + listingId + '?from=' + from + '&to=' + to,
      { headers, muteHttpExceptions: true }
    );
    if (bResp.getResponseCode() !== 200) return;

    const bBody    = JSON.parse(bResp.getContentText());
    const bookings = Array.isArray(bBody)
      ? bBody
      : (bBody.bookings || bBody.data || []);

    bookings.forEach(function(b) {
      const status = (b.status || '').toLowerCase();
      if (status === 'cancelled' || status === 'canceled') return;

      // Only count bookings where check-in is in the current year
      const checkIn = (b.check_in || '').substring(0, 4);
      if (checkIn && checkIn !== String(year)) return;

      map[name].bookings++;
      map[name].nights     += Number(b.number_of_nights || b.nights || 0);
      map[name].payout_eur += Number(b.host_payout || b.payout || b.total_payout || 0);
    });
  });

  return Object.values(map);
}

// ── Debug helper — run this from the GAS editor to inspect the raw API response ─
function debugUplisting() {
  const props   = PropertiesService.getScriptProperties();
  const apiKey  = props.getProperty('UPLISTING_KEY');
  if (!apiKey) { Logger.log('No UPLISTING_KEY set'); return; }

  const baseUrl = 'https://connect.uplisting.io';
  const auth    = 'Basic ' + Utilities.base64Encode(apiKey);
  const headers = { Authorization: auth };

  // Test 1: properties list
  const propsResp = UrlFetchApp.fetch(baseUrl + '/properties?per_page=100',
    { headers, muteHttpExceptions: true });
  Logger.log('Properties HTTP: ' + propsResp.getResponseCode());
  Logger.log('Properties body: ' + propsResp.getContentText().substring(0, 800));

  if (propsResp.getResponseCode() !== 200) return;

  // Test 2: bookings for the first listing
  const propsJson = JSON.parse(propsResp.getContentText());
  const first     = Array.isArray(propsJson) ? propsJson[0] : (propsJson.data || [])[0];
  if (!first) { Logger.log('No listings returned'); return; }

  const year = new Date().getFullYear();
  const bUrl = baseUrl + '/bookings/' + first.id + '?from=' + year + '-01-01&to='
    + Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
  Logger.log('Bookings URL: ' + bUrl);
  const bResp = UrlFetchApp.fetch(bUrl, { headers, muteHttpExceptions: true });
  Logger.log('Bookings HTTP: ' + bResp.getResponseCode());
  const bJson     = JSON.parse(bResp.getContentText());
  const bList     = Array.isArray(bJson) ? bJson : (bJson.bookings || bJson.data || []);
  if (bList.length > 0) {
    Logger.log('Booking field names: ' + Object.keys(bList[0]).join(', '));
    Logger.log('First booking values: ' + JSON.stringify(bList[0], null, 2).substring(0, 1500));
  } else {
    Logger.log('No bookings returned');
  }
}

// ── Debug: list all property nicknames from Uplisting ─────────────────────────
function debugListProperties() {
  const props  = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('UPLISTING_KEY');
  if (!apiKey) { Logger.log('No UPLISTING_KEY set'); return; }

  const resp = UrlFetchApp.fetch('https://connect.uplisting.io/properties?per_page=100',
    { headers: { Authorization: 'Basic ' + Utilities.base64Encode(apiKey) }, muteHttpExceptions: true });

  Logger.log('HTTP: ' + resp.getResponseCode());
  const body     = JSON.parse(resp.getContentText());
  const listings = Array.isArray(body) ? body : (body.data || []);
  listings.forEach(function(l, i) {
    const nickname = l.attributes && l.attributes.nickname;
    const name     = l.attributes && l.attributes.name;
    Logger.log((i + 1) + '. id=' + l.id + '  nickname="' + nickname + '"  name="' + name + '"');
  });
}

// ── Notifications ─────────────────────────────────────────────────────────────
//
// Set up a time-based trigger:
//   GAS editor → Triggers (clock icon) → Add Trigger
//   Function: checkAndNotify | Event: Time-driven | Type: Day timer | Time: 8am–9am
//
// Optional: add script property NOTIFY_EMAIL to override the recipient.
// Each alert fires only once per threshold crossing; resets automatically each year.

function checkAndNotify() {
  const scriptProps  = PropertiesService.getScriptProperties();
  const uplistingKey = scriptProps.getProperty('UPLISTING_KEY');
  const notifyEmail  = scriptProps.getProperty('NOTIFY_EMAIL') || Session.getActiveUser().getEmail();

  const rawProperties = uplistingKey ? fetchFromUplisting(uplistingKey) : getMockProperties();
  const fxData        = fetchFxRate();
  const properties    = rawProperties.map(function(p) { return enrichProperty(p, fxData.rate); });

  // Load per-year notified state — auto-resets each January
  const currentYear = new Date().getFullYear();
  const stateJson   = scriptProps.getProperty('NOTIFIED_STATE') || '{}';
  const state       = JSON.parse(stateJson);
  if (state._year !== currentYear) {
    var keys = Object.keys(state);
    for (var i = 0; i < keys.length; i++) delete state[keys[i]];
    state._year = currentYear;
  }

  const AMBER_RATIO = 0.80;
  const limitAlerts = [];
  const amberAlerts = [];

  properties.forEach(function(p) {
    if (p.bookings === 0) return;
    const nightsRatio = p.nights      / NIGHTS_THRESHOLD;
    const iskRatio    = p.payout_isk  / ISK_THRESHOLD;
    const nightsPct   = Math.round(nightsRatio * 100) + '%';
    const iskPct      = Math.round(iskRatio    * 100) + '%';

    // Nights — limit
    if (nightsRatio >= 1 && !state[p.name + '_nights_limit']) {
      state[p.name + '_nights_limit'] = true;
      limitAlerts.push({ name: p.name, metric: 'Nights', value: p.nights + ' / 90 nights', pct: nightsPct });
    // Nights — approaching (only if not already at limit)
    } else if (nightsRatio >= AMBER_RATIO && !state[p.name + '_nights_amber'] && !state[p.name + '_nights_limit']) {
      state[p.name + '_nights_amber'] = true;
      amberAlerts.push({ name: p.name, metric: 'Nights', value: p.nights + ' / 90 nights', pct: nightsPct });
    }

    // ISK — limit
    if (iskRatio >= 1 && !state[p.name + '_isk_limit']) {
      state[p.name + '_isk_limit'] = true;
      limitAlerts.push({ name: p.name, metric: 'ISK Revenue', value: 'kr' + p.payout_isk.toLocaleString() + ' / 2,000,000', pct: iskPct });
    // ISK — approaching
    } else if (iskRatio >= AMBER_RATIO && !state[p.name + '_isk_amber'] && !state[p.name + '_isk_limit']) {
      state[p.name + '_isk_amber'] = true;
      amberAlerts.push({ name: p.name, metric: 'ISK Revenue', value: 'kr' + p.payout_isk.toLocaleString() + ' / 2,000,000', pct: iskPct });
    }
  });

  if (limitAlerts.length === 0 && amberAlerts.length === 0) return;

  scriptProps.setProperty('NOTIFIED_STATE', JSON.stringify(state));
  sendAlertEmail(notifyEmail, limitAlerts, amberAlerts);
}

function sendAlertEmail(to, limitAlerts, amberAlerts) {
  const subject = limitAlerts.length > 0
    ? 'Limit Reached — 90 Days / 2M ISK [GreenKey]'
    : 'Approaching Limit — 90 Days / 2M ISK [GreenKey]';

  function buildRows(alerts, bgColor, textColor, label) {
    return alerts.map(function(a) {
      return '<tr>'
        + '<td style="padding:10px 16px;border-bottom:1px solid #e2e8f0;font-weight:500">' + a.name + '</td>'
        + '<td style="padding:10px 16px;border-bottom:1px solid #e2e8f0;color:#64748b">' + a.metric + '</td>'
        + '<td style="padding:10px 16px;border-bottom:1px solid #e2e8f0">' + a.value + '</td>'
        + '<td style="padding:10px 16px;border-bottom:1px solid #e2e8f0">'
        + '<span style="background:' + bgColor + ';color:' + textColor + ';padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600">'
        + label + ' · ' + a.pct + '</span></td>'
        + '</tr>';
    }).join('');
  }

  function buildTable(rows) {
    if (!rows) return '';
    return '<table style="width:100%;border-collapse:collapse;font-size:14px">'
      + '<thead><tr style="background:#f8fafc">'
      + ['Property','Metric','Value','Status'].map(function(h) {
          return '<th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#64748b;border-bottom:2px solid #e2e8f0">' + h + '</th>';
        }).join('')
      + '</tr></thead>'
      + '<tbody>' + rows + '</tbody>'
      + '</table>';
  }

  var limitSection = '';
  if (limitAlerts.length > 0) {
    limitSection = '<h3 style="margin:24px 0 10px;font-size:14px;font-weight:600;color:#991b1b">Limit Reached</h3>'
      + buildTable(buildRows(limitAlerts, '#fef2f2', '#991b1b', 'Limit Reached'));
  }

  var amberSection = '';
  if (amberAlerts.length > 0) {
    amberSection = '<h3 style="margin:24px 0 10px;font-size:14px;font-weight:600;color:#92400e">Approaching Limit</h3>'
      + buildTable(buildRows(amberAlerts, '#fffbeb', '#92400e', 'Approaching'));
  }

  var html = '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Inter\',sans-serif;max-width:680px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">'
    + '<div style="background:#0f172a;padding:20px 24px">'
    + '<div style="color:#fff;font-size:18px;font-weight:700">90 Days · GreenKey</div>'
    + '<div style="color:#94a3b8;font-size:13px;margin-top:4px">Property threshold alert</div>'
    + '</div>'
    + '<div style="padding:24px">'
    + limitSection
    + amberSection
    + '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8">'
    + 'Each alert is sent only once per threshold crossing. State resets automatically each January.'
    + '</div>'
    + '</div>'
    + '</div>';

  MailApp.sendEmail({ to: to, subject: subject, htmlBody: html });
}

// Run from the editor to test immediately (sends a real email if thresholds are met)
function testCheckAndNotify() {
  resetNotifications();
  checkAndNotify();
  Logger.log('Done. Check your inbox.');
}

// Run from the editor to clear notification state (e.g. after testing)
function resetNotifications() {
  PropertiesService.getScriptProperties().deleteProperty('NOTIFIED_STATE');
  Logger.log('Notification state cleared.');
}

// ── Mock data (matches 2026 screenshot) ───────────────────────────────────────
function getMockProperties() {
  return [
    { name: 'Brautarholt 20 - 210',    bookings: 20, nights: 75, payout_eur: 8941.44  },
    { name: 'Kristnibraut 71',          bookings: 13, nights: 80, payout_eur: 11324.71 },
    { name: 'Bergstaðastræti 50',       bookings: 10, nights: 52, payout_eur: 16259.91 },
    { name: 'Njálsgata 38',             bookings:  8, nights: 35, payout_eur:  6923.98 },
    { name: 'Strandvegur 13',           bookings:  6, nights: 23, payout_eur:  3866.13 },
    { name: 'Framnesvegur 19',          bookings:  1, nights:  8, payout_eur:  3866.93 },
    { name: 'Ugluhólar 6',              bookings:  2, nights: 12, payout_eur:  3095.69 },
    { name: 'Baldursgata 10',           bookings:  1, nights:  6, payout_eur:  1234.54 },
    { name: 'Sambyggð 14',              bookings:  1, nights:  4, payout_eur:   650.27 },
    { name: 'Njálsgata 32B',            bookings:  0, nights:  0, payout_eur:      0   },
    { name: 'Ásparvik 16',              bookings:  0, nights:  0, payout_eur:      0   },
    { name: 'Brietartún 11 - 611',      bookings:  0, nights:  0, payout_eur:      0   },
    { name: 'Vesturgata 21b',           bookings:  0, nights:  0, payout_eur:      0   },
    { name: 'Bjarnastaðir Sv.2 - 7',   bookings:  0, nights:  0, payout_eur:      0   },
    { name: 'Boðaþing 20',             bookings:  0, nights:  0, payout_eur:      0   },
    { name: 'Snorrabraut 33',           bookings:  0, nights:  0, payout_eur:      0   }
  ];
}
