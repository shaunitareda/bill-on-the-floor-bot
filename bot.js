require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Bot } = require('@skyware/bot');
const { XMLParser } = require('fast-xml-parser');

const POSTED_FILE = './posted.json';
const SENATE_DEDUPE_FILE = path.join(__dirname, 'senate-posted.json');

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
  return str.slice(0, max - 1) + '\u2026';
}

async function runHouse(bot, posted) {
  const events = await getFloorEvents();

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
    console.log(`Posted House ${key}`);

    posted[key] = { postedAt: new Date().toISOString() };
    savePosted(posted);
  }
}

function loadSenatePostedKeys() {
  if (!fs.existsSync(SENATE_DEDUPE_FILE)) return new Set();
  try {
    const raw = fs.readFileSync(SENATE_DEDUPE_FILE, 'utf8');
    return new Set(JSON.parse(raw));
  } catch (err) {
    console.error('Failed to read Senate dedupe file, starting fresh:', err.message);
    return new Set();
  }
}

function saveSenatePostedKeys(keysSet) {
  fs.writeFileSync(SENATE_DEDUPE_FILE, JSON.stringify(Array.from(keysSet), null, 2));
}

function makeActionKey(docnum, actionText) {
  return crypto.createHash('sha256').update(`${docnum}::${actionText}`).digest('hex');
}

function getEasternDate(offsetDays = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  return new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function formatSenateFilename(date) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${mm}_${dd}_${yyyy}_Senate_Floor.xml`;
}

async function fetchSenateFeed() {
  for (const offset of [0, -1, -2]) {
    const filename = formatSenateFilename(getEasternDate(offset));
    const url = `https://www.senate.gov/legislative/LIS/floor_activity/${filename}`;
    const response = await fetch(url);
    if (response.ok) {
      const xml = await response.text();
      if (!xml.includes('file_not_found')) return xml;
    }
  }
  return null;
}

function cleanText(val) {
  if (val == null) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'object') {
    if (val.__cdata) return val.__cdata.trim();
    if (val['#text'] !== undefined) {
      const voteNum = val.vote_number !== undefined ? ` ${val.vote_number}` : '';
      return `${val['#text'].trim()}${voteNum}`;
    }
    return '';
  }
  return String(val).trim();
}

function buildCongressLink(congress, docnum) {
  const clean = docnum.replace(/\s+/g, ' ').trim();

  const resMatch = clean.match(/^S\.Res\.?\s*(\d+)$/i);
  if (resMatch) return `https://www.congress.gov/bill/${congress}th-congress/senate-resolution/${resMatch[1]}`;

  const jointResMatch = clean.match(/^S\.J\.Res\.?\s*(\d+)$/i);
  if (jointResMatch) return `https://www.congress.gov/bill/${congress}th-congress/senate-joint-resolution/${jointResMatch[1]}`;

  const billMatch = clean.match(/^S\.\s*(\d+)$/i);
  if (billMatch) return `https://www.congress.gov/bill/${congress}th-congress/senate-bill/${billMatch[1]}`;

  const nomMatch = clean.match(/^PN\s*(\d+)/i);
  if (nomMatch) return `https://www.congress.gov/nomination/${congress}th-congress/${nomMatch[1]}`;

  return `https://www.congress.gov/search?q=${encodeURIComponent(clean)}`;
}

function buildCspanLink(dateIso) {
  return `https://www.c-span.org/congress/?chamber=senate&date=${dateIso}`;
}

function extractDocuments(sectionData) {
  if (!sectionData) return [];
  const docs = Array.isArray(sectionData.document) ? sectionData.document : [sectionData.document];
  return docs.filter(Boolean).map(doc => ({
    docnum: cleanText(doc.docnum),
    sponsor: cleanText(doc.sponsor_name),
    title: cleanText(doc.document_title),
    statusTexts: Array.isArray(doc.document_status_text)
      ? doc.document_status_text.map(cleanText)
      : doc.document_status_text
      ? [cleanText(doc.document_status_text)]
      : []
  }));
}

