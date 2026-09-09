# Bill on the Floor

A Node.js bot that monitors U.S. House and Senate floor activity and posts legislative updates to a Bluesky-compatible social network.

The project turns official congressional floor data into short, readable alerts with links back to the underlying legislation and congressional video coverage.

## What it does

### House

Bill on the Floor monitors the U.S. House floor feed for legislative activity, identifies relevant bills and resolutions, retrieves additional bill information from the Congress.gov API, and posts new activity while keeping local state to prevent duplicates.

### Senate

The Senate pipeline reads the Senate's daily floor-activity XML feed and:

- extracts legislation, nominations, and floor actions
- generates Congress.gov links
- links to congressional video coverage
- identifies common vote outcomes and pending actions
- creates compact social posts
- deduplicates previously processed actions

## Example output

A typical alert includes:

```text
S. 1234: Example legislation title

Action: Passed Senate with amendment.

Bill: [Congress.gov link]
Watch: [congressional video link]
```

Vote-related actions may also be labeled with statuses such as:

```text
PASSED
FAILED
AGREED TO
VOTE PENDING
```

## Data sources

The bot uses public congressional data including:

- U.S. House floor activity
- U.S. Senate daily floor activity
- Congress.gov API
- congressional video links

## Running the bot

Requires Node.js and a Congress.gov API key.

Install dependencies:

```bash
npm install
```

Copy the example environment configuration:

```bash
cp .env.example .env
```

Then provide:

```text
CONGRESS_API_KEY
BLUESKY_HANDLE
BLUESKY_APP_PASSWORD
```

Run both chambers:

```bash
npm run both
```

House only:

```bash
npm run house
```

Senate only:

```bash
npm run senate
```

## Runtime state

The bot maintains local state files so previously processed activity is not repeatedly posted.

Runtime state, credentials, dependencies, and logs are excluded from Git.

## Diagnostic scripts

The repository contains small diagnostic scripts used while developing individual pieces of the pipeline, including:

- House feed retrieval and parsing
- Congress.gov bill lookups
- Congress.gov summaries
- social posting
- Senate XML parsing

Some diagnostic scripts access live services. `test-post.js` creates an actual social post when supplied with valid credentials, so it should not be treated as an automated unit test.

## Built with

- Node.js
- `@skyware/bot`
- `fast-xml-parser`
- Congress.gov API
- U.S. House and Senate public floor data
- AT Protocol / Bluesky-compatible social networking

## Development

This project was built using an AI-assisted development workflow. AI is used as a development partner while I remain involved in product decisions, implementation direction, debugging, testing, deployment, and maintenance.

## Project status

Bill on the Floor is an experimental civic-tech project. It has working House and Senate data pipelines, but congressional source formats and third-party services can change and may require maintenance.

It is not an official U.S. government service.

## License

ISC
