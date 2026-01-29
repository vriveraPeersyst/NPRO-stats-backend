# NPRO Stats Backend

Production-ready backend for the **NPRO Stats Dashboard** - analytics and monitoring for the NEAR Mobile token ecosystem.

## Features

- **Token Pricing**: Real-time NPRO and NEAR prices from CoinGecko
- **Liquidity Analytics**: DEX data from DexScreener (Rhea Finance)
- **Validator Stats**: NEAR staking pool metrics via RPC
- **Account Tracking**: Treasury, team, marketing, staking, liquidity balances
- **Premium Indexer**: Track Ambassador and Premium subscription counts
- **NearBlocks Integration**: Holder counts, transfer counts
- **Historical Snapshots**: 24h delta calculations for all metrics

## Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **Framework**: Fastify
- **Database**: PostgreSQL + Prisma ORM
- **Blockchain**: near-api-js for NEAR RPC
- **Config**: Zod for environment validation

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL database
- NearBlocks API key(s)
- (Optional) CoinGecko Pro API key

### Local Development

1. **Clone and install dependencies**:

```bash
git clone <repository-url>
cd npro-stats-backend
npm install
```

2. **Configure environment**:

```bash
cp .env.example .env
# Edit .env with your configuration
```

3. **Setup database**:

```bash
# Create PostgreSQL database
createdb npro_stats

# Run migrations
npm run prisma:migrate:dev
```

4. **Start development server**:

```bash
npm run dev
```

5. **Run initial sync** (in another terminal):

```bash
# Run fast sync to populate initial data
npm run sync:fast

# Run slow sync for premium indexer
npm run sync:slow
```

6. **Test the API**:

```bash
# Health check
curl http://localhost:8787/health

# Get full dashboard data
curl http://localhost:8787/v1/npro/summary
```

## API Endpoints

### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check - returns database status |
| GET | `/v1/npro/summary` | Full NPRO dashboard data in one response |

### Admin Endpoints (Protected)

All admin endpoints require the `x-sync-secret` header matching `SYNC_SECRET` env var.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/sync/fast` | Manually trigger fast sync |
| POST | `/admin/sync/slow` | Manually trigger slow sync |
| GET | `/admin/rpc/status` | Get NEAR RPC endpoint status |

## Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/npro_stats` |
| `SYNC_SECRET` | Secret for admin endpoints (min 16 chars) | `your-secure-secret-here` |
| `NEAR_RPC_URLS` | Comma-separated NEAR RPC endpoints | `https://near.lava.build,https://rpc.mainnet.near.org` |
| `NEARBLOCKS_API_KEYS` | Comma-separated NearBlocks API keys | `key1,key2,key3` |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8787` | Server port |
| `NODE_ENV` | `development` | Environment mode |
| `LOG_LEVEL` | `info` | Logging level |
| `COINGECKO_API_KEY` | - | CoinGecko Pro API key |
| `NEARBLOCKS_BASE` | `https://api.nearblocks.io` | NearBlocks API base URL |
| `NEARBLOCKS_API_HEADER` | `Authorization` | Header name for API key |
| `NEARBLOCKS_API_PREFIX` | `Bearer ` | Prefix for API key value |
| `POLL_INTERVAL_MS` | `15000` | Delay between NearBlocks requests |
| `PAGE_LIMIT` | `100` | Page size for paginated requests |
| `NEARBLOCKS_KEY_COOLDOWN_MS` | `180000` | Cooldown after 429 (3 min) |
| `NEARBLOCKS_TIMEOUT_MS` | `10000` | Request timeout |
| `NEARBLOCKS_MAX_RETRIES` | `3` | Max retry attempts |
| `NEARBLOCKS_MAX_PAGES_PER_RUN` | `20` | Max pages per sync run |

## Railway Deployment

### Step 1: Create Railway Project

