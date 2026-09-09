require('dotenv').config();
const { Bot } = require('@skyware/bot');

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'bill-on-the-floor-bot/1.0' },
  });

  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }

  return response.json();
}

async function resolveAtprotoService(identifier) {
  if (process.env.ATPROTO_SERVICE) {
    return process.env.ATPROTO_SERVICE.replace(/\/$/, '');
  }

  const did = identifier.startsWith('did:')
    ? identifier
    : (await fetchJson(
        `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(identifier)}`,
        'ATProto handle resolver'
      )).did;

  if (!did) throw new Error(`Could not resolve DID for ${identifier}`);

  let didDocument;
  if (did.startsWith('did:plc:')) {
    didDocument = await fetchJson(`https://plc.directory/${encodeURIComponent(did)}`, 'PLC directory');
  } else if (did.startsWith('did:web:')) {
    const host = did.slice('did:web:'.length).replace(/:/g, '/');
    didDocument = await fetchJson(`https://${host}/.well-known/did.json`, 'did:web document');
  } else {
    throw new Error(`Unsupported DID method: ${did}`);
  }

  const services = Array.isArray(didDocument.service) ? didDocument.service : [];
  const pds = services.find((service) =>
    service &&
    (service.id === '#atproto_pds' || service.type === 'AtprotoPersonalDataServer') &&
    typeof service.serviceEndpoint === 'string'
  );

  if (!pds) throw new Error(`No ATProto PDS service found for ${did}`);
  return pds.serviceEndpoint.replace(/\/$/, '');
}

async function main() {
  const identifier = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;

  if (!identifier || !password) {
    throw new Error('BLUESKY_HANDLE and BLUESKY_APP_PASSWORD are required');
  }

  const service = await resolveAtprotoService(identifier);
  console.log(`Using ATProto PDS: ${service}`);

  const bot = new Bot({ service });
  await bot.login({ identifier, password });

  await bot.post({
    text: 'Bill on the Floor is online. This is a test post — real congressional alerts coming soon.'
  });

  console.log('Posted successfully!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Test post failed:', err);
  process.exit(1);
});
