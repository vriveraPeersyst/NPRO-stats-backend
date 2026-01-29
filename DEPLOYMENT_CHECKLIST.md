# Railway Deployment Checklist

## Pre-Deployment Setup

### 1. Generate Secrets ✅

```bash
# Generate a secure SYNC_SECRET (min 16 chars)
openssl rand -base64 32
# Example output: j8Kl9mN2pQ3rS4tU5vW6xY7zA8bC9dE0

# Store this for use in Railway environment variables
```

### 2. Prepare API Keys ✅

You already have:
- ✅ NearBlocks API key: `25CC5734C06447F8BDC0C3F4F65EFE18`
- (Optional) Get more NearBlocks keys for rotation
- (Optional) CoinGecko Pro API key

---

## Railway Deployment Steps

### Step 1: Create Railway Project

1. Go to https://railway.app
2. Sign in with GitHub
3. Click **"New Project"**
4. Click **"Deploy from GitHub repo"**
5. Select your `npro-stats-backend` repository
6. Click **"Deploy Now"** (this creates the initial service)

### Step 2: Add PostgreSQL Database

1. In your Railway project dashboard
2. Click **"+ New"** → **"Database"** → **"Add PostgreSQL"**
3. Railway automatically creates `DATABASE_URL` variable
4. Wait for database to provision (~30 seconds)

### Step 3: Configure Web API Service

1. Click on the web service (created in Step 1)
2. Go to **"Settings"** tab:
   - **Service Name**: Rename to `api`
   - **Start Command**: `sh -c "npx prisma migrate deploy && node dist/server.js"`
   - **Build Command**: Leave default (`npm install && npm run build`)

3. Go to **"Variables"** tab and add:

```bash
PORT=8787
NODE_ENV=production
LOG_LEVEL=info

# Generate this with: openssl rand -base64 32
SYNC_SECRET=<paste-your-generated-secret>

# NEAR RPC endpoints (comma-separated)
NEAR_RPC_URLS=https://near.lava.build,https://rpc.mainnet.near.org,https://near.blockpi.network/v1/rpc/public,https://rpc.shitzuapes.xyz

# NearBlocks API configuration
NEARBLOCKS_BASE=https://api.nearblocks.io
NEARBLOCKS_API_KEYS=25CC5734C06447F8BDC0C3F4F65EFE18
NEARBLOCKS_API_HEADER=Authorization
NEARBLOCKS_API_PREFIX=Bearer 
POLL_INTERVAL_MS=15000
PAGE_LIMIT=100
NEARBLOCKS_KEY_COOLDOWN_MS=180000
NEARBLOCKS_TIMEOUT_MS=10000
NEARBLOCKS_MAX_RETRIES=3
NEARBLOCKS_MAX_PAGES_PER_RUN=20

# CoinGecko (leave empty for free tier)
COINGECKO_BASE=https://api.coingecko.com/api/v3
COINGECKO_API_KEY=

# DexScreener
DEXSCREENER_BASE=https://api.dexscreener.com
```

4. **Link Database**:
   - In **"Variables"** tab, click **"+ New Variable"** → **"Add Reference"**
   - Select the PostgreSQL service
   - Select `DATABASE_URL`
   - Click **"Add"**

5. **Generate Domain**:
   - Go to **"Settings"** → **"Networking"**
   - Click **"Generate Domain"**
   - Copy the domain (e.g., `npro-stats-api-production.up.railway.app`)

### Step 4: Create Fast Sync Cron Service

1. Click **"+ New"** → **"GitHub Repo"**
2. Select same `npro-stats-backend` repository
3. Click **"Deploy"**

4. Configure the service:
   - **Settings** → **Service Name**: `cron-fast`
   - **Settings** → **Start Command**: `sh -c "npx prisma migrate deploy && node dist/bin/run-fast-sync.js"`
   - **Settings** → **Cron Schedule**: Enable and set to `*/5 * * * *`

5. **Variables** → **"Raw Editor"**:
   - Copy ALL variables from the `api` service
   - Or use **"Add Reference"** to link each variable from the API service

6. **Link Database**: Same as Step 3.4

### Step 5: Create Slow Sync Cron Service

1. Click **"+ New"** → **"GitHub Repo"**
2. Select same `npro-stats-backend` repository
3. Click **"Deploy"**

4. Configure the service:
   - **Settings** → **Service Name**: `cron-slow`
   - **Settings** → **Start Command**: `sh -c "npx prisma migrate deploy && node dist/bin/run-slow-sync.js"`
   - **Settings** → **Cron Schedule**: Enable and set to `0 * * * *`

5. **Variables**: Copy from `api` service (same as Step 4.5)
6. **Link Database**: Same as Step 3.4

---

## Verification

### 1. Check Deployments

All three services should show **"Success"** in Railway dashboard:
- ✅ `api` - Running
- ✅ `cron-fast` - Scheduled (next run in X minutes)
- ✅ `cron-slow` - Scheduled (next run in X minutes)

### 2. Test API Endpoints

