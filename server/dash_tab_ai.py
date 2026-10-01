def get_ai_tab_js() -> str:
    return '''
// ── AI Tab ────────────────────────────────────────────────────────────────────

let _aiState = {
    model: "cloud:kimi-k2.5",
    useLocal: false,
    localAvailable: false,
    apiKeyId: "",
    history: [],
    isLoading: false,
    usage: { requests: 0, prompt_tokens: 0, completion_tokens: 0 },
};
let _aiMarketData = null;
let _aiMarketTs   = 0;       // epoch-ms of last market fetch
let _aiPriceCache = {};      // sym → {price, ts}
let _localModelsList = [];
let _cloudModelsList = [];

function renderAITab() {
    const container = document.getElementById("tab_ai");
    if (!container) return;

    container.innerHTML = `
        <div class="ai-tab">
            <div class="section" style="margin-bottom:16px">
                <h2>🤖 AI Portfolio Assistant</h2>
                <p style="color:var(--muted);font-size:12px">
                    Ask questions about your portfolio in natural language.
                    Powered by local Ollama or cloud API.
                </p>
            </div>

            <div class="ai-controls" style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
                <div style="flex:1;min-width:200px">
                    <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Model</label>
                    <select id="ai-model-select" onchange="aiSetModel(this.value)"
                        style="width:100%;padding:8px 12px;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:6px">
                        <option value="">Loading models...</option>
                    </select>
                </div>
                <div style="flex:1;min-width:200px">
                    <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">API Key (for cloud)</label>
                    <select id="ai-api-key-select" onchange="aiSetApiKey(this.value)"
                        style="width:100%;padding:8px 12px;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:6px">
                        <option value="">Loading keys...</option>
                    </select>
                </div>
            </div>

            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;padding:8px 12px;background:var(--card);border-radius:6px">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                    <input type="checkbox" id="ai-use-local-toggle" onchange="aiToggleLocal()" style="width:18px;height:18px;cursor:pointer">
                    <span style="font-size:13px;font-weight:500">Use Local Ollama</span>
                </label>
                <div id="ai-local-status" style="font-size:12px;flex:1;text-align:right"></div>
            </div>

            <div id="ai-usage" style="display:flex;gap:16px;font-size:11px;color:var(--muted);margin-bottom:12px;padding:8px 12px;background:var(--card);border-radius:6px">
                <span>📊 Requests: <strong id="ai-req-count">0</strong></span>
                <span>📝 Prompt tokens: <strong id="ai-prompt-tokens">0</strong></span>
                <span>✨ Completion tokens: <strong id="ai-comp-tokens">0</strong></span>
            </div>
            <div id="ai-status" style="font-size:11px;color:var(--muted);margin-bottom:12px">
                Checking Ollama status...
            </div>

            <div id="ai-chat" style="height:400px;overflow-y:auto;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px">
                <div class="empty-state" style="color:var(--muted);text-align:center;padding:80px 20px">
                    Ask me anything about your portfolio...<br>
                    <span style="font-size:11px">
                        Try: "What is my total portfolio value?" or "How much room in the 22% bracket?"
                    </span>
                </div>
            </div>

            <div class="ai-input-area" style="display:flex;gap:8px">
                <input type="text" id="ai-prompt" placeholder="Ask about your portfolio..."
                    onkeydown="if(event.key===\'Enter\')aiAsk()"
                    style="flex:1;padding:12px 16px;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:8px;font-size:14px">
                <button onclick="aiAsk()" style="padding:12px 24px;background:var(--accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600">
                    Ask
                </button>
                <button onclick="aiClear()" style="padding:12px 16px;background:var(--card);color:var(--muted);border:1px solid var(--border);border-radius:8px;cursor:pointer" title="Clear chat">
                    🗑️
                </button>
            </div>

            <div class="ai-suggestions" style="margin-top:16px">
                <div style="font-size:11px;color:var(--muted);margin-bottom:6px">📝 Questions</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
                    <button onclick="aiAskSuggestion(\'What is my total portfolio value and unrealized gain/loss?\')" class="ai-suggestion-btn">Portfolio value</button>
                    <button onclick="aiAskSuggestion(\'How much room do I have in the 22% tax bracket?\')" class="ai-suggestion-btn">22% bracket room</button>
                    <button onclick="aiAskSuggestion(\'Which holding contributed most to YTD performance?\')" class="ai-suggestion-btn">Top contributor</button>
                    <button onclick="aiAskSuggestion(\'How much dividend income have I received YTD?\')" class="ai-suggestion-btn">YTD dividends</button>
                    <button onclick="aiAskSuggestion(\'What is the recommended Roth conversion amount this year and why?\')" class="ai-suggestion-btn">Roth conversion</button>
                    <button onclick="aiAskSuggestion(\'How are my option-income ETFs performing vs their yields?\')" class="ai-suggestion-btn">Income ETFs</button>
                </div>
                <div style="font-size:11px;color:var(--muted);margin-bottom:6px">📊 Charts</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <button onclick="aiAskSuggestion(\'Bar chart of my top 10 holdings by value\')" class="ai-suggestion-btn">Top holdings chart</button>
                    <button onclick="aiAskSuggestion(\'Pie chart of portfolio allocation by account\')" class="ai-suggestion-btn">Account allocation</button>
                    <button onclick="aiAskSuggestion(\'Bar chart of monthly dividend income\')" class="ai-suggestion-btn">Monthly income</button>
                    <button onclick="aiAskSuggestion(\'Chart of YTD performance by symbol\')" class="ai-suggestion-btn">YTD performance</button>
                    <button onclick="aiAskSuggestion(\'Horizontal bar chart of unrealized gain percent by symbol\')" class="ai-suggestion-btn">Gain % by symbol</button>
                </div>
            </div>
        </div>
    `;

    aiLoadModels();
    aiLoadApiKeys();
    aiCheckStatus();
    aiLoadMarketData();
}

function aiLoadModels() {
    fetch('/api/ai/models')
        .then(r => r.json())
        .then(resp => {
            const select = document.getElementById('ai-model-select');
            if (!select) return;
            
            _localModelsList = resp.local_models || [];
            _cloudModelsList = resp.cloud_models || [];
            
            // Update model lists and repopulate based on current toggle state
            aiUpdateModelSelect();
            
            // Set default based on local availability
            if (_localModelsList.length > 0 && _aiState.localAvailable) {
                // Auto-enable local mode by default
                const checkbox = document.getElementById('ai-use-local-toggle');
                if (checkbox) {
                    checkbox.checked = true;
                }
                aiToggleLocal(true); // Force local mode on
            } else if (_cloudModelsList.length > 0) {
                aiToggleLocal(false); // Force cloud mode
            }
        })
        .catch(() => {
            const select = document.getElementById('ai-model-select');
            if (select) {
                select.innerHTML = '<option value="cloud:kimi-k2.5">kimi-k2.5 (default)</option>';
                _aiState.model = 'cloud:kimi-k2.5';
                select.value = 'cloud:kimi-k2.5';
            }
        });
}

function aiUpdateModelSelect() {
    const select = document.getElementById('ai-model-select');
    if (!select) return;
    
    select.innerHTML = '';
    
    if (_aiState.useLocal && _localModelsList.length > 0) {
        // Show local models
        select.innerHTML += '<optgroup label="🏠 Local Ollama">';
        _localModelsList.forEach(m => {
            const sizeStr = m.size > 0 ? ' (' + (m.size / 1e9).toFixed(1) + 'GB)' : '';
            const selected = (m.id === _aiState.model) ? 'selected' : '';
            select.innerHTML += `<option value="${m.id}" ${selected}>${m.name}${sizeStr}</option>`;
        });
        select.innerHTML += '</optgroup>';
    } else {
        // Show cloud models
        const recommended = _cloudModelsList.filter(m => m.recommended);
        if (recommended.length > 0) {
            select.innerHTML += '<optgroup label="⭐ Recommended Cloud">';
            recommended.forEach(m => {
                const val = m.id;
                const selected = (val === _aiState.model) ? 'selected' : '';
                const lbl = m.label || m.name;
                select.innerHTML += `<option value="${val}" ${selected}>${lbl}</option>`;
            });
            select.innerHTML += '</optgroup>';
        }
        
        const others = _cloudModelsList.filter(m => !m.recommended);
        if (others.length > 0) {
            select.innerHTML += '<optgroup label="☁️ All Cloud Models">';
            others.forEach(m => {
                const val = m.id;
                const selected = (val === _aiState.model) ? 'selected' : '';
                select.innerHTML += `<option value="${val}" ${selected}>${m.name}</option>`;
            });
            select.innerHTML += '</optgroup>';
        }
        
        if (!select.innerHTML) {
            select.innerHTML = '<option value="cloud:kimi-k2.5">kimi-k2.5 (default)</option>';
            if (_aiState.model === 'cloud:kimi-k2.5') {
                select.value = 'cloud:kimi-k2.5';
            }
        }
    }
}

function aiToggleLocal(forceValue = null) {
    const checkbox = document.getElementById('ai-use-local-toggle');
    if (!checkbox) return;
    
    // Determine new state
    let newState = (forceValue !== null) ? forceValue : checkbox.checked;
    
    // If local not available and trying to enable, prevent it
    if (newState && !_aiState.localAvailable) {
        newState = false;
        checkbox.checked = false;
        aiAddMessage('assistant', '⚠️ Local Ollama is not available. Please install Ollama and pull a model first.');
        return;
    }
    
    _aiState.useLocal = newState;
    
    if (_aiState.useLocal && _localModelsList.length > 0) {
        // Switch to local mode - select first local model
        const firstLocal = _localModelsList[0];
        _aiState.model = firstLocal.id;
    } else if (!_aiState.useLocal && _cloudModelsList.length > 0) {
        // Switch to cloud mode - select first recommended cloud model, or first cloud model
        const recommended = _cloudModelsList.filter(m => m.recommended);
        if (recommended.length > 0) {
            _aiState.model = recommended[0].id;
        } else if (_cloudModelsList.length > 0) {
            _aiState.model = _cloudModelsList[0].id;
        } else {
            _aiState.model = 'cloud:kimi-k2.5';
        }
    }
    
    // Update the model dropdown
    aiUpdateModelSelect();
    
    // Update dynamic status display
    aiUpdateLocalStatusDisplay();
}

function aiUpdateLocalStatusDisplay() {
    const statusDiv = document.getElementById('ai-local-status');
    if (!statusDiv) return;
    
    if (_aiState.useLocal && _aiState.localAvailable) {
        statusDiv.innerHTML = '✅ Using local Ollama';
        statusDiv.style.color = 'var(--green)';
    } else if (!_aiState.useLocal && _aiState.localAvailable) {
        statusDiv.innerHTML = '☁️ Using cloud API';
        statusDiv.style.color = 'var(--blue)';
    } else if (!_aiState.localAvailable) {
        statusDiv.innerHTML = '❌ Local not available';
        statusDiv.style.color = 'var(--red)';
    }
}

function aiCheckStatus() {
    fetch('/api/ai/status')
        .then(r => r.json())
        .then(resp => {
            const status = document.getElementById('ai-status');
            const checkbox = document.getElementById('ai-use-local-toggle');
            
            if (!status) return;
            
            if (resp.ollama_running) {
                _aiState.localAvailable = true;
                status.innerHTML = '✅ Local Ollama running';
                status.style.color = 'var(--green)';
                
                if (checkbox) {
                    checkbox.disabled = false;
                    // Auto-enable local if it's available and we have local models
                    if (_localModelsList.length > 0 && !_aiState.useLocal && _aiState.usage.requests === 0) {
                        checkbox.checked = true;
                        aiToggleLocal(true);
                    }
                }
            } else {
                _aiState.localAvailable = false;
                _aiState.useLocal = false;
                status.innerHTML = '⚠️ Local Ollama not running — using cloud API';
                status.style.color = 'var(--orange)';
                
                if (checkbox) {
                    checkbox.disabled = true;
                    checkbox.checked = false;
                }
                
                // Switch to cloud mode
                aiToggleLocal(false);
            }
            
            // Update the dynamic status display
            aiUpdateLocalStatusDisplay();
        })
        .catch(() => {
            _aiState.localAvailable = false;
            _aiState.useLocal = false;
            const checkbox = document.getElementById('ai-use-local-toggle');
            if (checkbox) {
                checkbox.disabled = true;
                checkbox.checked = false;
            }
            aiUpdateLocalStatusDisplay();
        });
}

function aiLoadApiKeys() {
    fetch('/api/ai/keys')
        .then(r => r.json())
        .then(resp => {
            const select = document.getElementById('ai-api-key-select');
            if (!select) return;
            const keys = resp.keys || [];
            select.innerHTML = '<option value="">— select key —</option>';
            keys.forEach((k, i) => {
                const sel = (i === 0 && !_aiState.apiKeyId) ? 'selected' : (k === _aiState.apiKeyId ? 'selected' : '');
                select.innerHTML += `<option value="${k}" ${sel}>${k}</option>`;
            });
            if (keys.length > 0 && !_aiState.apiKeyId) {
                _aiState.apiKeyId = keys[0];
            }
        })
        .catch(() => {
            const select = document.getElementById('ai-api-key-select');
            if (select) select.innerHTML = '<option value="">No keys available</option>';
        });
}

function aiSetModel(model) {
    _aiState.model = model;
}

function aiSetApiKey(keyId) {
    _aiState.apiKeyId = keyId;
}

// ── Market & live price helpers ───────────────────────────────────────────────

// Called on tab open — does NOT block; market data loads in background
function aiLoadMarketData() {} // lazy: only fetch when a question actually needs it

const _BENCHMARK_SYMS = { 'spy':'SPY','s&p 500':'SPY','s&p500':'SPY','sp500':'SPY',
    'qqq':'QQQ','nasdaq':'QQQ','iwm':'IWM','russell':'IWM','small cap':'IWM',
    'schd':'SCHD','agg':'AGG','bond':'AGG','bonds':'AGG',
    'vix':'^VIX','10 year':'^TNX','10-year':'^TNX','treasury':'^TNX','dow':'^DJI' };

function aiParseMarketRequest(prompt) {
    const lc = prompt.toLowerCase();
    const symbols = new Set(['SPY','QQQ']);
    Object.entries(_BENCHMARK_SYMS).forEach(([kw,sym]) => { if (lc.includes(kw)) symbols.add(sym); });
    const periods = new Set();
    if (lc.includes('ytd') || lc.includes('year to date') || lc.includes('this year')) periods.add('ytd');
    if (/1[ -]?month|one month/.test(lc)) periods.add('1m');
    if (/3[ -]?month|three month|quarter/.test(lc)) periods.add('3m');
    if (/6[ -]?month|six month|half year/.test(lc)) periods.add('6m');
    if (/1[ -]?year|one year|annual/.test(lc)) periods.add('1y');
    if (periods.size === 0) { periods.add('ytd'); periods.add('6m'); }
    return { symbols: [...symbols], periods: [...periods] };
}

function aiNeedsMarketFetch(prompt) {
    const lc = prompt.toLowerCase();
    return Object.keys(_BENCHMARK_SYMS).concat(
        ['vs market','compare to','benchmark','vs index','beat the market','correlation','outperform','underperform','beta']
    ).some(kw => lc.includes(kw));
}

// Fetch benchmark data only when needed; cache for 5 minutes
async function aiEnsureMarketData(prompt) {
    if (!aiNeedsMarketFetch(prompt)) return;
    const now = Date.now();
    if (_aiMarketData && (now - _aiMarketTs) < 300000) return; // 5-min cache
    const req = aiParseMarketRequest(prompt);
    try {
        const resp = await fetch('/api/ai/market', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req),
        });
        const mdata = await resp.json();
        if (mdata.success) { _aiMarketData = Object.assign(_aiMarketData || {}, mdata.market); _aiMarketTs = now; }
    } catch(e) {}
}

// Common non-ticker uppercase words to ignore
const _NOT_TICKERS = new Set([
    'YTD','ETF','IRA','USA','GDP','CPI','FED','NAV','RSI','CEO','CFO',
    'LLC','INC','LTD','NYSE','NASDAQ','SEC','ESG','AI','API','APR','APY',
    'MLP','REIT','BDC','YOY','QOQ','MOM','TTM','EPS','PE','PB','ROE',
    'ROA','AUM','IPO','SPAC','ETFs','REITs','Q1','Q2','Q3','Q4','US',
    'UI','ID','OK','TA','IV','PA','MA','CA','TX','NY','FL',
]);

// Extract uppercase ticker-like tokens from prompt not already in portfolio
function aiExtractUnknownSymbols(prompt) {
    const owned = new Set((window._portfolio?.accounts || [])
        .flatMap(a => (a.positions || []).map(p => p.symbol)));
    const benchmarks = new Set(Object.values(_BENCHMARK_SYMS));
    const tokens = prompt.match(/[A-Z][A-Z0-9.-]{0,5}/g) || [];
    return [...new Set(tokens)].filter(t =>
        t.length >= 2 && !owned.has(t) && !benchmarks.has(t) && !_NOT_TICKERS.has(t)
    );
}

// Fetch live price + basic info for symbols not in portfolio; cache results
async function aiEnsureSymbolPrices(prompt) {
    const syms = aiExtractUnknownSymbols(prompt);
    if (!syms.length) return;
    const now = Date.now();
    const stale = syms.filter(s => !_aiPriceCache[s] || (now - _aiPriceCache[s].ts) > 300000);
    if (!stale.length) return;
    try {
        const resp = await fetch('/api/ai/price', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbols: stale }),
        });
        const pdata = await resp.json();
        if (pdata.success) {
            Object.entries(pdata.prices || {}).forEach(([sym, info]) => {
                _aiPriceCache[sym] = Object.assign({ ts: now }, info);
            });
        }
    } catch(e) {}
}

// ── Chart detection & spec builder ───────────────────────────────────────────
const _CHART_KEYWORDS = [
    'chart', 'plot', 'graph', 'visualize', 'show me a', 'draw a',
    'bar chart', 'pie chart', 'line chart', 'doughnut',
];

function aiDetectChart(prompt) {
    const lc = prompt.toLowerCase();
    return _CHART_KEYWORDS.some(kw => lc.includes(kw));
}

// Build chart spec from prompt keywords — no AI round-trip, instant & reliable
function aiLocalChartSpec(prompt) {
    const lc = prompt.toLowerCase();
    const isPie  = lc.includes('pie');
    const isDnut = lc.includes('donut') || lc.includes('doughnut');
    const isLine = lc.includes('line');
    const isHoriz = lc.includes('horizontal') || lc.includes('h-bar');
    const barType = isHoriz ? 'horizontal_bar' : 'bar';
    const topNm = lc.match(/top[ ]*([0-9]+)/);
    const topN = topNm ? parseInt(topNm[1]) : 10;

    if (lc.includes('monthly') || (lc.includes('income') && lc.includes('month'))) {
        return { chart_type: isLine ? 'line' : 'bar', data_source: 'monthly_income',
                 metric: 'value', label: 'month', title: 'Monthly Dividend Income',
                 color_mode: 'blue', limit: 12 };
    }
    if (lc.includes('income') || lc.includes('dividend')) {
        return { chart_type: isLine ? 'line' : 'bar', data_source: 'monthly_income',
                 metric: 'value', label: 'month', title: 'Monthly Dividend Income',
                 color_mode: 'blue', limit: 12 };
    }
    if (lc.includes('gain') || lc.includes('unrealized') || lc.includes('profit')) {
        return { chart_type: 'horizontal_bar', data_source: 'gains_by_symbol',
                 metric: 'gainPct', label: 'symbol', title: 'Unrealized Gain % by Symbol',
                 color_mode: 'pnl', limit: 15 };
    }
    if (lc.includes('ytd') || lc.includes('year to date')) {
        return { chart_type: 'horizontal_bar', data_source: 'performance_ytd',
                 metric: 'value', label: 'symbol', title: 'YTD Return % by Symbol',
                 color_mode: 'pnl', limit: 15 };
    }
    if (lc.includes('3 month') || lc.includes('3m') || lc.includes('three month')) {
        return { chart_type: 'horizontal_bar', data_source: 'performance_3m',
                 metric: 'value', label: 'symbol', title: '3-Month Return % by Symbol',
                 color_mode: 'pnl', limit: 15 };
    }
    if (lc.includes('1 month') || lc.includes('1m') || lc.includes('one month')) {
        return { chart_type: 'horizontal_bar', data_source: 'performance_1m',
                 metric: 'value', label: 'symbol', title: '1-Month Return % by Symbol',
                 color_mode: 'pnl', limit: 15 };
    }
    if (lc.includes('performance') || lc.includes('return')) {
        return { chart_type: 'horizontal_bar', data_source: 'performance_ytd',
                 metric: 'value', label: 'symbol', title: 'YTD Performance by Symbol',
                 color_mode: 'pnl', limit: 15 };
    }
    if (lc.includes('account') || lc.includes('by account')) {
        return { chart_type: isPie ? 'pie' : isDnut ? 'doughnut' : 'pie',
                 data_source: 'accounts', metric: 'value', label: 'label',
                 title: 'Portfolio by Account', color_mode: 'rainbow', limit: 10 };
    }
    // Default: top holdings by value
    return { chart_type: isPie ? 'pie' : isDnut ? 'doughnut' : barType,
             data_source: 'top_holdings', metric: 'value', label: 'symbol',
             title: `Top ${topN} Holdings by Value`, color_mode: 'pnl', limit: topN };
}

// Build Chart.js data arrays from window._portfolio using the AI spec
function aiBuildChartData(spec) {
    const p = window._portfolio || {};
    const src = spec.data_source || 'top_holdings';
    const limit = spec.limit || 10;
    const metric = spec.metric || 'value';
    const labelKey = spec.label || 'symbol';
    let rows = [];

    if (src === 'top_holdings' || src === 'gains_by_symbol') {
        (p.accounts || []).forEach(a => {
            (a.positions || []).forEach(pos => {
                const price = pos.current_price || pos.price || 0;
                const shares = pos.shares || 0;
                const val = shares * price;
                const costPer = pos.cost_basis || pos.cost_per_share || 0;
                const cost = costPer * shares;
                const gain = val - cost;
                const gainPct = cost > 0 ? (gain / cost * 100) : 0;
                rows.push({ symbol: pos.symbol, value: val, cost, gain, gainPct, account: a.label });
            });
        });
        if (src === 'gains_by_symbol') rows.sort((a, b) => Math.abs(b.gainPct) - Math.abs(a.gainPct));
        else rows.sort((a, b) => b.value - a.value);

    } else if (src === 'accounts') {
        rows = (p.accounts || []).map(a => ({
            label: a.label, value: a.value || 0, cost: a.cost || 0,
            pnl: a.pnl || 0, pnl_pct: a.pnl_pct || 0,
        }));

    } else if (src === 'monthly_income') {
        const monthly = (p.income_history || {}).monthly || {};
        rows = Object.entries(monthly).map(([month, value]) => ({ month, value }));
        rows = rows.slice(-limit);

    } else if (src === 'performance_ytd' || src === 'performance_1m' || src === 'performance_3m') {
        const keyMap = { performance_ytd: 'ytd', performance_1m: 'ret_1m', performance_3m: 'ret_3m' };
        const perfKey = keyMap[src];
        const syms = (window._perfData || {}).symbols || {};
        rows = Object.entries(syms)
            .map(([symbol, s]) => ({ symbol, value: parseFloat(s[perfKey]) || 0 }))
            .filter(r => r.value !== 0)
            .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

        // Fallback: _perfData not loaded yet — use unrealized gain % from positions
        if (!rows.length) {
            (p.accounts || []).forEach(a => {
                (a.positions || []).forEach(pos => {
                    const price = pos.current_price || pos.price || 0;
                    const val = (pos.shares || 0) * price;
                    const costPer = pos.cost_basis || pos.cost_per_share || 0;
                    const cost = costPer * (pos.shares || 0);
                    const gainPct = cost > 0 ? (val - cost) / cost * 100 : 0;
                    if (gainPct !== 0) rows.push({ symbol: pos.symbol, value: gainPct });
                });
            });
            rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
            if (rows.length && spec) spec.title = (spec.title || 'Performance') + ' (gain % from cost — open Performance tab for YTD)';
        }
    }

    rows = rows.slice(0, limit);
    if (!rows.length) return null;

    const labels = rows.map(r => r[labelKey] || r.symbol || r.month || r.label || '?');
    const values = rows.map(r => {
        const v = r[metric];
        return typeof v === 'number' ? Math.round(v * 100) / 100 : 0;
    });
    return { labels, values, rows };
}

// Render a Chart.js chart inside the chat; returns HTML string
function aiRenderChart(spec) {
    const chartData = aiBuildChartData(spec);
    if (!chartData) return '<div style="color:var(--muted);font-size:13px">No data found for this chart.</div>';

    const { labels, values } = chartData;
    const cid = 'ai_chart_' + Date.now();
    const rawType = spec.chart_type || 'bar';
    const chartType = rawType === 'horizontal_bar' ? 'bar' : rawType;
    const isHoriz = rawType === 'horizontal_bar';
    const isPolar = chartType === 'pie' || chartType === 'doughnut';

    const palette = [
        'rgba(0,184,148,0.8)','rgba(0,122,255,0.8)','rgba(253,203,110,0.8)',
        'rgba(162,155,254,0.8)','rgba(116,185,255,0.8)','rgba(255,118,117,0.8)',
        'rgba(253,121,168,0.8)','rgba(85,239,196,0.8)',
    ];
    let bgColors;
    if (spec.color_mode === 'pnl') {
        bgColors = values.map(v => v >= 0 ? 'rgba(0,184,148,0.8)' : 'rgba(214,48,49,0.8)');
    } else if (spec.color_mode === 'rainbow' || isPolar) {
        bgColors = labels.map((_, i) => palette[i % palette.length]);
    } else {
        bgColors = 'rgba(0,122,255,0.8)';
    }

    const html = `<div style="position:relative;height:280px;margin-top:12px;background:var(--bg);border-radius:8px;padding:12px 12px 8px;border:1px solid var(--border)">
  <canvas id="${cid}"></canvas>
</div>`;

    setTimeout(() => {
        const ctx = document.getElementById(cid)?.getContext('2d');
        if (!ctx) return;
        new Chart(ctx, {
            type: chartType,
            data: {
                labels,
                datasets: [{
                    label: spec.title || 'Portfolio',
                    data: values,
                    backgroundColor: bgColors,
                    borderRadius: isPolar ? 0 : 4,
                    borderColor: isPolar ? '#16213e' : undefined,
                    borderWidth: isPolar ? 2 : 0,
                }]
            },
            options: {
                indexAxis: isHoriz ? 'y' : 'x',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: isPolar, labels: { color: '#dfe6e9', font: { size: 11 } } },
                    title: { display: !!spec.title, text: spec.title, color: '#dfe6e9', font: { size: 13, weight: '600' } },
                    tooltip: {
                        backgroundColor: '#16213e',
                        borderColor: '#2d3436',
                        borderWidth: 1,
                    },
                },
                scales: isPolar ? {} : {
                    x: { ticks: { color: '#dfe6e9', font: { size: 11 } }, grid: { display: false } },
                    y: { ticks: { color: '#636e72', font: { size: 11 } }, grid: { color: '#2d343622' } },
                },
            },
        });
    }, 60);

    return html;
}

async function aiAsk() {
    const input = document.getElementById('ai-prompt');
    const prompt = input ? input.value.trim() : '';
    if (!prompt || _aiState.isLoading) return;

    aiAddMessage('user', prompt);
    input.value = '';
    _aiState.isLoading = true;

    const sendBtn = document.querySelector('button[onclick="aiAsk()"]');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.innerHTML = '⏳'; }

    const wantsChart = aiDetectChart(prompt);

    // Fetch any needed market/symbol data before building context
    await Promise.all([aiEnsureMarketData(prompt), aiEnsureSymbolPrices(prompt)]);
    const context = aiBuildContext();

    if (wantsChart) {
        // Render chart immediately from local data — no AI call needed for the visual
        const spec = aiLocalChartSpec(prompt);
        const chartHtml = aiRenderChart(spec);
        const analysisId = 'ai_analysis_' + Date.now();
        aiAddMessage('assistant',
            chartHtml + `<div id="${analysisId}" style="margin-top:10px;font-size:12px;color:var(--muted)">Analyzing...</div>`,
            true);

        // Fire a brief text analysis alongside the chart
        fetch('/api/ai/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: `In 2-3 sentences, give key insights for: "${prompt}". Use specific numbers. Do not narrate the chart.`,
                model: _aiState.model,
                apiKeyId: _aiState.apiKeyId,
                context: context,
            }),
        })
        .then(r => r.json())
        .then(resp => {
            _aiState.isLoading = false;
            if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = 'Ask'; }
            const el = document.getElementById(analysisId);
            if (el) {
                if (resp.success && resp.response) {
                    el.style.color = 'var(--text)';
                    el.style.whiteSpace = 'pre-wrap';
                    el.textContent = resp.response;
                    if (resp.usage) {
                        _aiState.usage.requests += 1;
                        _aiState.usage.prompt_tokens  += resp.usage.prompt_tokens  || 0;
                        _aiState.usage.completion_tokens += resp.usage.completion_tokens || 0;
                        aiUpdateUsage();
                    }
                } else {
                    el.remove();
                }
            }
        })
        .catch(() => {
            _aiState.isLoading = false;
            if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = 'Ask'; }
            const el = document.getElementById(analysisId);
            if (el) el.remove();
        });
        return;
    }

    fetch('/api/ai/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt: prompt,
            model: _aiState.model,
            apiKeyId: _aiState.apiKeyId,
            context: context,
        }),
    })
    .then(r => r.json())
    .then(resp => {
        _aiState.isLoading = false;
        if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = 'Ask'; }
        if (resp.success) {
            aiAddMessage('assistant', resp.response);
            if (resp.usage) {
                _aiState.usage.requests += 1;
                _aiState.usage.prompt_tokens += resp.usage.prompt_tokens || 0;
                _aiState.usage.completion_tokens += resp.usage.completion_tokens || 0;
                aiUpdateUsage();
            }
        } else {
            aiAddMessage('assistant', `❌ Error: ${resp.error}`);
        }
    })
    .catch(e => {
        _aiState.isLoading = false;
        if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = 'Ask'; }
        aiAddMessage('assistant', `❌ Network error: ${e.message}`);
    });
}

function aiAskSuggestion(prompt) {
    const input = document.getElementById('ai-prompt');
    if (input) input.value = prompt;
    aiAsk();
}

// ── Context builder ───────────────────────────────────────────────────────────

function aiBuildContext() {
    if (!window._portfolio) return 'No portfolio data available.';
    const p = window._portfolio;
    const tx = window._taxData || p.tax_data || p.summary || {};
    let ctx = '';

    // ── Portfolio totals ──────────────────────────────────────────────────
    ctx += '=== PORTFOLIO SUMMARY ===\\n';
    const accts = p.accounts || [];
    let totVal = 0, totCost = 0;
    accts.forEach(a => { totVal += a.value || 0; totCost += a.cost || 0; });
    const totPnl = totVal - totCost;
    const totPct = totCost > 0 ? (totPnl / totCost * 100) : 0;
    ctx += `Total Value: $${fmt(totVal)}\\n`;
    ctx += `Total Cost Basis: $${fmt(totCost)}\\n`;
    ctx += `Unrealized P&L: ${totPnl >= 0 ? '+' : '-'}$${fmt(Math.abs(totPnl))} (${totPnl >= 0 ? '+' : ''}${totPct.toFixed(2)}%)\\n`;

    // ── Per-account summary ───────────────────────────────────────────────
    ctx += '\\n=== ACCOUNTS ===\\n';
    accts.forEach(a => {
        const pnl = (a.pnl != null) ? a.pnl : (a.value - a.cost);
        const pct = (a.pnl_pct != null) ? a.pnl_pct : (a.cost > 0 ? pnl / a.cost * 100 : 0);
        ctx += `${a.label}: $${fmt(a.value)} | Cost $${fmt(a.cost)} | P&L ${pnl >= 0 ? '+' : '-'}$${fmt(Math.abs(pnl))} (${pnl >= 0 ? '+' : ''}${pct.toFixed(2)}%)\\n`;
    });

    // ── All positions by account ──────────────────────────────────────────
    ctx += '\\n=== POSITIONS BY ACCOUNT ===\\n';
    const allPos = [];
    accts.forEach(a => {
        const label = a.label || 'Account';
        ctx += `\\n[${label}]\\n`;
        (a.positions || []).forEach(pos => {
            const price = pos.current_price || pos.price || 0;
            const shares = pos.shares || 0;
            const mktVal = shares * price;
            const costPer = pos.cost_basis || pos.cost_per_share || 0;
            const totalCost = costPer * shares;
            const gain = mktVal - totalCost;
            const gainPct = totalCost > 0 ? (gain / totalCost * 100) : 0;
            ctx += `  ${pos.symbol}: ${shares.toFixed(3)} sh @ $${price.toFixed(2)} = $${fmt(mktVal)}`;
            if (totalCost > 0) ctx += ` | Cost $${fmt(totalCost)} | ${gain >= 0 ? '+' : '-'}$${fmt(Math.abs(gain))} (${gainPct.toFixed(1)}%)`;
            ctx += '\\n';
            allPos.push({ symbol: pos.symbol, shares, value: mktVal, cost: totalCost, gain, gainPct, account: label });
        });
    });

    // ── Top holdings by value ─────────────────────────────────────────────
    ctx += '\\n=== TOP HOLDINGS (by value) ===\\n';
    [...allPos].sort((a, b) => b.value - a.value).slice(0, 15).forEach((pos, i) => {
        const pct = totVal > 0 ? (pos.value / totVal * 100) : 0;
        ctx += `${i + 1}. ${pos.symbol}: $${fmt(pos.value)} (${pct.toFixed(1)}% of portfolio) | ${pos.gain >= 0 ? '+' : '-'}$${fmt(Math.abs(pos.gain))} (${pos.gainPct.toFixed(1)}%) [${pos.account}]\\n`;
    });

    // ── Tax planning ──────────────────────────────────────────────────────
    ctx += '\\n=== TAX PLANNING ===\\n';
    if (tx.gross_no_ss != null) ctx += `Gross Income (ex-SS): $${fmt(tx.gross_no_ss)}\\n`;
    if (tx.taxable_income != null) ctx += `Taxable Income: $${fmt(tx.taxable_income)}\\n`;
    if (tx.fed_tax_rate != null) ctx += `Effective Fed Rate: ${tx.fed_tax_rate}%\\n`;
    if (tx.target_bracket_ceiling != null) ctx += `22% Bracket Ceiling: $${fmt(tx.target_bracket_ceiling)}\\n`;
    if (tx.bracket_room != null) ctx += `22% Bracket Room: $${fmt(tx.bracket_room)}\\n`;
    if (tx.converted_ytd != null) ctx += `Roth Conversions YTD: $${fmt(tx.converted_ytd)}\\n`;
    const convTarget = tx.exec_conv_target || tx.dynamic_conv_recommended || tx.annual_conversion;
    if (convTarget != null) ctx += `Recommended Conversion: $${fmt(convTarget)}\\n`;
    if (tx.quarterly_est_total != null) ctx += `Quarterly Tax Est. Total: $${fmt(tx.quarterly_est_total)}\\n`;
    if (tx.ltcg_rate != null) ctx += `LTCG Rate: ${tx.ltcg_rate}%\\n`;
    if (tx.niit_applies) ctx += `NIIT (3.8%) applies\\n`;

    // ── Income / dividends ────────────────────────────────────────────────
    ctx += '\\n=== INCOME / DIVIDENDS ===\\n';
    const ih = p.income_history || {};
    if (ih.ytd_total != null) ctx += `YTD Dividend Income: $${fmt(ih.ytd_total)}\\n`;
    const byAcct = ih.by_account || {};
    Object.entries(byAcct).forEach(([acct, d]) => {
        if (d && d.total > 0) ctx += `  ${acct}: $${fmt(d.total)}\\n`;
    });
    if (ih.monthly) {
        ctx += 'Monthly (last 6): ';
        const months = Object.entries(ih.monthly).slice(-6);
        ctx += months.map(([m, v]) => `${m}: $${fmt(v)}`).join(' | ') + '\\n';
    }

    // ── Target vs current allocation ──────────────────────────────────────
    const rothTA = p.roth_target_analysis || {};
    const taxTA = p.taxable_target_analysis || {};
    if (Object.keys(rothTA).length || Object.keys(taxTA).length) {
        ctx += '\\n=== TARGET ALLOCATION ===\\n';
        const renderTA = (label, ta) => {
            if (!ta || !Object.keys(ta).length) return;
            ctx += `[${label}]\\n`;
            Object.entries(ta).forEach(([sym, info]) => {
                const cur = (info.current_pct != null) ? info.current_pct.toFixed(1) : '?';
                const tgt = (info.target_pct != null) ? info.target_pct.toFixed(1) : '?';
                const diff = (info.diff_pct != null) ? (info.diff_pct >= 0 ? '+' : '') + info.diff_pct.toFixed(1) : '';
                ctx += `  ${sym}: current ${cur}% | target ${tgt}%${diff ? ' | diff ' + diff + '%' : ''}\\n`;
            });
        };
        renderTA('Roth', rothTA);
        renderTA('Taxable', taxTA);
    }

    // ── Performance data ──────────────────────────────────────────────────
    const perf = window._perfData || {};
    if (perf.symbols && Object.keys(perf.symbols).length > 0) {
        ctx += '\\n=== PERFORMANCE ===\\n';
        Object.entries(perf.symbols).slice(0, 20).forEach(([sym, s]) => {
            const parts = [];
            if (s.ytd != null) parts.push(`YTD ${s.ytd}`);
            if (s.ret_1m != null) parts.push(`1M ${s.ret_1m}`);
            if (s.ret_3m != null) parts.push(`3M ${s.ret_3m}`);
            if (s.ret_6m != null) parts.push(`6M ${s.ret_6m}`);
            if (s.ret_1y != null) parts.push(`1Y ${s.ret_1y}`);
            if (parts.length) ctx += `  ${sym}: ${parts.join(' | ')}\\n`;
        });
        if (perf.benchmark) {
            const b = perf.benchmark;
            const bparts = [];
            if (b.spy_ytd != null) bparts.push(`YTD ${b.spy_ytd}`);
            if (b.spy_1y != null) bparts.push(`1Y ${b.spy_1y}`);
            if (b.sharpe_ratio != null) bparts.push(`Sharpe ${b.sharpe_ratio}`);
            if (bparts.length) ctx += `  SPY (benchmark): ${bparts.join(' | ')}\\n`;
        }
    }

    // ── Research snapshots ────────────────────────────────────────────────
    if (p.snapshots && Object.keys(p.snapshots).length > 0) {
        ctx += '\\n=== RESEARCH SNAPSHOTS ===\\n';
        Object.entries(p.snapshots).slice(0, 15).forEach(([sym, snap]) => {
            const parts = [];
            if (snap.rsi != null) parts.push(`RSI ${snap.rsi}`);
            if (snap.trend) parts.push(snap.trend);
            if (snap.nav != null) parts.push(`NAV $${snap.nav}`);
            if (snap.premium_discount_pct != null) {
                parts.push(`P/D ${snap.premium_discount_pct >= 0 ? '+' : ''}${snap.premium_discount_pct.toFixed(2)}%`);
            }
            if (snap.yield_ttm != null) parts.push(`Yield ${snap.yield_ttm.toFixed(2)}%`);
            if (parts.length) ctx += `  ${sym}: ${parts.join(' | ')}\\n`;
        });
    }

    // ── Live prices for symbols mentioned but not in portfolio ────────────
    const cachedSyms = Object.entries(_aiPriceCache);
    if (cachedSyms.length > 0) {
        ctx += '\\n=== LIVE PRICES (on-demand) ===\\n';
        cachedSyms.forEach(([sym, d]) => {
            const parts = [`$${d.price}`];
            if (d.change_pct != null) parts.push(`${d.change_pct >= 0 ? '+' : ''}${d.change_pct.toFixed(2)}% today`);
            if (d.ytd != null) parts.push(`YTD ${d.ytd >= 0 ? '+' : ''}${d.ytd.toFixed(2)}%`);
            if (d.market_cap != null) parts.push(`MCap $${fmt(d.market_cap)}`);
            if (d.name) parts.push(d.name);
            ctx += `  ${sym}: ${parts.join(' | ')}\\n`;
        });
    }

    // ── Market benchmarks (live) ──────────────────────────────────────────
    if (_aiMarketData && Object.keys(_aiMarketData).length > 0) {
        ctx += '\\n=== MARKET BENCHMARKS (live prices + returns) ===\\n';
        ctx += 'Use this section to compare portfolio performance to market benchmarks.\\n';
        Object.entries(_aiMarketData).forEach(([sym, d]) => {
            const parts = [`$${d.price}`];
            if (d.ytd   != null) parts.push(`YTD ${d.ytd   >= 0 ? '+' : ''}${d.ytd.toFixed(2)}%`);
            if (d.ret_1m != null) parts.push(`1M ${d.ret_1m >= 0 ? '+' : ''}${d.ret_1m.toFixed(2)}%`);
            if (d.ret_6m != null) parts.push(`6M ${d.ret_6m >= 0 ? '+' : ''}${d.ret_6m.toFixed(2)}%`);
            if (d.ret_1y != null) parts.push(`1Y ${d.ret_1y >= 0 ? '+' : ''}${d.ret_1y.toFixed(2)}%`);
            ctx += `  ${sym}: ${parts.join(' | ')}\\n`;
        });
    }

    // ── Decisions / alerts ────────────────────────────────────────────────
    const decisions = p.decisions || [];
    if (decisions.length > 0) {
        ctx += '\\n=== ALERTS / DECISIONS ===\\n';
        decisions.slice(0, 10).forEach(d => {
            ctx += `  [${d.level || 'INFO'}] ${d.symbol || ''} ${d.message || d.text || ''}\\n`;
        });
    }

    return ctx;
}

function aiAddMessage(role, content, isHtml = false) {
    const chat = document.getElementById('ai-chat');
    if (!chat) return;
    const empty = chat.querySelector('.empty-state');
    if (empty) empty.remove();

    const msg = document.createElement('div');
    msg.style.cssText = 'margin-bottom:16px;padding:12px;border-radius:8px;word-wrap:break-word';

    if (role === 'user') {
        msg.style.background = 'rgba(0,122,255,0.1)';
        msg.style.border = '1px solid rgba(0,122,255,0.3)';
        msg.innerHTML = `<div style="font-size:11px;color:#007AFF;margin-bottom:4px;font-weight:600">You</div>${aiEscapeHtml(content)}`;
    } else {
        msg.style.cssText += ';white-space:pre-wrap';
        msg.style.background = 'var(--card)';
        msg.style.border = '1px solid var(--border)';
        const body = isHtml ? content : aiEscapeHtml(content);
        msg.innerHTML = `<div style="font-size:11px;color:var(--muted);margin-bottom:4px;font-weight:600">🤖 Assistant</div>${body}`;
        if (isHtml) msg.style.whiteSpace = 'normal';
    }

    chat.appendChild(msg);
    chat.scrollTop = chat.scrollHeight;
    _aiState.history.push({ role, content: isHtml ? '[chart]' : content });
}

function aiEscapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function aiUpdateUsage() {
    const rc = document.getElementById('ai-req-count');
    const pt = document.getElementById('ai-prompt-tokens');
    const ct = document.getElementById('ai-comp-tokens');
    if (rc) rc.textContent = _aiState.usage.requests;
    if (pt) pt.textContent = _aiState.usage.prompt_tokens.toLocaleString();
    if (ct) ct.textContent = _aiState.usage.completion_tokens.toLocaleString();
}

function aiClear() {
    const chat = document.getElementById('ai-chat');
    if (chat) {
        chat.innerHTML = `<div class="empty-state" style="color:var(--muted);text-align:center;padding:80px 20px">
            Ask me anything about your portfolio...<br>
            <span style="font-size:11px">Try: "What is my total portfolio value?" or "How much room in the 22% bracket?"</span>
        </div>`;
    }
    _aiState.history = [];
}
'''


