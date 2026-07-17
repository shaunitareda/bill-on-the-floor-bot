require('dotenv').config();

async function main() {
  const url = 'https://clerk.house.gov/Home/Feed';
  const response = await fetch(url);
  const text = await response.text();

  const items = text.split('<item>').slice(1);

  const debateSignals = [
    /DEBATE\s*-\s*The House proceeded/i,
    /Considered under the provisions of rule/i,
    /Rule provides for consideration of/i,
    /Considered as unfinished business/i,
  ];

  const billPattern = /\bH\.?\s?R\.?\s?\d+\b|\bH\.?\s?Res\.?\s?\d+\b|\bS\.\s?\d+\b/g;

  items.forEach((item) => {
    const descMatch = item.match(/<description>([\s\S]*?)<\/description>/);
    const dateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

    if (!descMatch) return;
    const text = descMatch[1];

    const isDebateEvent = debateSignals.some((pattern) => pattern.test(text));

    if (isDebateEvent) {
      const bills = text.match(billPattern) || [];
      console.log('---');
      console.log('Date:', dateMatch ? dateMatch[1] : 'unknown');
      console.log('Bills:', [...new Set(bills)]);
      console.log('Text:', text);
    }
  });

  process.exit(0);
}

main().catch(console.error);