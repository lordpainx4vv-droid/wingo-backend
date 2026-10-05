const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
const cors = require('cors');

// ============================================
// Firebase Init (Environment variable theke)
// ============================================
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ============================================
// Express App Setup
// ============================================
const app = express();
app.use(cors());
app.use(express.json());

// ============================================
// WinGo API URLs
// ============================================
const WINGO_30S_API =
  'https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json';

const WINGO_1M_API =
  'https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json';

// ============================================
// Browser Headers
// ============================================
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://draw.ar-lottery01.com/',
  'Origin': 'https://draw.ar-lottery01.com',
  'Cache-Control': 'no-store'
};

// ============================================
// Multiple Proxy List (jekono ekta kaj korbe)
// ============================================
const PROXY_LIST = [
  // Proxy 1: corsproxy.io
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,

  // Proxy 2: codetabs
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,

  // Proxy 3: allorigins
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,

  // Proxy 4: thingproxy
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`
];

// ============================================
// Time Format Function
// Format: DD.MM.YYYY-HH:MM:SS
// ============================================
function formatTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const dd = pad(date.getDate());
  const mm = pad(date.getMonth() + 1);
  const yyyy = date.getFullYear();
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${dd}.${mm}.${yyyy}-${hh}:${mi}:${ss}`;
}

// ============================================
// Number theke Color ar Size ber kora
// ============================================
function getColor(num) {
  if ([1, 3, 7, 9].includes(num)) return 'green';
  if ([2, 4, 6, 8].includes(num)) return 'red';
  return 'violet';
}

function getSize(num) {
  return num >= 5 ? 'Big' : 'Small';
}

// ============================================
// Last saved period track korar jonno
// ============================================
const lastSavedPeriod = {
  wingo_30s: null,
  wingo_1m: null
};

// ============================================
// Ekta proxy try korar function
// ============================================
async function tryProxy(proxyFn, targetURL) {
  const proxyURL = proxyFn(targetURL);

  const response = await axios.get(proxyURL, {
    headers: BROWSER_HEADERS,
    timeout: 12000
  });

  let data = response.data;

  // Jodi string hoy, JSON parse koro
  if (typeof data === 'string') {
    data = JSON.parse(data);
  }

  return data;
}

// ============================================
// WinGo API theke data anar function
// (Multiple proxy try korbe — jeta age kaj korbe)
// ============================================
async function fetchFromAPI(apiURL) {
  const targetURL = `${apiURL}?ts=${Date.now()}`;

  let lastError = null;

  for (let i = 0; i < PROXY_LIST.length; i++) {
    try {
      console.log(`Trying proxy ${i + 1}...`);
      const data = await tryProxy(PROXY_LIST[i], targetURL);

      if (data && data.data && Array.isArray(data.data.list)) {
        console.log(`Proxy ${i + 1} worked!`);
        return data;
      } else {
        console.log(`Proxy ${i + 1} returned invalid data`);
      }
    } catch (err) {
      console.log(`Proxy ${i + 1} failed: ${err.message}`);
      lastError = err;
    }
  }

  throw lastError || new Error('All proxies failed');
}

// ============================================
// WinGo API theke data ene Firestore e save
// ============================================
async function fetchAndSave(apiURL, collectionName, label) {
  try {
    const data = await fetchFromAPI(apiURL);

    if (!data || !data.data || !Array.isArray(data.data.list)) {
      console.log(`[${label}] Invalid API response`);
      return;
    }

    const list = data.data.list;

    if (list.length === 0) {
      console.log(`[${label}] Empty list`);
      return;
    }

    const latest = list[0];
    const period = String(latest.issueNumber ?? '').trim();

    if (!period) {
      console.log(`[${label}] No period found`);
      return;
    }

    if (lastSavedPeriod[collectionName] === period) {
      return;
    }

    const num = Number.parseInt(latest.number, 10);

    if (!Number.isInteger(num) || num < 0 || num > 9) {
      console.log(`[${label}] Invalid number: ${latest.number}`);
      return;
    }

    const now = new Date();
    const record = {
      period: period,
      number: num,
      size: getSize(num),
      color: getColor(num),
      time: formatTime(now),
      fetchedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection(collectionName).doc(period).set(record);

    lastSavedPeriod[collectionName] = period;

    console.log(
      `[${label}] Saved period ${period} | num=${num} | ${record.size} | ${record.color} | ${record.time}`
    );
  } catch (error) {
    console.error(`[${label}] Error:`, error.message);
  }
}

// ============================================
// Auto Fetch Loop - Prottek 4 Second
// ============================================
setInterval(() => {
  fetchAndSave(WINGO_30S_API, 'wingo_30s', '30S');
  fetchAndSave(WINGO_1M_API, 'wingo_1m', '1M');
}, 4000);

// ============================================
// Manual Trigger (Test korar jonno)
// ============================================
app.get('/trigger', async (req, res) => {
  await fetchAndSave(WINGO_30S_API, 'wingo_30s', '30S');
  await fetchAndSave(WINGO_1M_API, 'wingo_1m', '1M');
  res.json({ success: true, message: 'Fetch triggered' });
});

// ============================================
// Health Check
// ============================================
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    lastSaved: lastSavedPeriod
  });
});

// ============================================
// Server Start
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Fetching every 4 seconds...`);

  fetchAndSave(WINGO_30S_API, 'wingo_30s', '30S');
  fetchAndSave(WINGO_1M_API, 'wingo_1m', '1M');
});