```bash
# Replace with your Railway domain
export API_DOMAIN="your-domain.up.railway.app"

# Test health check
curl https://$API_DOMAIN/health

# Expected: {"status":"ok","timestamp":"...","database":"connected"}
```

### 3. Check Logs

In Railway dashboard:
1. Click on `api` service
2. Go to **"Deployments"** → Click latest deployment → **"View Logs"**
3. Look for:
   ```
   ✅ Environment validated successfully
   ✅ Database connected
   🚀 Server listening on port 8787
   ```

### 4. Wait for First Sync

Cron jobs run on schedule:
- `cron-fast`: Every 5 minutes (e.g., 12:00, 12:05, 12:10...)
- `cron-slow`: Every hour (e.g., 12:00, 13:00, 14:00...)

Check logs:
1. Click on `cron-fast` service → **"View Logs"**
2. Wait for next 5-minute mark
3. Look for:
   ```
   🔄 NPRO Stats - Fast Sync
   ✅ Fast Sync Results:
      Duration: 2345ms
      Success: true
   ```

### 5. Test Summary Endpoint (After First Sync)

```bash
curl https://$API_DOMAIN/v1/npro/summary | jq
```

Expected: Full dashboard data with token prices, liquidity, validator stats, etc.

### 6. Test Manual Sync Trigger

```bash
# Replace with your generated SYNC_SECRET
export SYNC_SECRET="your-sync-secret-here"

curl -X POST https://$API_DOMAIN/admin/sync/fast \
  -H "x-sync-secret: $SYNC_SECRET" | jq
```

Expected:
```json
{
  "status": "ok",
  "message": "Fast sync completed successfully",
  "duration": 2345,
  "metrics": {
    "prices": true,
    "liquidity": true,
    "validator": true,
    "accounts": true
  }
}
```

---

## Troubleshooting

### Database Connection Issues

**Symptom**: `{"status":"error","database":"disconnected"}`

**Solution**:
1. Check `DATABASE_URL` is linked in all services
2. Restart services in this order: `api`, `cron-fast`, `cron-slow`

### Cron Jobs Not Running

**Symptom**: No logs in cron services

**Solution**:
1. Check cron schedule is enabled in **Settings** → **Cron**
2. Verify start command is correct
3. Check Railway hasn't paused the service (free tier limitation)

### NearBlocks 401 Errors

**Symptom**: `❌ NearBlocks error: 401 Unauthorized`

**Solution**:
1. Verify `NEARBLOCKS_API_KEYS` is correct (no extra spaces)
2. Check API key is active at https://api.nearblocks.io/

### Build Failures

**Symptom**: Deployment shows "Build failed"

**Solution**:
1. Check build logs for errors
2. Verify `package.json` and `tsup.config.ts` are committed
3. Try manual deploy: **Deployments** → **"Deploy"**

---

## Post-Deployment

### Monitor API Usage

**NearBlocks quota tracking:**
- Initial sync: ~22 API calls
- Hourly syncs: ~3-4 calls
- Daily usage: ~72-96 calls
- Monthly estimate: ~2,900 calls (✅ under 12,500 limit)

**Check usage:**
1. Log into NearBlocks dashboard
2. View API usage statistics
3. Adjust `NEARBLOCKS_MAX_PAGES_PER_RUN` if needed

### Set Up Alerts (Optional)

Railway can send notifications:
1. Go to Project **Settings** → **Notifications**
2. Add webhook or email for deployment failures

---

## Scaling Considerations

### Add More NearBlocks API Keys

To increase throughput and reliability:
1. Get additional free NearBlocks API keys
2. Update `NEARBLOCKS_API_KEYS` variable:
   ```
   NEARBLOCKS_API_KEYS=key1,key2,key3,key4,key5
   ```
3. With 5 keys, you can handle 50 calls/minute (5 × 10)

### Upgrade Database (If Needed)

If you see slow queries:
1. Railway **Settings** → **Database**
2. Upgrade to larger instance
3. Add connection pooling via Prisma

### Enable Metrics

Add monitoring service:
- Sentry for error tracking
- Prometheus + Grafana for metrics
- Railway's built-in metrics

---

## Success Criteria ✅

Your deployment is successful when:

- ✅ Health check returns `{"status":"ok","database":"connected"}`
- ✅ Cron jobs run on schedule and show in logs
- ✅ `/v1/npro/summary` returns populated data
- ✅ No errors in Railway logs
- ✅ NearBlocks API calls staying under quota
- ✅ All services showing green "Success" status

---

## Next Steps After Deployment

1. **Frontend Integration**: Use the Railway API domain in your frontend
2. **Custom Domain**: Add your own domain in Railway settings
3. **Monitoring**: Set up error tracking and alerts
4. **Backup**: Configure database backups in Railway
5. **Documentation**: Update frontend team with API endpoint URL

---

**Estimated Deployment Time**: 15-20 minutes

**Questions?** Check logs in Railway dashboard or refer to [README.md](./README.md) for detailed docs.
