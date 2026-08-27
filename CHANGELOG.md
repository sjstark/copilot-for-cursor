# Changelog

All notable changes to this project will be documented in this file.

## [2.2.0] - 2026-07-02

### Added - Major Feature Release

#### 💰 Cost Tracking System
- Real-time cost estimation for all models based on upstream pricing
- Per-request, per-model, and daily cost breakdowns
- Lifetime spending totals in dashboard
- Budget limit enforcement (daily/monthly)
- Budget alerts at 75%, 90%, and 100% thresholds
- Cost data persisted in usage database
- New `/api/settings/budget` endpoint for budget configuration

#### 🔄 Automatic Retry Logic
- Exponential backoff for failed requests
- Configurable retry policies (max retries, delays, status codes)
- Automatic retry for 408, 429, 500, 502, 503, 504 errors
- Jitter added to prevent thundering herd
- Retry statistics logged in console
- Supports both fetch requests and generic async operations

#### 🎯 Smart Model Router
- Complexity-based model selection (simple/medium/complex)
- Automatic routing for coding tasks → Codex models
- Automatic routing for reasoning tasks → premium models
- Cost optimization mode (route to cheaper models when possible)
- Per-request cost limits
- Configurable via `/api/settings/routing` endpoint
- Optional feature (disabled by default)

#### 🐳 Docker Support
- Production-ready Dockerfile with multi-stage builds
- Docker Compose configuration with health checks
- Volume persistence for data
- Resource limits and reservations
- Comprehensive deployment guide (DOCKER.md)
- nginx reverse proxy example
- Backup/restore documentation

#### 📊 Enhanced Dashboard
- Cost tracking column in all usage tables
- Budget alert notifications
- Fifth stat card showing lifetime costs
- Updated daily history with cost column
- Updated per-model breakdown with cost column
- Updated recent requests with cost column

### Changed

#### Core System
- `usage-db.ts`: Extended RequestLog to include cost estimates
- `usage-db.ts`: Extended DailySnapshot to track costs per model
- `usage-db.ts`: Updated lifetime totals to include totalCost
- `proxy-router.ts`: Integrated retry logic for upstream requests
- `proxy-router.ts`: Added budget enforcement before processing requests
- `proxy-router.ts`: Integrated smart routing (optional)
- `start.ts`: Added pricing cache initialization on startup
- `package.json`: Added Docker convenience scripts

#### Documentation
- README.md: Added new features section
- README.md: Updated dashboard documentation
- README.md: Added advanced configuration section
- README.md: Added Claude Fable 5 to supported models
- README.md: Updated tested models count (20/21)

### New Files

- `cost-tracking.ts` - Cost calculation, pricing cache, budget management
- `retry-logic.ts` - Retry logic with exponential backoff and fallback chains
- `smart-router.ts` - Intelligent model selection based on complexity
- `Dockerfile` - Production Docker image configuration
- `docker-compose.yml` - Docker Compose stack definition
- `.dockerignore` - Docker build exclusions
- `DOCKER.md` - Comprehensive Docker deployment guide
- `CHANGELOG.md` - This file

### Technical Details

#### Cost Tracking
- Fetches pricing from upstream `/v1/models` endpoint
- Caches pricing for all models (both dashed and normalized IDs)
- Fallback pricing table for when upstream doesn't provide data
- Cost calculated as: `(tokens / 1,000,000) * price_per_million`
- Budget tracked with automatic daily/monthly reset

#### Retry Logic
- Default: 3 retries with 1s initial delay, 10s max delay
- 2x backoff multiplier with ±20% jitter
- Retries only on retryable status codes and network errors
- Total request duration tracked across all attempts

#### Smart Router
- Token estimation: ~4 chars per token heuristic
- Simple: <1k tokens → route to Haiku/Mini
- Medium: 1k-5k tokens → route to Sonnet/standard
- Complex: >5k tokens → route to Opus/premium
- Keyword detection for coding/reasoning tasks
- Cost-optimized mode always selects cheapest viable model

#### Docker
- Based on `oven/bun:1-slim` for minimal size
- Non-root user (bunuser:nodejs, uid 1001)
- Health check every 30s via `/api/usage` endpoint
- Named volume for data persistence
- Configurable via environment variables

## [2.1.1] - Previous

See git history for earlier changes.
