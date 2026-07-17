require('dotenv').config();
const { Bot } = require('@skyware/bot');

async function main() {
  const bot = new Bot({
    service: 'https://blacksky.app',
  });

  await bot.login({
    identifier: process.env.BLUESKY_HANDLE,
    password: process.env.BLUESKY_APP_PASSWORD,
  });

  await bot.post({
    text: "Bill on the Floor is online. This is a test post — real congressional alerts coming soon."
  });

  console.log("Posted successfully!");
  process.exit(0);
}

main().catch(console.error);