const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');

const DEDUPE_FILE = path.join(__dirname, 'senate-posted.json');

function loadPostedKeys() {
  if (!fs.existsSync(DEDUPE_FILE)) return new Set();
  try {
    const raw = fs.readFileSync(DEDUPE_FILE, 'utf8');
    const arr = JSON.parse(raw);
    return new Set(arr);
  } catch (err) {
    console.error('Failed to read dedupe file, starting fresh:', err.message);
    return new Set();
  }
}

function savePostedKeys(keysSet) {
  const arr = Array.from(keysSet);
  fs.writeFileSync(DEDUPE_FILE, JSON.stringify(arr, null, 2));
}

function makeActionKey(docnum, actionText) {
  const raw = `${docnum}::${actionText}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function getEasternDate(offsetDays = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  return new Date(etString);
}

function formatFilename(date) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${mm}_${dd}_${yyyy}_Senate_Floor.xml`;
}

async function fetchSenateFeed() {
  for (const offset of [0, -1, -2]) {
    const date = getEasternDate(offset);
    const filename = formatFilename(date);
    const url = `https://www.senate.gov/legislative/LIS/floor_activity/${filename}`;
    console.log('Trying:', url);
    const response = await fetch(url);
    if (response.ok) {
      const xml = await response.text();
      if (!xml.includes('file_not_found')) {
        console.log('Found valid feed:', filename);
        return xml;
      }
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
  if (resMatch) {
    return `https://www.congress.gov/bill/${congress}th-congress/senate-resolution/${resMatch[1]}`;
  }

  const jointResMatch = clean.match(/^S\.J\.Res\.?\s*(\d+)$/i);
  if (jointResMatch) {
    return `https://www.congress.gov/bill/${congress}th-congress/senate-joint-resolution/${jointResMatch[1]}`;
  }

  const billMatch = clean.match(/^S\.\s*(\d+)$/i);
  if (billMatch) {
    return `https://www.congress.gov/bill/${congress}th-congress/senate-bill/${billMatch[1]}`;
  }

  const nomMatch = clean.match(/^PN\s*(\d+)/i);
  if (nomMatch) {
    return `https://www.congress.gov/nomination/${congress}th-congress/${nomMatch[1]}`;
  }

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

function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1).trim() + '\u2026';
}

function utf8ByteLength(str) {
  return Buffer.byteLength(str, 'utf8');
}

function buildPostRecord(item) {
  const shortTitle = truncate(item.title.replace(/\s+/g, ' ').trim(), 180);
  const action = item.action.replace(/\s+/g, ' ').trim();

  const header = `${item.docnum}: ${shortTitle}`;
  const actionLine = `Action: ${action}`;

  const billLabel = 'Bill: ';
  const watchLabel = 'Watch: ';

  let text = `${header}\n\n${actionLine}\n\n${billLabel}${item.congressLink}\n${watchLabel}${item.cspanLink}`;

  if (utf8ByteLength(text) > 300) {
    const overBy = utf8ByteLength(text) - 300;
    const newTitleLen = Math.max(20, shortTitle.length - overBy - 5);
    const trimmedTitle = truncate(shortTitle, newTitleLen);
    text = `${item.docnum}: ${trimmedTitle}\n\n${actionLine}\n\n${billLabel}${item.congressLink}\n${watchLabel}${item.cspanLink}`;
  }

  const facets = [];
  const encoder = new TextEncoder();

  function findByteRange(label, url) {
    const idx = text.indexOf(label + url);
    if (idx === -1) return null;
    const startIdx = idx + label.length;
    const before = text.slice(0, startIdx);
    const byteStart = encoder.encode(before).length;
    const byteEnd = byteStart + encoder.encode(url).length;
    return { byteStart, byteEnd };
  }

  const billRange = findByteRange(billLabel, item.congressLink);
  if (billRange) {
    facets.push({
      index: { byteStart: billRange.byteStart, byteEnd: billRange.byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: item.congressLink }]
    });
  }

  const watchRange = findByteRange(watchLabel, item.cspanLink);
  if (watchRange) {
    facets.push({
      index: { byteStart: watchRange.byteStart, byteEnd: watchRange.byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: item.cspanLink }]
    });
  }

  return {
    text,
    facets,
    createdAt: new Date().toISOString(),
    byteLength: utf8ByteLength(text)
  };
}

async function main() {
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

  const postedKeys = loadPostedKeys();
  const newItemsToPost = [];

  for (const bill of allBills) {
    for (const actionText of bill.statusTexts) {
      const key = makeActionKey(bill.docnum, actionText);
      if (!postedKeys.has(key)) {
        newItemsToPost.push({
          docnum: bill.docnum,
          sponsor: bill.sponsor,
          title: bill.title,
          action: actionText,
          congressLink: bill.congressLink,
          cspanLink: bill.cspanLink,
          dedupeKey: key
        });
      }
    }
  }

  console.log(`Total actions in feed: ${allBills.reduce((sum, b) => sum + b.statusTexts.length, 0)}`);
  console.log(`New actions not yet posted: ${newItemsToPost.length}\n`);

  for (const item of newItemsToPost) {
    const post = buildPostRecord(item);
    console.log('---');
    console.log(post.text);
    console.log(`(${post.byteLength} bytes)`);
    console.log('Facets:', JSON.stringify(post.facets, null, 2));
  }

  for (const item of newItemsToPost) {
    postedKeys.add(item.dedupeKey);
  }
  savePostedKeys(postedKeys);

  console.log(`\nDedupe file updated: ${DEDUPE_FILE}`);
}

main().catch(console.error);