function getVoteTag(actionText) {
  const text = actionText.toLowerCase();

  const voteNumMatch = actionText.match(/(\d+)\s*-\s*(\d+)/);
  const tally = voteNumMatch ? ` (${voteNumMatch[1]}-${voteNumMatch[2]})` : '';

  const failedPatterns = [/rejected/, /not agreed to/, /failed/, /motion to table.*agreed to/, /cloture.*not invoked/];
  const passedPatterns = [
    /confirmed/, /agreed to/, /passed/, /cloture invoked/, /invoked in senate/,
    /adopted/, /discharged/
  ];
  const pendingPatterns = [
    /motion to proceed/, /cloture motion filed/, /considered by senate/,
    /submitted in the senate, considered/, /placed on/, /read the (first|second|third) time/
  ];

  if (failedPatterns.some(p => p.test(text))) {
    return `\u274c FAILED${tally}\n`;
  }
  if (/vote|cloture|yea-nay|roll call/i.test(text) && passedPatterns.some(p => p.test(text))) {
    return `\u2705 PASSED${tally}\n`;
  }
  if (passedPatterns.some(p => p.test(text)) && !tally) {
    return `\u2705 AGREED TO\n`;
  }
  if (pendingPatterns.some(p => p.test(text))) {
    return `\ud83d\uddf3\ufe0f VOTE PENDING\n`;
  }
  return '';
}

function graphemeLength(str) {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  return Array.from(segmenter.segment(str)).length;
}

function truncateGraphemes(str, maxLen) {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const graphemes = Array.from(segmenter.segment(str)).map(s => s.segment);
  if (graphemes.length <= maxLen) return str;
  return graphemes.slice(0, maxLen - 1).join('').trim() + '\u2026';
}

function buildSenatePostText(item) {
  let shortTitle = truncate(item.title.replace(/\s+/g, ' ').trim(), 180);
  let action = item.action.replace(/\s+/g, ' ').trim();
  const voteTag = getVoteTag(action);

  const fixedPart = `${voteTag}${item.docnum}: \n\nAction: \n\nBill: ${item.congressLink}\nWatch: ${item.cspanLink}`;
  const fixedLen = graphemeLength(fixedPart);
  let budget = 300 - fixedLen;

  if (budget < 10) budget = 10;

  let titleBudget = Math.floor(budget * 0.6);
  let actionBudget = budget - titleBudget;

  if (graphemeLength(shortTitle) > titleBudget) {
    shortTitle = truncateGraphemes(shortTitle, titleBudget);
  } else {
    actionBudget += titleBudget - graphemeLength(shortTitle);
  }

  if (graphemeLength(action) > actionBudget) {
    action = truncateGraphemes(action, actionBudget);
  }

  return `${voteTag}${item.docnum}: ${shortTitle}\n\nAction: ${action}\n\nBill: ${item.congressLink}\nWatch: ${item.cspanLink}`;
}

async function runSenate(bot) {
  const xml = await fetchSenateFeed();
  if (!xml) {
    console.log('No Senate floor feed available for today, yesterday, or the day before.');
    return;
  }

  const parser = new XMLParser({ cdataPropName: '__cdata' });
  const json = parser.parse(xml);
  const root = json.daily_senate_floor_activity;

  const congress = cleanText(root.congress);
  const dateIso = cleanText(root.date_iso_8601);
  const sections = Array.isArray(root.section) ? root.section : [root.section];

  let allBills = [];
  for (const section of sections) {
    if (section.document) {
      allBills = allBills.concat(extractDocuments(section));
    }
  }

  allBills = allBills.map(bill => ({
    ...bill,
    congressLink: buildCongressLink(congress, bill.docnum),
    cspanLink: buildCspanLink(dateIso)
  }));

  const postedKeys = loadSenatePostedKeys();

  for (const bill of allBills) {
    for (const actionText of bill.statusTexts) {
      const key = makeActionKey(bill.docnum, actionText);
      if (postedKeys.has(key)) continue;

      const item = {
        docnum: bill.docnum,
        title: bill.title,
        action: actionText,
        congressLink: bill.congressLink,
        cspanLink: bill.cspanLink
      };

      const postText = buildSenatePostText(item);

      await bot.post({ text: postText });
      console.log(`Posted Senate ${bill.docnum}`);

      postedKeys.add(key);
      saveSenatePostedKeys(postedKeys);
    }
  }
}

async function main() {
  const mode = process.argv[2] || 'both';

  const bot = new Bot({ service: 'https://blacksky.app' });
  await bot.login({
    identifier: process.env.BLUESKY_HANDLE,
    password: process.env.BLUESKY_APP_PASSWORD,
  });

  if (mode === 'house' || mode === 'both') {
    const posted = loadPosted();
    await runHouse(bot, posted);
  }

  if (mode === 'senate' || mode === 'both') {
    await runSenate(bot);
  }

  process.exit(0);
}

main().catch(console.error);
