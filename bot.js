require('dotenv').config();
const fs = require('fs');
const { Bot } = require('@skyware/bot');

const POSTED_FILE = './posted.json';

function loadPosted() {
  if (!fs.existsSync(POSTED_FILE)) return {};
  return JSON.parse(fs.readFileSync(POSTED_FILE, 'utf8'));
}

function savePosted(posted) {
  fs.writeFileSync(POSTED_FILE, JSON.stringify(posted, null, 2));
}

function normalizeBillId(raw) {
  const match = raw.match(/H\.?\s?R\.?\s?(\d+)/i);
  if (match) return { type: 'hr', number: match[1] };
  const resMatch = raw.match(/H\.?\s?Res\.?\s?(\d+)/i);
  if (resMatch) return { type: 'hres', number: resMatch[1] };
  const sMatch = raw.match(/^S\.\s?(\d+)/i);
  if (sMatch) return { type: 's', number: sMatch[1] };
  return null;
}

async function getFloorEvents() {
  const response = await fetch('https://clerk.house.gov/Home/Feed');
  const text = await response.text();
  const items = text.split('<item>').slice(1);

  const debateSignals = [
    /DEBATE\s*-\s*The House proceeded/i,
    /Considered under the provisions of rule/i,
    /Rule provides for consideration of/i,
    /Considered as unfinished business/i,
  ];

  const billPattern = /\bH\.?\s?R\.?\s?\d+\b|\bH\.?\s?Res\.?\s?\d+\b|\bS\.\s?\d+\b/g;

  const events = [];

  items.forEach((item) => {
    const descMatch = item.match(/<description>([\s\S]*?)<\/description>/);
    if (!descMatch) return;
    const desc = descMatch[1];

    const isDebateEvent = debateSignals.some((p) => p.test(desc));
    if (!isDebateEvent) return;

    const bills = [...new Set(desc.match(billPattern) || [])];
    bills.forEach((rawId) => {
      const normalized = normalizeBillId(rawId);
      if (normalized) events.push({ ...normalized, rawText: desc });
    });
  });

  return events;
}

async function getBillInfo(type, number) {
  const congress = 119;
  const url = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}?api_key=${process.env.CONGRESS_API_KEY}&format=json`;
  const response = await fetch(url);
  const data = await response.json();
  return data.bill;
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

async function main() {
  const posted = loadPosted();
  const events = await getFloorEvents();

  const bot = new Bot({ service: 'https://blacksky.app' });
  await bot.login({
    identifier: process.env.BLUESKY_HANDLE,
    password: process.env.BLUESKY_APP_PASSWORD,
  });

  for (const event of events) {
    const key = `${event.type}-${event.number}`;
    if (posted[key]) continue;

    let bill;
    try {
      bill = await getBillInfo(event.type, event.number);
    } catch (err) {
      console.error(`Failed to fetch bill ${key}:`, err.message);
      continue;
    }

    if (!bill) continue;

    const title = bill.title || 'Unknown title';
    const officialUrl = bill.legislationUrl || `https://www.congress.gov/bill/119th-congress/house-bill/${event.number}`;

    const postText = truncate(
      `Bill on the Floor: ${event.type.toUpperCase()} ${event.number}\n${title}\n\nRead: ${officialUrl}\nWatch: https://live.house.gov\nContact your rep: https://www.house.gov/representatives/find-your-representative`,
      300
    );

    await bot.post({ text: postText });
    console.log(`Posted ${key}`);

    posted[key] = { postedAt: new Date().toISOString() };
    savePosted(posted);
  }

  process.exit(0);
}

main().catch(console.error);