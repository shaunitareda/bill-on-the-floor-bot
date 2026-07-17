require('dotenv').config();

async function main() {
  const congress = 119;
  const billType = 'hr';
  const billNumber = 1;

  const url = `https://api.congress.gov/v3/bill/${congress}/${billType}/${billNumber}/summaries?api_key=${process.env.CONGRESS_API_KEY}&format=json`;

  const response = await fetch(url);
  const data = await response.json();

  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}

main().catch(console.error);