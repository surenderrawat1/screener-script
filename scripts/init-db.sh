#!/usr/bin/env bash
set -euo pipefail
docker exec shared_postgres psql -U platform -d market_research -tc \
  "SELECT 1 FROM pg_database WHERE datname = 'stock_verifier'" | grep -q 1 \
  || docker exec shared_postgres psql -U platform -d market_research -c "CREATE DATABASE stock_verifier;"
echo "Database stock_verifier ready."
