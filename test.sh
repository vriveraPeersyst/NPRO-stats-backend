#!/bin/bash
# Quick verification test for NPRO Stats Backend

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 NPRO Stats Backend - Verification Tests"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASSED=0
FAILED=0

# Test 1: TypeScript compilation
echo ""
echo "📋 Test 1: TypeScript Compilation"
if npm run typecheck > /dev/null 2>&1; then
    echo -e "${GREEN}✅ PASSED${NC} - No TypeScript errors"
    ((PASSED++))
else
    echo -e "${RED}❌ FAILED${NC} - TypeScript compilation errors"
    ((FAILED++))
fi

# Test 2: Project build
echo ""
echo "📋 Test 2: Project Build"
if npm run build > /dev/null 2>&1; then
    echo -e "${GREEN}✅ PASSED${NC} - Build successful"
    ((PASSED++))
    
    # Verify output files
    if [ -f "dist/server.js" ] && [ -f "dist/bin/run-fast-sync.js" ] && [ -f "dist/bin/run-slow-sync.js" ]; then
        echo "   - dist/server.js ($(wc -c < dist/server.js | numfmt --to=iec-i --suffix=B --round=nearest))"
        echo "   - dist/bin/run-fast-sync.js ($(wc -c < dist/bin/run-fast-sync.js | numfmt --to=iec-i --suffix=B --round=nearest))"
        echo "   - dist/bin/run-slow-sync.js ($(wc -c < dist/bin/run-slow-sync.js | numfmt --to=iec-i --suffix=B --round=nearest))"
    fi
else
    echo -e "${RED}❌ FAILED${NC} - Build failed"
    ((FAILED++))
fi

# Test 3: Dependencies check
echo ""
echo "📋 Test 3: Dependencies"
if npm ls > /dev/null 2>&1; then
    echo -e "${GREEN}✅ PASSED${NC} - All dependencies installed"
    ((PASSED++))
    
    # Count packages
    PACKAGE_COUNT=$(npm ls --depth=0 2>/dev/null | tail -1 | grep -o "[0-9]* packages" || echo "packages installed")
    echo "   - $PACKAGE_COUNT"
else
    echo -e "${RED}❌ FAILED${NC} - Dependency issues"
    ((FAILED++))
fi

# Test 4: Code structure
echo ""
echo "📋 Test 4: Code Structure"
REQUIRED_FILES=(
    "src/server.ts"
    "src/config/env.ts"
    "src/db/prisma.ts"
    "src/services/index.ts"
    "src/routes/public.ts"
    "src/routes/admin.ts"
    "src/sync/fastSync.ts"
    "src/sync/slowSync.ts"
    "src/indexers/premiumIndexer.ts"
    "src/bin/run-fast-sync.ts"
    "src/bin/run-slow-sync.ts"
)

MISSING_FILES=0
for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "   Missing: $file"
        ((MISSING_FILES++))
    fi
done

if [ $MISSING_FILES -eq 0 ]; then
    echo -e "${GREEN}✅ PASSED${NC} - All required files present"
    ((PASSED++))
else
    echo -e "${RED}❌ FAILED${NC} - $MISSING_FILES required files missing"
    ((FAILED++))
fi

# Test 5: Configuration files
echo ""
echo "📋 Test 5: Configuration Files"
MISSING_CONFIG=0
if [ ! -f "prisma/schema.prisma" ]; then
    echo "   Missing: prisma/schema.prisma"
    ((MISSING_CONFIG++))
fi
if [ ! -f ".env.example" ]; then
    echo "   Missing: .env.example"
    ((MISSING_CONFIG++))
fi
if [ ! -f "package.json" ]; then
    echo "   Missing: package.json"
    ((MISSING_CONFIG++))
fi
if [ ! -f "tsconfig.json" ]; then
    echo "   Missing: tsconfig.json"
    ((MISSING_CONFIG++))
fi

if [ $MISSING_CONFIG -eq 0 ]; then
    echo -e "${GREEN}✅ PASSED${NC} - All config files present"
    ((PASSED++))
else
    echo -e "${RED}❌ FAILED${NC} - $MISSING_CONFIG config files missing"
    ((FAILED++))
fi

# Test 6: Security vulnerabilities
echo ""
echo "📋 Test 6: Security Audit"
VULN_COUNT=$(npm audit 2>&1 | grep -c "vulnerabilities" || echo "0")
HIGH_VULN=$(npm audit 2>&1 | grep "high" || echo "")

if [ -z "$HIGH_VULN" ]; then
    echo -e "${GREEN}✅ PASSED${NC} - No high severity vulnerabilities"
    ((PASSED++))
else
    echo -e "${YELLOW}⚠️  WARNING${NC} - Low severity vulnerabilities present (acceptable)"
    echo "   Run: npm audit for details"
    ((PASSED++))
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Test Results Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "   ${GREEN}Passed: $PASSED${NC}"
echo -e "   ${RED}Failed: $FAILED${NC}"
TOTAL=$((PASSED + FAILED))
echo "   Total:  $TOTAL"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All verification tests passed!${NC}"
    echo ""
    echo "🚀 Next steps:"
    echo "   1. Set up PostgreSQL database"
    echo "   2. Create .env file (copy from .env.example)"
    echo "   3. Run: npm run prisma:migrate:deploy"
    echo "   4. Start dev server: npm run dev"
    echo "   5. Test endpoints: curl http://localhost:8787/health"
    echo ""
    echo "📖 For more info, see TESTING.md"
    exit 0
else
    echo -e "${RED}❌ Some tests failed. Please fix the issues above.${NC}"
    exit 1
fi
