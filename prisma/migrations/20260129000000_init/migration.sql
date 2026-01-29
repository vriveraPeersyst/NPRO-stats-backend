-- CreateEnum
CREATE TYPE "DeltaType" AS ENUM ('SUB_PREMIUM', 'SUB_AMBASSADOR', 'UPGRADE', 'DOWNGRADE_PREMIUM', 'DOWNGRADE_AMBASSADOR', 'OTHER');

-- CreateEnum
CREATE TYPE "UserTier" AS ENUM ('BASIC', 'AMBASSADOR', 'PREMIUM');

-- CreateTable
CREATE TABLE "metric_current" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metric_current_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "metric_snapshot" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valueNumeric" DECIMAL(40,10) NOT NULL,

    CONSTRAINT "metric_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "premium_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "cursor" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "premium_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "premium_event" (
    "eventIndex" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "deltaType" "DeltaType" NOT NULL,
    "deltaAmountRaw" TEXT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT NOT NULL,

    CONSTRAINT "premium_event_pkey" PRIMARY KEY ("eventIndex")
);

-- CreateTable
CREATE TABLE "premium_user" (
    "accountId" TEXT NOT NULL,
    "tier" "UserTier" NOT NULL DEFAULT 'BASIC',
    "lastEventIndex" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "premium_user_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "sync_state" (
    "type" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,

    CONSTRAINT "sync_state_pkey" PRIMARY KEY ("type")
);

-- CreateIndex
CREATE INDEX "metric_snapshot_key_ts_idx" ON "metric_snapshot"("key", "ts");

-- CreateIndex
CREATE INDEX "premium_event_blockTimestamp_idx" ON "premium_event"("blockTimestamp");

-- CreateIndex
CREATE INDEX "premium_event_accountId_idx" ON "premium_event"("accountId");

-- CreateIndex
CREATE INDEX "premium_event_deltaType_idx" ON "premium_event"("deltaType");

-- CreateIndex
CREATE INDEX "premium_user_tier_idx" ON "premium_user"("tier");
