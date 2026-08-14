# Evening GTT Signals, Daily Proof & Exit Alerts

## Config files (edit these)

| File | What to change |
|------|----------------|
| [`config/alerts.yaml`](../config/alerts.yaml) | GTT tiers, max orders, limit premium, exit-alert books, email on/off |
| [`config/strategy-daily-proof.yaml`](../config/strategy-daily-proof.yaml) | Strategy allowlist + `max_scan` |
| [`config/schedules.yaml`](../config/schedules.yaml) | Cron times only (`evening_gtt` / `strategy_daily_proof` / `exit_alerts`) |

Restart API + worker after YAML edits, **or** Admin → **Reload YAML config** (`POST /api/v1/admin/config/reload`) — worker refreshes within ~60s.

Env hard-off (wins over YAML): `EVENING_GTT_EMAIL=0`, `EXIT_ALERT_EMAIL=0`, `SWING_RADAR_EMAIL=0`.

---

## 1. Evening GTT swing signals

**Goal:** After NSE close, convert High Conviction swing radar into **manual GTT order lines** (trigger / limit / SL / target / qty) for Zerodha-style placement.

| Piece | Detail |
|-------|--------|
| Schedule | `evening_gtt` cron `0 16 * * *` IST (`config/schedules.yaml`) |
| Source | Durable Swing Auto snapshot · tiers `high_conviction` then `strict_enter` (deduped) |
| Persist | Redis + `app_settings` key `evening_gtt:YYYY-MM-DD` |
| Email | Optional digest via SMTP (`EVENING_GTT_EMAIL=0` to disable) |
| UI | `/signals` board · Morning cockpit summary |
| API | `GET /api/v1/signals/evening-gtt` · `POST /api/v1/signals/evening-gtt/build` |
| Ops | Dashboard ops alert if missing after 16:30 IST (weekday post-close) |

**Not included (by design):** Kite/Zerodha live order API. Research + clipboard only until broker connectivity is formally approved.

### Manual build
```bash
# Authenticated API
POST /api/v1/signals/evening-gtt/build
{ "force": true, "send_email": true }
```

---

## 2. Automatic daily strategy proof (live environment)

**Goal:** Run a curated Strategies catalog allowlist every weekday on live data, store hit counts / top symbols, and expose a multi-day scoreboard for analysis and improvements.

| Piece | Detail |
|-------|--------|
| Schedule | `strategy_daily_proof` cron `15 16 * * *` IST |
| Default allowlist | `swing_strict_enter`, `swing_ma20_stratzy`, `swing_breakout_volume`, `swing_best_r`, `hybrid_quality_swing` |
| `max_scan` | 60 (override in YAML) |
| Persist | Postgres `strategy_daily_runs` |
| UI | `/strategies` scoreboard · Morning cockpit summary |
| API | `GET /api/v1/strategies/daily-proof?days=14` · `POST /api/v1/strategies/daily-proof/run` |
| Ops | Dashboard ops alert if missing after 17:00 IST (weekday post-close) |

**How to use for improvements**
1. Keep worker leader up so 16:15 IST batch runs.
2. Compare `avg_hits` / last-day hits across strategies on the scoreboard.
3. Drill into `top_symbols` on recent rows when a strategy spikes or goes silent.
4. Cross-check with Swing Auto paper proof (armed paper) for **fill-level** evidence — daily proof is **signal coverage**, paper is **execution realism**.

### Manual run
```bash
POST /api/v1/strategies/daily-proof/run
{ "force": true }
```

## 3. Open-book exit-alert email

**Goal:** Email EXIT signals on **open swing / intraday journal positions** without opening Morning.

| Piece | Detail |
|-------|--------|
| Schedule | `exit_alerts` cron `45 15 * * *` IST |
| Source | Open rows in `swing_positions` + `nifty_intraday_positions` |
| Email | Attractive trade-signal cards via SMTP (`EXIT_ALERT_EMAIL=0` to disable) |
| API | `POST /api/v1/signals/exit-alerts/send` |
| CLI | `pnpm --filter @sv/data-adapters email:exit-alerts` |

Still also fires when Morning loads (legacy path). Paper exits remain separate (armed paper ticks).
