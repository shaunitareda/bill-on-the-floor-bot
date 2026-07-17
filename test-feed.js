require('dotenv').config();

async function main() {
  const url = 'https://clerk.house.gov/Home/Feed';

  const response = await fetch(url);
  const text = await response.text();

  console.log(text.substring(0, 3000));
  process.exit(0);
}

main().catch(console.error);