1. Go to [Railway](https://railway.app) and create a new project
2. Connect your GitHub repository

### Step 2: Add PostgreSQL Database

1. Click **"Add New Service"** → **"Database"** → **"PostgreSQL"**
2. Railway will automatically provision the database and set `DATABASE_URL`

### Step 3: Deploy Web Service

1. Click **"Add New Service"** → **"GitHub Repo"**
2. Select your repository
3. Configure the service:

**Settings:**
- **Name**: `npro-stats-api`
- **Build Command**: `npm ci && npm run build`
- **Start Command**: `npm run prisma:migrate:deploy && npm run start`

**Variables:**
```
PORT=8787
NODE_ENV=production
LOG_LEVEL=info
SYNC_SECRET=<generate-secure-secret>
NEAR_RPC_URLS=https://near.lava.build,https://rpc.mainnet.near.org,https://near.blockpi.network/v1/rpc/public,https://rpc.shitzuapes.xyz
NEARBLOCKS_API_KEYS=<your-nearblocks-keys>
NEARBLOCKS_API_HEADER=Authorization
NEARBLOCKS_API_PREFIX=Bearer 
```

### Step 4: Create Fast Sync Cron Job

1. Click **"Add New Service"** → **"GitHub Repo"** (same repo)
2. Configure:

**Settings:**
- **Name**: `cron-fast`
- **Build Command**: `npm ci && npm run build`
- **Start Command**: `npm run prisma:migrate:deploy && npm run sync:fast`

**Cron Schedule:**
- Go to **Settings** → **Cron**
- Set schedule: `*/5 * * * *` (every 5 minutes)

**Variables:** (same as web service, reference from web service)

### Step 5: Create Slow Sync Cron Job

1. Click **"Add New Service"** → **"GitHub Repo"** (same repo)
2. Configure:

**Settings:**
- **Name**: `cron-slow`
- **Build Command**: `npm ci && npm run build`
- **Start Command**: `npm run prisma:migrate:deploy && npm run sync:slow`

**Cron Schedule:**
- Go to **Settings** → **Cron**
- Set schedule: `0 * * * *` (every hour at minute 0)

**Variables:** (same as web service, reference from web service)

### Step 6: Link Database

For all three services (api, cron-fast, cron-slow):
1. Go to **Variables**
2. Click **"Add Variable Reference"**
3. Select the PostgreSQL service
4. Add `DATABASE_URL`

### Step 7: Deploy

1. Push to your main branch or manually deploy
2. Wait for all services to build and start

### Step 8: Verify

```bash
# Get your Railway domain (e.g., npro-stats-api-production.up.railway.app)

# Health check
curl https://your-domain.up.railway.app/health

# Dashboard data (may be empty initially, wait for cron to run)
curl https://your-domain.up.railway.app/v1/npro/summary

# Manual sync trigger (with secret)
curl -X POST https://your-domain.up.railway.app/admin/sync/fast \
  -H "x-sync-secret: your-secret"
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Railway Platform                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Web API    │  │  Cron Fast   │  │  Cron Slow   │          │
│  │   (Fastify)  │  │  (5 min)     │  │  (60 min)    │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                    │
│         └─────────────────┼─────────────────┘                    │
│                           │                                      │
│                    ┌──────▼──────┐                              │
│                    │  PostgreSQL  │                              │
│                    │  (Prisma)    │                              │
│                    └─────────────┘                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

External Data Sources:
├── CoinGecko API (token prices)
├── DexScreener API (liquidity data)
├── NEAR RPC (validator stats, balances)
└── NearBlocks API (holders, transfers, premium txns)
```

## Sync Jobs

### Fast Sync (every 5 minutes)

- Token prices from CoinGecko
- Liquidity data from DexScreener
- Validator stats from NEAR RPC
- Account balances from NEAR RPC
- Snapshots for TVL and volume

### Slow Sync (every 60 minutes)

- Holder count from NearBlocks
- Transfer count from NearBlocks
- Premium indexer (paginated transaction history)
- Snapshot cleanup (keeps 7 days)

## Rate Limiting

### NearBlocks (Strict)

- **Free tier limits**: 6 calls/minute, 333 calls/day, 10,000 calls/month
- **Implementation**:
  - Global pacing: 15s between requests
  - Multi-key rotation with 3-minute cooldown on 429
  - Max pages per run: 20 (protects daily quota)
  - Mutex ensures one request at a time

### NEAR RPC

- **Implementation**:
  - Multiple endpoint failover
  - 5-minute blacklist on failures
  - Automatic retry with exponential backoff

## Database Schema

```
MetricCurrent    - Key-value store for latest metrics
MetricSnapshot   - Historical values for delta calculations
PremiumState     - Cursor for premium indexer pagination
PremiumEvent     - Individual premium transactions
PremiumUser      - Current tier for each user
SyncState        - Last run timestamps and status
```

## Response Format

The `/v1/npro/summary` endpoint returns:

```json
{
  "asOf": {
    "fast": "2026-01-29T12:00:00.000Z",
    "slow": "2026-01-29T11:00:00.000Z",
    "premium": "2026-01-29T11:00:00.000Z"
  },
  "token": {
    "npro": {
      "usd": 0.31,
      "change24h": -1.64,
      "change7d": 2.5,
      "change30d": -5.2,
      "marketCap": 163844,
      "fdv": 3100000,
      "circulatingSupply": 531000
    },
    "near": {
      "usd": 1.45,
      "change24h": 0.5,
      "change7d": 3.2,
      "change30d": -2.1
    },
    "nproInNear": 0.214,
    "nproInNearChange24h": -2.1
  },
  "validator": {
    "staked": { "raw": "...", "formatted": "1234567.89", "number": 1234567.89 },
    "unstaked": { "raw": "...", "formatted": "0", "number": 0 },
    "total": { "raw": "...", "formatted": "1234567.89", "number": 1234567.89 },
    "rpcUrlUsed": "https://near.lava.build"
  },
  "nearblocks": {
    "holders": { "count": 10973, "delta24h": 15 },
    "transfers": { "count": 110113, "delta24h": 234 }
  },
  "accounts": {
    "treasury": { "raw": "...", "formatted": "500000", "number": 500000, "usdValue": 155000 },
    "team": { "raw": "...", "formatted": "500000", "number": 500000, "usdValue": 155000 },
    "marketing": { ... },
    "staking": { ... },
    "liquidity": { ... },
    "distribution": { ... },
    "premium": { ... },
    "intents": { ... }
  },
  "liquidity": {
    "rhea": {
      "tvlUsd": 58568.95,
      "delta24h": 1234.56,
      "volume24h": 1126.57,
      "deltaVolume24h": -500,
      "buys24h": 15,
      "sells24h": 47,
      "totalTxns24h": 62,
      "baseNpro": 94162,
      "quoteNear": 20352,
      "priceUsd": 0.31,
      "priceNative": 0.217,
      "priceChange24hPct": -1.42,
      "pairUrl": "https://dexscreener.com/near/refv1-6724",
      "marketCap": 165459,
      "fdv": 3116269
    },
    "intents": {
      "raw": "...",
      "formatted": 50000,
      "usdValue": 15500
    }
  },
  "premium": {
    "premiumUsers": 150,
    "premiumUsersChange24h": 5,
    "ambassadorUsers": 300,
    "ambassadorUsersChange24h": 10,
    "upgrades24h": 3,
    "unsubscribes24h": 1,
    "paidUsers": 450,
    "locked": {
      "premium": 37500,
      "ambassador": 22500,
      "total": 60000
    }
  }
}
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with watch mode |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run sync:fast` | Run fast sync job |
| `npm run sync:slow` | Run slow sync job |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate:dev` | Run migrations (development) |
| `npm run prisma:migrate:deploy` | Run migrations (production) |
| `npm run prisma:studio` | Open Prisma Studio |
| `npm run typecheck` | Run TypeScript type checking |

## Local Testing Checklist

- [ ] Database connection works (`npm run prisma:studio`)
- [ ] Fast sync completes (`npm run sync:fast`)
- [ ] Slow sync completes (`npm run sync:slow`)
- [ ] Health endpoint returns ok (`curl localhost:8787/health`)
- [ ] Summary endpoint returns data (`curl localhost:8787/v1/npro/summary`)
- [ ] Admin endpoints are protected (returns 401 without secret)
- [ ] RPC failover works (test with invalid first RPC)

## Troubleshooting

### "All RPC endpoints failed"

- Check `NEAR_RPC_URLS` is configured correctly
- Verify RPC endpoints are accessible
- Check RPC status: `GET /admin/rpc/status`

### "NearBlocks rate limit"

- Ensure `NEARBLOCKS_API_KEYS` has valid keys
- Increase `POLL_INTERVAL_MS` to reduce request frequency
- Reduce `NEARBLOCKS_MAX_PAGES_PER_RUN` to limit daily usage

### Premium indexer not catching up

- The indexer processes at most `NEARBLOCKS_MAX_PAGES_PER_RUN` pages per hour
- For initial sync with many transactions, it may take multiple runs
- Check cursor progress in `premium_state` table

### Database connection errors

- Verify `DATABASE_URL` is correct
- Ensure PostgreSQL is running
- Check network/firewall settings

## License

MIT
