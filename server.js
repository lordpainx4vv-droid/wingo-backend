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
// WinGo API theke data anar function
// (Proxy diye — 403 bypass korar jonno)
// ============================================
async function fetchFromAPI(apiURL) {
  const targetURL = `${apiURL}?ts=${Date.now()}`;

  // Proxy 1: allorigins
  const proxyURL = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetURL)}`;

  try {
    const response = await axios.get(proxyURL, {
      headers: BROWSER_HEADERS,
      timeout: 15000
    });
    return response.data;
  } catch (error) {
    console.log(`Proxy failed: ${error.message}`);
    throw error;
  }
}

// ============================================
// WinGo API theke data ene Firestore e save
// ============================================
async function fetchAndSave(apiURL, collectionName, label) {
  try {
    let data = await fetchFromAPI(apiURL);

    // Jodi proxy string return kore (kabho kabho hoy)
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (e) {
        console.log(`[${label}] Failed to parse JSON`);
        return;
      }
    }

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
