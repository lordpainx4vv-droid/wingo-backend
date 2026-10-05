const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
const cors = require('cors');

// ============================================
// Firebase Init
// ============================================
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ============================================
// Express Setup
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
// Time Format
// ============================================
function formatTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}-${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getColor(num) {
  if ([1, 3, 7, 9].includes(num)) return 'green';
  if ([2, 4, 6, 8].includes(num)) return 'red';
  return 'violet';
}

function getSize(num) {
  return num >= 5 ? 'Big' : 'Small';
}

const lastSavedPeriod = {
  wingo_30s: null,
  wingo_1m: null
};

// ============================================
// Cloudflare Worker diye data ana
// ============================================
async function fetchFromAPI(apiURL) {
  const targetURL = `${apiURL}?ts=${Date.now()}`;
  const MY_PROXY_URL = 'https://wingo-proxy.TOMAR-NAME.workers.dev';
  const proxyURL = `${MY_PROXY_URL}/?url=${encodeURIComponent(targetURL)}`;

  const response = await axios.get(proxyURL, { timeout: 15000 });
  let data = response.data;
  if (typeof data === 'string') data = JSON.parse(data);
  return data;
}

async function fetchAndSave(apiURL, collectionName, label) {
  try {
    const data = await fetchFromAPI(apiURL);

    if (!data || !data.data || !Array.isArray(data.data.list)) {
      console.log(`[${label}] Invalid API response`);
      return;
    }

    const list = data.data.list;
    if (list.length === 0) return;

    const latest = list[0];
    const period = String(latest.issueNumber ?? '').trim();
    if (!period) return;

    if (lastSavedPeriod[collectionName] === period) return;

    const num = Number.parseInt(latest.number, 10);
    if (!Number.isInteger(num) || num < 0 || num > 9) return;

    const now = new Date();
    const record = {
      period,
      number: num,
      size: getSize(num),
      color: getColor(num),
      time: formatTime(now),
      fetchedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection(collectionName).doc(period).set(record);
    lastSavedPeriod[collectionName] = period;

    console.log(`[${label}] Saved ${period} | num=${num} | ${record.size} | ${record.color}`);
  } catch (error) {
    console.error(`[${label}] Error:`, error.message);
  }
}

// ============================================
// Auto Fetch - Every 4 Seconds
// ============================================
setInterval(() => {
  fetchAndSave(WINGO_30S_API, 'wingo_30s', '30S');
  fetchAndSave(WINGO_1M_API, 'wingo_1m', '1M');
}, 4000);

// ============================================
// HTML er jonno: Firestore theke data read
// ============================================
app.get('/api/history', async (req, res) => {
  try {
    const type = req.query.type;
    const collectionName = type === '1m' ? 'wingo_1m' : 'wingo_30s';

    const snapshot = await db.collection(collectionName)
      .orderBy('period', 'desc')
      .limit(10)
      .get();

    const list = snapshot.docs.map(doc => {
      const d = doc.data();
      return {
        issueNumber: d.period,
        number: d.number,
        size: d.size,
        color: d.color,
        time: d.time
      };
    });

    res.json({ success: true, data: { list } });
  } catch (error) {
    console.error('History API error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// Manual Trigger
// ============================================
app.get('/trigger', async (req, res) => {
  await fetchAndSave(WINGO_30S_API, 'wingo_30s', '30S');
  await fetchAndSave(WINGO_1M_API, 'wingo_1m', '1M');
  res.json({ success: true });
});

app.get('/', (req, res) => {
  res.json({ status: 'running', lastSaved: lastSavedPeriod });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  fetchAndSave(WINGO_30S_API, 'wingo_30s', '30S');
  fetchAndSave(WINGO_1M_API, 'wingo_1m', '1M');
});
