# NPRO Stats Backend - Testing Guide

## Quick Start for Testing

### Prerequisites

You need a running PostgreSQL database. Choose one of the following:

#### Option 1: Using Docker Compose (Recommended)

```bash
# Start PostgreSQL in Docker
docker-compose up -d postgres

# Wait for it to be healthy (check logs)
docker-compose logs postgres

# Run migrations
npm run prisma:migrate:deploy

# Start the API
npm run dev
```

#### Option 2: Using Local PostgreSQL

```bash
# Create the database
createdb npro_stats

# Run migrations
npm run prisma:migrate:deploy

# Start the API
npm run dev
```

#### Option 3: Using Railway (Production Deployment)

Follow the Railway deployment instructions in [README.md](./README.md)

---

## API Testing

Once the server is running on `http://localhost:8787`:

### 1. Health Check

```bash
curl http://localhost:8787/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-01-29T12:00:00.000Z",
  "database": "connected"
}
```

### 2. Get Dashboard Summary

```bash
curl http://localhost:8787/v1/npro/summary
```

Expected response (initially empty, will populate after sync):
```json
{
  "asOf": {
    "fast": null,
    "slow": null,
    "premium": null
  },
  "token": null,
  "validator": null,
  "nearblocks": null,
  "accounts": null,
  "liquidity": null,
  "premium": null
}
```

### 3. Manual Fast Sync (Admin)

```bash
curl -X POST http://localhost:8787/admin/sync/fast \
  -H "x-sync-secret: dev-secret-minimum-16-characters-long"
```

Expected response:
```json
{
  "status": "ok",
  "success": true,
  "duration": 2345,
  "errors": [],
  "metrics": {
    "tokenPrices": true,
    "liquidity": true,
    "validator": true,
    "accountBalances": true
  }
}
```

### 4. Manual Slow Sync (Admin)

```bash
curl -X POST http://localhost:8787/admin/sync/slow \
  -H "x-sync-secret: dev-secret-minimum-16-characters-long"
```

### 5. Check RPC Status (Admin)

```bash
curl http://localhost:8787/admin/rpc/status \
  -H "x-sync-secret: dev-secret-minimum-16-characters-long"
```

---

## Sync Jobs Testing

### Run Fast Sync Manually

```bash
npm run sync:fast
```

Output:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 NPRO Stats - Fast Sync
   Started at: 2026-01-29T12:00:00.000Z
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
...
✅ Fast Sync Results:
   Duration: 2345ms
   Success: true
   Token prices: ✅
   Liquidity: ✅
   Validator: ✅
   Account balances: ✅
```

### Run Slow Sync Manually

```bash
npm run sync:slow
```

---

## Database Inspection

### Using Prisma Studio

```bash
npm run prisma:studio
```

Opens interactive database browser at `http://localhost:5555`

### Using psql (if installed)

```bash
# Connect to database
psql postgresql://postgres:postgres@localhost:5432/npro_stats

# View tables
\dt

# View data
SELECT * FROM "metric_current";
SELECT * FROM "premium_user" LIMIT 10;
```

---

## Environment Variables for Testing

Edit `.env` file to customize API keys:

```bash
# Add real NearBlocks API keys for full testing
NEARBLOCKS_API_KEYS=your-key-1,your-key-2,your-key-3

# Add CoinGecko Pro API key (optional)
COINGECKO_API_KEY=your-pro-api-key
```

---

## Expected Behavior

### On First Run

1. **Health check** → ✅ database connected
2. **Summary endpoint** → Returns null values (no sync data yet)
3. **Fast sync** → Fetches real data from CoinGecko, DexScreener, NEAR RPC
4. **Summary endpoint** → Now has data:
   - Token prices ✅
   - Liquidity stats ✅
   - Validator stats ✅
   - Account balances ✅
5. **Slow sync** → Fetches NearBlocks data + premium indexer
6. **Summary endpoint** → Complete with all metrics ✅

### Subsequent Runs

- Sync jobs update all metrics every 5 minutes (fast) and 60 minutes (slow)
- Snapshots track 24h deltas
- Premium indexer resumes from last cursor (incremental)

---

## Troubleshooting

### "Database connection failed"

```bash
# Check if PostgreSQL is running
docker ps

# View logs
docker-compose logs postgres

# Restart
docker-compose restart postgres
```

### "Rate limit exceeded"

The NearBlocks API has strict limits on the free tier. 
- Test with lower `NEARBLOCKS_MAX_PAGES_PER_RUN` (default: 20)
- Increase `POLL_INTERVAL_MS` (default: 15000 = 4 calls/min)

### "All RPC endpoints failed"

Check that NEAR RPC endpoints are accessible:
```bash
curl https://near.lava.build -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"test","method":"block","params":{"finality":"final"}}'
```

---

## CI/CD Testing

For automated testing in CI/CD pipeline:

```bash
# Type checking
npm run typecheck

# Build
npm run build

# Database migration (in test environment)
DATABASE_URL=... npm run prisma:migrate:deploy

# Start server (background)
npm run start &

# Test endpoints
sleep 5
curl http://localhost:8787/health

# Cleanup
kill %1
```

---

## Load Testing

For basic load testing:

```bash
# Install ab (Apache Bench)
brew install httpd

# Test 100 requests, 10 concurrent
ab -n 100 -c 10 http://localhost:8787/health

# Test summary endpoint
ab -n 50 -c 5 http://localhost:8787/v1/npro/summary
```

---

## Development Tips

1. **Enable debug logging**: Set `LOG_LEVEL=debug` in `.env`
2. **Watch file changes**: `npm run dev` automatically reloads
3. **Test database queries**: Use `npm run prisma:studio`
4. **Check SQL**: Enable Prisma query logging in `src/db/prisma.ts`

```typescript
log: ['query', 'error', 'warn'],
```

---

## Next Steps

Once local testing is complete:

1. **Deploy to Railway** - Follow deployment guide in README.md
2. **Monitor in production** - Check logs in Railway dashboard
3. **Set up alerts** - Configure health check monitoring
4. **Scale as needed** - Adjust cron schedules and API key limits

