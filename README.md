# FinancialReview

A self-hosted, single-user retirement and portfolio dashboard. It reads your live Schwab accounts and turns them into the questions a retiree actually asks: *Am I on track? What needs my attention? How much tax will I owe, and should I convert to Roth this year? Where is my income coming from, and will the money last?*

FinancialReview is the AtScale-design rebuild of **FinancialDashboard** (V3). The data engine (Python server, Schwab + yfinance, tax and retirement engines) is the same. The UI is new: a Simple/Advanced mode, and in Advanced, a workspace with an "On this tab" rail, one page per topic, and ⌘K Find instead of one long scroll.

> The full feature-by-feature reference from V3 (engines, business rules, data flow) is kept in [README_V3_REFERENCE.md](README_V3_REFERENCE.md).

---

## Contents

- [What's in the app](#whats-in-the-app)
- [How it fits together](#how-it-fits-together)
- [Prerequisites](#prerequisites)
- [1. Install](#1-install)
- [2. Create your Schwab developer app](#2-create-your-schwab-developer-app)
- [3. Add your credentials and config files](#3-add-your-credentials-and-config-files)
- [4. Get the Schwab token](#4-get-the-schwab-token)
- [5. Map your Schwab accounts](#5-map-your-schwab-accounts)
- [6. Run it](#6-run-it)
- [Using the app: Simple vs Advanced](#using-the-app-simple-vs-advanced)
- [Optional extras](#optional-extras)
- [Configuration file reference](#configuration-file-reference)
- [Troubleshooting](#troubleshooting)

---

## What's in the app

Fifteen tabs, each written from one point of view:

| Tab | Who it speaks for | What it answers |
|---|---|---|
| **Overview** | You | What needs my attention, my money today (markets, last 10 sessions), am I on track, what should I do next |
| **Roadmap** | You, as a retiree | Where am I in retirement, the five phases ahead, will the plan hold |
| **Portfolio** | Analyst | Holdings and allocation, drift from target, rebalance trades, concentration, fund health, income |
| **Risk** | Analyst | Where risk comes from, market regime, correlation, drawdown and volatility, cash and execution |
| **Returns** | Analyst | How you're doing vs the S&P 500, what drove returns, by account, per-symbol risk |
| **Tax** | Tax advisor | Where you are this year, estimated payments, Roth conversion (convert now?), which lots to sell |
| **Cash flow** | You | Where the money goes, whether income covers spending, the cash bucket |
| **Forecast** | Planner | Where the portfolio is heading, year by year, income/tax/cashflow ahead |
| **Drawdown** | Planner | Annual withdrawal decision, schedule, lifetime tax, spending guardrails, depletion and legacy |
| **Simulate** | Planner | Monte Carlo, sequence stress, withdrawal rules, safe spending range, what-if sandbox |
| **Research** | Analyst | Any symbol: snapshot, action plan, portfolio fit, deep analytics, swing signal |
| **Trade sim** | You | Paper-trading portfolios (not real money) |
| **AI** | Assistant | Daily briefing and "ask the portfolio" chat (Ollama or OpenRouter) |
| **Balance** | You | Balance history, month by month, recent sessions, by account |
| **Settings** | — | Edit personal info, tax brackets, account mapping, targets, alerts, AI keys, cost basis |

---

## How it fits together

```
Browser ── http://localhost:3000 ── Vite dev server (React + TypeScript)
                                         │  proxies /api/*
                                         ▼
                           Python API server  http://localhost:8501   (server/server.py)
                              │            │              │
                    Schwab API (schwab-py)  yfinance   SQLite (server/dashboard.db, sim_portfolios.db)
```

- **Frontend:** `src/` (React 19, Vite, inline-style components on the AtScale tokens).
- **Backend:** `server/` (Python 3.11+; developed on 3.14). It fetches positions and balances from Schwab, prices and history from yfinance, and computes everything else locally.
- **Your data stays on your machine.** All credentials and config are gitignored, local files in `server/`.

---

## Prerequisites

- **macOS or Linux** (developed on macOS; `start.sh` uses `bash` and `lsof`).
- **Python 3.11+**
- **Node.js 20+** and npm (developed on Node 26).
- A **Charles Schwab brokerage account**, plus a free **Schwab Developer** account (step 2).
- Optional: [Ollama](https://ollama.com) for local AI, or an [OpenRouter](https://openrouter.ai) key.

---

## 1. Install

```bash
git clone <repository-url> FinancialReview
cd FinancialReview
```

**Python.** Use a virtual environment *outside* the repo (the convention here is `~/Development/venv/<Project>`):

```bash
python3 -m venv ~/Development/venv/FinancialReview
source ~/Development/venv/FinancialReview/bin/activate
pip install -r server/requirements.txt
```

**Frontend.**

```bash
npm install
```

> `start.sh` runs `python3`, so **activate the venv first** in the terminal where you start the app. Otherwise it uses the system Python, which won't have the packages.

---

## 2. Create your Schwab developer app

The dashboard talks to Schwab through the official Trader API, so you need your own developer app. You only do this once.

1. Go to **[developer.schwab.com](https://developer.schwab.com)** and create a developer account. This is a separate login from your brokerage account.
2. Open **Dashboard → Apps → Create App**.
3. **API product:** choose **Accounts and Trading Production**. This is the individual-trader product that gives read access to your own accounts.
4. **Callback URL:** enter `https://127.0.0.1`.
   - It must match `redirect_uri` in `schwab_credentials.json` **character for character**. That includes no trailing slash, and the port if you add one.
5. Submit, then wait until the app's status shows **Ready For Use**. This usually takes a few days, and the token step won't work before then.
6. Open the app and copy its **App Key** and **Secret**. You need them in the next step.

---

## 3. Add your credentials and config files

Every config file lives in `server/` and has a `.sample` next to it. Copy the samples, then fill them in. The real files are **gitignored**: never commit them.

```bash
cd server
cp schwab_credentials.json.sample  schwab_credentials.json
cp account_mapping.json.sample     account_mapping.json
cp personal.json.sample            personal.json
cp rules.json.sample               rules.json
cp tax_brackets.json.sample        tax_brackets.json
cp target_roth.json.sample         target_roth.json
cp target_taxable.json.sample      target_taxable.json
cp ai_keys.json.sample             ai_keys.json        # optional, for OpenRouter
cp schwab_cost.json.sample         schwab_cost.json    # optional, cost-basis lots
cd ..
```

**`server/schwab_credentials.json`**: paste the App Key and Secret from step 2:

```json
{
  "app_key":      "YOUR_SCHWAB_APP_KEY",
  "app_secret":   "YOUR_SCHWAB_APP_SECRET",
  "redirect_uri": "https://127.0.0.1",
  "token_path":   ".schwab_token.json"
}
```

**`server/personal.json`**: date of birth, filing status (`MFJ` for married filing jointly; any other value uses the single brackets), Social Security estimates per claiming age, spending, income target, and Roth conversion plan. The sample shows the full structure. You can also edit all of this later in **Settings → Personal**.

The other files can stay at their sample values for a first run. Tune them later in **Settings** (see the [reference](#configuration-file-reference)).

---

## 4. Get the Schwab token

The token is what lets the server read your accounts without you logging in each time.

```bash
source ~/Development/venv/FinancialReview/bin/activate
cd server
python3 setup_schwab_auth.py
```

What happens:

1. Press Enter, and a browser opens the Schwab login.
2. Log in with your **brokerage** credentials, approve access, and select **all** the accounts you want the dashboard to see.
3. Schwab redirects to `https://127.0.0.1/?code=...`. The page shows "can't connect", which is expected.
4. **Copy the full URL** from the browser's address bar and paste it into the terminal.
5. The script saves the token to **`server/.schwab_token.json`** and lists the linked accounts by their last 4 digits.

**How long it lasts:**
- The access token refreshes automatically every 30 minutes while the server runs.
- The **refresh token expires after 7 days**, and Schwab requires a fresh login after that.
- `start.sh` checks the token on every start. If only the access token expired, it refreshes it. If the whole token has expired, it runs `setup_schwab_auth.py` for you interactively.
- To check the token by hand:

```bash
python3 server/check_schwab_token.py
```

---

## 5. Map your Schwab accounts

The dashboard needs to know which account is which tax type. It drives everything from tax estimates to Roth conversion room. Accounts are identified by the **last 3 digits** of the Schwab account number. Each one gets one of three types:

| Type | Use for |
|---|---|
| `taxable` | Regular brokerage account |
| `rollover_ira` | Traditional / rollover IRA (pre-tax) |
| `roth_ira` | Roth IRA |

**Easiest way:** start the app once (step 6). On the first data fetch the server adds every linked account to `server/account_mapping.json` with a blank type, and logs:

```
[schwab] New account ...123 added to account_mapping.json — set its type in Settings → Schwab accounts
```

Open **Settings → Schwab accounts**, pick the type for each account, save, then click **Refresh** in the header.

**By hand:** edit `server/account_mapping.json` and replace the sample suffixes with yours:

```json
{
  "_comment": "Last 3 digits of each Schwab account → taxable | rollover_ira | roth_ira",
  "123": "taxable",
  "456": "rollover_ira",
  "789": "roth_ira"
}
```

To pre-fill it from Schwab without starting the whole app:

```bash
cd server && python3 -c "import schwab_client; print(schwab_client.discover_accounts())"
```

> `personal.json` also contains a `_SCHWAB_ACCOUNTS` block from the older version. It is **not used**: `account_mapping.json` is the only source of truth.

---

## 6. Run it

```bash
source ~/Development/venv/FinancialReview/bin/activate
./start.sh
```

`start.sh`:

1. Stops anything already running on ports 8501 and 3000.
2. Checks the Schwab token and refreshes or re-authenticates it.
3. Starts the API server on **:8501**. It logs to `server/dashboard.log` and rotates the log at 10 MB.
4. Starts the UI on **:3000**. It logs to `server/dashboard-ui.log`.

Open **http://localhost:3000**. The first load takes about 30–60 seconds while the server fetches Schwab positions and yfinance prices, and the page shows a progress bar meanwhile. After that it refreshes in the background, and you can force a refresh with **Refresh** in the header. Press **Ctrl+C** to stop both servers.

Flags:

```bash
./start.sh --debug     # dump full API responses
./start.sh --verbose   # progress logging (account mapping, symbol fetching)
```

**Manual start** (two terminals, venv active in the first):

```bash
cd server && python3 -u server.py     # API on :8501
npm run dev                           # UI on :3000
```

Health check: <http://localhost:8501/api/health>

---

## Using the app: Simple vs Advanced

The toggle is top-right in the header and applies to every tab.

- **Simple:** the essentials for each tab on one page.
- **Advanced:** everything, organised so it doesn't become an endless scroll:
  - **On this tab** (left rail): each tab is split into *pages*, one per topic ("Where am I this year?", "Drift from target"). Click a page to open it, or click a section under it to jump straight there. Each row shows a status chip and its headline value.
  - **Views:** tabs with sub-tabs (Tax, Drawdown, Simulate, Trade sim, Research) show a view switcher at the top of the rail.
  - **Paging:** Prev/Next, the "Next page" card at the bottom, or **J / K** (also **← / →**).
  - **Focus / Scroll** (bottom of the rail): Focus shows one page at a time; Scroll stacks everything and the rail follows your scroll position.
  - **Find:** **⌘K** (or **/**) searches every section on every tab, including metric names inside them ("IRMAA", "bracket room", "SOXX").

Your last tab, mode, layout and the last page per tab are remembered in the browser.

---

## Optional extras

**AI tab**

- *Local:* install [Ollama](https://ollama.com) and pull a model (e.g. `ollama pull llama3`). It's auto-detected at `http://localhost:11434`.
- *Hosted:* put an OpenRouter key in `server/ai_keys.json` (`{ "your_username": "sk-or-..." }`), or add it in **Settings → AI and Ollama keys**.

**Metric explainers** (AI tooltips on metrics): `./bake.sh --regen`.
- `bake.sh` looks for a venv in a few known places. Point it at yours with:

```bash
DASHBOARD_PYTHON=~/Development/venv/FinancialReview/bin/python ./bake.sh --regen
```

**Daily email briefings** (market open / midday / close):

```bash
cd server && python3 setup_email_briefing.py
```

It asks for the dashboard URL, recipient and SMTP login, saves them to `server/smtp-credentials.json` (gitignored), sends a test email, and installs three crontab entries.
- The dashboard server must be running at those times for the emails to have data.

**Cost basis lots:** import in **Settings → Cost basis**, or edit `server/schwab_cost.json`. Used for lot-level tax signals (STCG/LTCG) on Tax › Sell and rebalance.

---

## Configuration file reference

All in `server/`, all gitignored, all editable in **Settings** once the app is running.

| File | What it holds | Settings page |
|---|---|---|
| `schwab_credentials.json` | Schwab App Key, Secret, callback URL, token path | — (edit the file) |
| `.schwab_token.json` | OAuth token, written by `setup_schwab_auth.py` | — (never edit) |
| `account_mapping.json` | Account last-3-digits → `taxable` / `rollover_ira` / `roth_ira` | Schwab accounts |
| `personal.json` | DOB, filing status, spouse, Social Security, spending, income target, Roth conversion plan, external accounts | Personal |
| `tax_brackets.json` | Federal brackets and standard deduction; **update each January** | Tax brackets |
| `target_roth.json` / `target_taxable.json` | Target weights per symbol (each file must sum to 1.0) | Roth allocation / Taxable allocation |
| `rules.json` | Withdrawal strategy, fund-type thresholds, symbol overrides | — (edit the file) |
| `ai_keys.json` | OpenRouter keys | AI and Ollama keys |
| `schwab_cost.json` | Cost-basis lots | Cost basis |
| `smtp-credentials.json` | Email briefing config, written by `setup_email_briefing.py` | — |

Runtime data (also gitignored, safe to delete to reset caches):
- `dashboard.db`: cache, balance history, alerts, lots.
- `sim_portfolios.db`: Trade sim.
- `.yfinance_cache/`: yfinance downloads.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Unable to connect to backend" | The API server isn't running on :8501. Check `server/dashboard.log`, or run `cd server && python3 server.py` to see the error. |
| `ModuleNotFoundError` (e.g. `schwab`, `yfinance`) | The venv isn't active. Run `source ~/Development/venv/FinancialReview/bin/activate`, then `pip install -r server/requirements.txt`. |
| Header shows **Schwab config** instead of **Schwab live** | Token missing or expired. Run `cd server && python3 setup_schwab_auth.py`. |
| Login works but the token step fails | The callback URL in the Schwab app and `redirect_uri` don't match exactly, or the app isn't *Ready For Use* yet. |
| "Schwab account mapping not found" | No account has a type yet. See [step 5](#5-map-your-schwab-accounts). |
| An account is missing or has the wrong values | It isn't mapped, or wasn't selected when you approved access. Re-run `setup_schwab_auth.py` and tick every account. |
| Port 3000 or 8501 already in use | `./start.sh` frees them. Or run `lsof -ti tcp:8501 \| xargs kill`. |
| Tax numbers look off in January | Update `tax_brackets.json` for the new year (Settings → Tax brackets). |
| `DeprecationWarning` lines in the log | Harmless Python warnings, not errors. `start.sh` suppresses them. |