# ── Server API endpoints ─────────────────────────────────────────────────────

def handle_ai_request(path: str, method: str, data: dict = None):
    """Handle AI-related API requests."""
    if path == '/api/ai/status':
        from ollama_client import is_ollama_running
        return {'ollama_running': is_ollama_running()}

    elif path == '/api/ai/keys':
        from ollama_client import get_api_key_names
        return {'keys': get_api_key_names()}

    elif path == '/api/ai/models':
        from ollama_client import get_available_models
        models = get_available_models()
        return {
            'local_models':  [m for m in models if m.get('source') == 'local'],
            'cloud_models':  [m for m in models if m.get('source') == 'cloud'],
        }

    elif path == '/api/ai/price' and method == 'POST':
        symbols = (data or {}).get('symbols', [])
        if not symbols:
            return {'success': False, 'error': 'No symbols provided', 'prices': {}}
        try:
            import yfinance as yf
            prices = {}
            for sym in symbols[:10]:
                try:
                    t = yf.Ticker(sym)
                    fi = t.fast_info
                    entry: dict = {}
                    if hasattr(fi, 'last_price') and fi.last_price:
                        entry['price'] = round(float(fi.last_price), 2)
                    if hasattr(fi, 'regular_market_previous_close') and fi.regular_market_previous_close:
                        prev = fi.regular_market_previous_close
                        cur  = fi.last_price or prev
                        entry['change_pct'] = round((cur - prev) / prev * 100, 2) if prev else None
                    if hasattr(fi, 'market_cap') and fi.market_cap:
                        entry['market_cap'] = fi.market_cap
                    # YTD via 1-year history
                    hist = t.history(period='1y')
                    if not hist.empty:
                        closes = hist['Close']
                        cur_p  = float(closes.iloc[-1])
                        yr     = closes.index[-1].year
                        soy    = closes[closes.index.year == yr]
                        if not soy.empty:
                            entry['ytd'] = round((cur_p - float(soy.iloc[0])) / float(soy.iloc[0]) * 100, 2)
                    info = t.info
                    entry['name'] = info.get('shortName') or info.get('longName') or sym
                    entry['sector'] = info.get('sector', '')
                    if 'price' in entry:
                        prices[sym] = entry
                except Exception:
                    pass
            return {'success': True, 'prices': prices}
        except Exception as e:
            return {'success': False, 'error': str(e), 'prices': {}}

    elif path == '/api/ai/market':
        # Accepts optional POST body: {"symbols": [...], "periods": ["ytd","1m","3m","6m","1y"]}
        try:
            import yfinance as yf
            import pandas as pd

            symbols = (data or {}).get('symbols') or ['SPY', 'QQQ', 'IWM', 'SCHD', 'AGG', '^VIX', '^TNX']
            want_periods = set((data or {}).get('periods') or ['ytd', '1m', '6m', '1y'])
            period_months = {'1m': 1, '3m': 3, '6m': 6, '1y': 12}

            market = {}
            for sym in symbols:
                try:
                    hist = yf.Ticker(sym).history(period='2y')
                    if hist.empty:
                        continue
                    closes = hist['Close']
                    cur = float(closes.iloc[-1])
                    last_dt = closes.index[-1]
                    entry: dict = {'price': round(cur, 2)}

                    # YTD
                    if 'ytd' in want_periods:
                        soy = closes[closes.index.year == last_dt.year]
                        ytd_start = float(soy.iloc[0]) if not soy.empty else cur
                        entry['ytd'] = round((cur - ytd_start) / ytd_start * 100, 2)

                    # Period returns via exact date offset
                    for label, months in period_months.items():
                        if label not in want_periods:
                            continue
                        target_dt = last_dt - pd.DateOffset(months=months)
                        idx = closes.index.searchsorted(target_dt)
                        idx = min(max(idx, 0), len(closes) - 1)
                        past_price = float(closes.iloc[idx])
                        entry[f'ret_{label}'] = round((cur - past_price) / past_price * 100, 2)

                    market[sym] = entry
                except Exception:
                    pass
            return {'success': True, 'market': market}
        except Exception as e:
            return {'success': False, 'error': str(e), 'market': {}}

    elif path == '/api/ai/chart' and method == 'POST':
        from ollama_client import query_chart_spec
        prompt     = (data or {}).get('prompt', '')
        model      = (data or {}).get('model', 'cloud:kimi-k2.5')
        api_key_id = (data or {}).get('apiKeyId', '')

        if not prompt:
            return {'success': False, 'error': 'No prompt provided'}

        return query_chart_spec(prompt=prompt, model=model, api_key_id=api_key_id)

    elif path == '/api/ai/query' and method == 'POST':
        from ollama_client import query_with_data
        prompt     = (data or {}).get('prompt', '')
        model      = (data or {}).get('model', 'cloud:kimi-k2.5')
        context    = (data or {}).get('context', '')
        api_key_id = (data or {}).get('apiKeyId', '')

        if not prompt:
            return {'success': False, 'error': 'No prompt provided'}

        return query_with_data(
            prompt=prompt,
            data_context=context,
            model=model,
            api_key_id=api_key_id,
        )

    return None