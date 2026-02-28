import { useState, useMemo, useCallback } from "react";

const INITIAL_BALANCE = 100000;

const defaultTrade = {
  date: new Date().toISOString().split("T")[0],
  pair: "USD/JPY",
  dailyDir: "UP",
  h4Dir: "UP",
  h1Push: "",
  m15Push: "",
  breakQuality: "A",
  spacePips: "",
  timeScore: "",
  riskPct: 2,
  rr: "",
  resultR: "",
};

const scoreWeights = {
  alignment: (d, h4) => (d === h4 ? 30 : 0),
  breakQuality: (q) => ({ A: 30, B: 20, C: 10 }[q] || 0),
  space: (s) => (s >= 50 ? 20 : s >= 30 ? 10 : 0),
  time: (t) => Math.min(Number(t) || 0, 20),
};

function calcScore(t) {
  return (
    scoreWeights.alignment(t.dailyDir, t.h4Dir) +
    scoreWeights.breakQuality(t.breakQuality) +
    scoreWeights.space(Number(t.spacePips) || 0) +
    scoreWeights.time(t.timeScore)
  );
}

function getMode(trades, balance, initialBalance) {
  if (trades.length === 0) return "NORMAL";

  const recent10 = trades.slice(-10);
  const avgR =
    recent10.reduce((s, t) => s + (Number(t.resultR) || 0), 0) /
    Math.max(recent10.length, 1);

  const maxBal = trades.reduce(
    (m, t) => Math.max(m, t.balance),
    initialBalance
  );
  const dd = ((maxBal - balance) / maxBal) * 100;

  const lastTrades = trades.slice(-3);
  const consecutive3Losses = lastTrades.every(
    (t) => (Number(t.resultR) || 0) < 0
  );

  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthTrades = trades.filter((t) => t.date?.startsWith(currentMonth));
  const monthPnl = monthTrades.reduce((s, t) => s + (t.pnl || 0), 0);
  const monthLoss = (monthPnl / initialBalance) * 100;

  if (dd >= 10) return "STOPPED";
  if (monthLoss <= -5) return "DEFENSE";
  if (consecutive3Losses) return "NORMAL";
  if (avgR > 0.5 && dd < 5) return "ATTACK";
  return "NORMAL";
}

function getModeConfig(mode) {
  return {
    STOPPED: { label: "強制停止", risk: 0, color: "#ff2d55", bg: "#2d0010", border: "#ff2d55" },
    DEFENSE: { label: "守備モード", risk: 1, color: "#ff9500", bg: "#2d1a00", border: "#ff9500" },
    NORMAL: { label: "通常モード", risk: 2, color: "#30d158", bg: "#001a08", border: "#30d158" },
    ATTACK: { label: "攻撃モード", risk: 3, color: "#0a84ff", bg: "#00102d", border: "#0a84ff" },
  }[mode];
}

export default function App() {
  const [trades, setTrades] = useState([]);
  const [form, setForm] = useState(defaultTrade);
  const [tab, setTab] = useState("dashboard");
  const [editId, setEditId] = useState(null);

  const balance = useMemo(() => {
    if (trades.length === 0) return INITIAL_BALANCE;
    return trades[trades.length - 1].balance;
  }, [trades]);

  const mode = useMemo(() => getMode(trades, balance, INITIAL_BALANCE), [trades, balance]);
  const modeConfig = getModeConfig(mode);

  const stats = useMemo(() => {
    if (trades.length === 0)
      return { winRate: 0, avgR: 0, expectancy: 0, maxDD: 0, totalR: 0, streak: 0 };

    const wins = trades.filter((t) => (Number(t.resultR) || 0) > 0);
    const losses = trades.filter((t) => (Number(t.resultR) || 0) < 0);
    const winRate = wins.length / trades.length;
    const avgWinR =
      wins.length > 0
        ? wins.reduce((s, t) => s + Number(t.resultR), 0) / wins.length
        : 0;
    const expectancy = winRate * avgWinR - (1 - winRate) * 1;
    const totalR = trades.reduce((s, t) => s + (Number(t.resultR) || 0), 0);

    let maxBal = INITIAL_BALANCE;
    let maxDD = 0;
    for (const t of trades) {
      maxBal = Math.max(maxBal, t.balance);
      const dd = ((maxBal - t.balance) / maxBal) * 100;
      maxDD = Math.max(maxDD, dd);
    }

    let streak = 0;
    for (let i = trades.length - 1; i >= 0; i--) {
      if ((Number(trades[i].resultR) || 0) < 0) streak++;
      else break;
    }

    return { winRate, avgWinR, expectancy, maxDD, totalR, streak, winCount: wins.length, lossCount: losses.length };
  }, [trades]);

  const handleAdd = useCallback(() => {
    if (!form.resultR || !form.rr) return;
    const score = calcScore(form);
    const prevBalance = trades.length > 0 ? trades[trades.length - 1].balance : INITIAL_BALANCE;
    const riskAmt = prevBalance * (Number(form.riskPct) / 100);
    const pnl = Number(form.resultR) * riskAmt;
    const newBalance = prevBalance + pnl;
    const trade = {
      ...form,
      id: Date.now(),
      score,
      pnl,
      balance: newBalance,
      win: Number(form.resultR) > 0,
    };
    setTrades((prev) => [...prev, trade]);
    setForm({ ...defaultTrade, date: new Date().toISOString().split("T")[0] });
  }, [form, trades]);

  const handleDelete = (id) => setTrades((prev) => prev.filter((t) => t.id !== id));

  const profitPct = ((balance - INITIAL_BALANCE) / INITIAL_BALANCE) * 100;
  const currentDD =
    trades.length > 0
      ? (() => {
          const maxBal = trades.reduce((m, t) => Math.max(m, t.balance), INITIAL_BALANCE);
          return ((maxBal - balance) / maxBal) * 100;
        })()
      : 0;

  const suggestedLot = mode === "STOPPED" ? 0 : modeConfig.risk;

  return (
    <div style={{ fontFamily: "'JetBrains Mono', 'Courier New', monospace", background: "#080c10", minHeight: "100vh", color: "#c8d0db", padding: "0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Orbitron:wght@400;700;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0d1117; } ::-webkit-scrollbar-thumb { background: #30d158; border-radius: 2px; }
        .tab-btn { background: none; border: none; cursor: pointer; font-family: inherit; font-size: 11px; letter-spacing: 2px; padding: 10px 20px; transition: all 0.2s; }
        .tab-btn.active { color: #30d158; border-bottom: 2px solid #30d158; }
        .tab-btn:not(.active) { color: #4a5568; border-bottom: 2px solid transparent; }
        .tab-btn:hover:not(.active) { color: #718096; }
        input, select { background: #0d1117; border: 1px solid #1a2332; color: #c8d0db; font-family: inherit; font-size: 12px; padding: 8px 10px; border-radius: 4px; outline: none; transition: border-color 0.2s; }
        input:focus, select:focus { border-color: #30d158; }
        .btn-primary { background: #30d158; color: #000; border: none; padding: 10px 24px; border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 11px; font-weight: 700; letter-spacing: 2px; transition: all 0.2s; }
        .btn-primary:hover { background: #25a244; transform: translateY(-1px); }
        .btn-primary:disabled { background: #1a2332; color: #4a5568; cursor: not-allowed; transform: none; }
        .card { background: #0d1117; border: 1px solid #1a2332; border-radius: 8px; padding: 20px; }
        .metric-val { font-family: 'Orbitron', monospace; font-weight: 700; }
        .pulse { animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
        .trade-row:hover { background: #111820 !important; }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: "1px solid #1a2332", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0a0f14" }}>
        <div>
          <div style={{ fontFamily: "'Orbitron',monospace", fontSize: 18, fontWeight: 900, color: "#30d158", letterSpacing: 3 }}>FX AUTOPILOT</div>
          <div style={{ fontSize: 9, color: "#4a5568", letterSpacing: 4, marginTop: 2 }}>CAPITAL MANAGEMENT SYSTEM</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              background: modeConfig.bg,
              border: `1px solid ${modeConfig.border}`,
              borderRadius: 6,
              padding: "8px 20px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 9, color: modeConfig.color, letterSpacing: 3, opacity: 0.7 }}>CURRENT MODE</div>
            <div style={{ fontFamily: "'Orbitron',monospace", fontWeight: 700, color: modeConfig.color, fontSize: 14, letterSpacing: 2 }}
              className={mode === "STOPPED" ? "pulse" : ""}
            >
              {modeConfig.label}
            </div>
            <div style={{ fontSize: 10, color: modeConfig.color, opacity: 0.8, marginTop: 2 }}>
              推奨リスク: {modeConfig.risk}%
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: "1px solid #1a2332", padding: "0 24px", display: "flex" }}>
        {["dashboard", "entry", "trades"].map((t) => (
          <button key={t} className={`tab-btn ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t === "dashboard" ? "DASHBOARD" : t === "entry" ? "新規エントリー" : "トレード履歴"}
          </button>
        ))}
      </div>

      <div style={{ padding: "24px", maxWidth: 1200, margin: "0 auto" }}>

        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <div>
            {/* KPI Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
              {[
                { label: "現在残高", val: `¥${balance.toLocaleString()}`, sub: `${profitPct >= 0 ? "+" : ""}${profitPct.toFixed(2)}%`, color: profitPct >= 0 ? "#30d158" : "#ff2d55" },
                { label: "総トレード", val: trades.length, sub: `勝${stats.winCount} 負${stats.lossCount}`, color: "#c8d0db" },
                { label: "勝率", val: `${(stats.winRate * 100).toFixed(1)}%`, sub: stats.winCount > 0 ? `平均RR ${stats.avgWinR?.toFixed(2)}` : "—", color: stats.winRate >= 0.5 ? "#30d158" : "#ff9500" },
                { label: "期待値", val: `${stats.expectancy >= 0 ? "+" : ""}${stats.expectancy.toFixed(3)}R`, sub: `累計 ${stats.totalR >= 0 ? "+" : ""}${stats.totalR.toFixed(2)}R`, color: stats.expectancy >= 0 ? "#30d158" : "#ff2d55" },
              ].map((m, i) => (
                <div key={i} className="card">
                  <div style={{ fontSize: 9, color: "#4a5568", letterSpacing: 3, marginBottom: 8 }}>{m.label}</div>
                  <div className="metric-val" style={{ fontSize: 22, color: m.color }}>{m.val}</div>
                  <div style={{ fontSize: 11, color: "#4a5568", marginTop: 4 }}>{m.sub}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              {/* DD & Streak */}
              <div className="card">
                <div style={{ fontSize: 9, color: "#4a5568", letterSpacing: 3, marginBottom: 16 }}>リスク指標</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {[
                    { label: "現在DD", val: `${currentDD.toFixed(2)}%`, warn: currentDD >= 5, limit: "限界 10%" },
                    { label: "最大DD", val: `${stats.maxDD.toFixed(2)}%`, warn: stats.maxDD >= 5, limit: "記録" },
                    { label: "連敗数", val: `${stats.streak}連敗`, warn: stats.streak >= 3, limit: "限界 3" },
                    { label: "推奨ロット", val: `${suggestedLot}%リスク`, warn: mode === "STOPPED", limit: modeConfig.label },
                  ].map((r, i) => (
                    <div key={i} style={{ background: "#080c10", border: `1px solid ${r.warn ? "#ff2d55" : "#1a2332"}`, borderRadius: 6, padding: 12 }}>
                      <div style={{ fontSize: 9, color: "#4a5568", letterSpacing: 2, marginBottom: 6 }}>{r.label}</div>
                      <div className="metric-val" style={{ fontSize: 18, color: r.warn ? "#ff2d55" : "#c8d0db" }}>{r.val}</div>
                      <div style={{ fontSize: 10, color: "#4a5568", marginTop: 4 }}>{r.limit}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Mode Conditions */}
              <div className="card">
                <div style={{ fontSize: 9, color: "#4a5568", letterSpacing: 3, marginBottom: 16 }}>攻撃モード条件チェック</div>
                {(() => {
                  const recent10 = trades.slice(-10);
                  const avgR = recent10.length > 0
                    ? recent10.reduce((s, t) => s + (Number(t.resultR) || 0), 0) / recent10.length
                    : 0;
                  const conds = [
                    { label: "直近10回 平均R > 0.5", ok: avgR > 0.5, val: `${avgR.toFixed(3)}R` },
                    { label: "ドローダウン < 5%", ok: currentDD < 5, val: `${currentDD.toFixed(2)}%` },
                    { label: "連敗3未満", ok: stats.streak < 3, val: `${stats.streak}連敗` },
                    { label: "月間損失 > -5%", ok: true, val: "算出中..." },
                  ];
                  return conds.map((c, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < conds.length - 1 ? "1px solid #1a2332" : "none" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.ok ? "#30d158" : "#ff2d55" }} />
                        <span style={{ fontSize: 11 }}>{c.label}</span>
                      </div>
                      <span style={{ fontSize: 11, color: c.ok ? "#30d158" : "#ff2d55" }}>{c.val}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>

            {/* Equity Curve */}
            {trades.length > 0 && (
              <div className="card">
                <div style={{ fontSize: 9, color: "#4a5568", letterSpacing: 3, marginBottom: 16 }}>資金曲線</div>
                <div style={{ height: 160, position: "relative", overflow: "hidden" }}>
                  <svg width="100%" height="100%" viewBox={`0 0 ${Math.max(trades.length + 1, 10)} 100`} preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="equity-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#30d158" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#30d158" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {(() => {
                      const allBals = [INITIAL_BALANCE, ...trades.map((t) => t.balance)];
                      const minB = Math.min(...allBals);
                      const maxB = Math.max(...allBals);
                      const range = maxB - minB || 1;
                      const points = allBals.map((b, i) => `${i},${100 - ((b - minB) / range) * 90 - 5}`).join(" ");
                      const areaPoints = `0,100 ${points} ${allBals.length - 1},100`;
                      return (
                        <>
                          <polyline points={`0,${100 - ((INITIAL_BALANCE - minB) / range) * 90 - 5} ${allBals.length - 1},${100 - ((INITIAL_BALANCE - minB) / range) * 90 - 5}`}
                            stroke="#1a2332" strokeWidth="0.3" strokeDasharray="1,1" fill="none" />
                          <polygon points={areaPoints} fill="url(#equity-grad)" />
                          <polyline points={points} stroke="#30d158" strokeWidth="0.5" fill="none" />
                          <circle cx={allBals.length - 1} cy={100 - ((allBals[allBals.length - 1] - minB) / range) * 90 - 5}
                            r="1" fill="#30d158" />
                        </>
                      );
                    })()}
                  </svg>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ENTRY FORM */}
        {tab === "entry" && (
          <div style={{ maxWidth: 700 }}>
            {/* Mode indicator */}
            <div style={{ background: modeConfig.bg, border: `1px solid ${modeConfig.border}`, borderRadius: 8, padding: "14px 20px", marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 9, color: modeConfig.color, letterSpacing: 3 }}>AUTOPILOT MODE</div>
                <div style={{ fontFamily: "'Orbitron',monospace", fontWeight: 700, color: modeConfig.color, fontSize: 16 }}>{modeConfig.label}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 9, color: modeConfig.color, opacity: 0.7, letterSpacing: 2 }}>推奨リスク</div>
                <div className="metric-val" style={{ fontSize: 28, color: modeConfig.color }}>{modeConfig.risk}%</div>
              </div>
            </div>

            <div className="card">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {[
                  { label: "日付", key: "date", type: "date" },
                  { label: "通貨ペア", key: "pair", type: "text", ph: "USD/JPY" },
                ].map((f) => (
                  <div key={f.key}>
                    <div style={{ fontSize: 9, color: "#4a5568", letterSpacing: 2, marginBottom: 4 }}>{f.label}</div>
                    <input type={f.type} value={form[f.key]} placeholder={f.ph}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} style={{ width: "100%" }} />
                  </div>
                ))}

                {[
                  { label: "日足方向", key: "dailyDir", opts: ["UP", "DOWN", "RANGE"] },
                  { label: "4時間足方向", key: "h4Dir", opts: ["UP", "DOWN", "RANGE"] },
                  { label: "ブレイク質", key: "breakQuality", opts: ["A", "B", "C"] },
                ].map((f) => (
                  <div key={f.key}>
                    <div style={{ fontSize: 9, color: "#4a5568", letterSpacing: 2, marginBottom: 4 }}>{f.label}</div>
                    <select value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} style={{ width: "100%" }}>
                      {f.opts.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                ))}

                {[
                  { label: "1H押し%", key: "h1Push", ph: "例: 50" },
                  { label: "15M押し%", key: "m15Push", ph: "例: 30" },
                  { label: "空間pips", key: "spacePips", ph: "例: 40" },
                  { label: "時間帯スコア (0-20)", key: "timeScore", ph: "例: 15" },
                  { label: "RR", key: "rr", ph: "例: 2.5" },
                  { label: "結果R (+1/-1/+2...)", key: "resultR", ph: "例: +2" },
                ].map((f) => (
                  <div key={f.key}>
                    <div style={{ fontSize: 9, color: "#4a5568", letterSpacing: 2, marginBottom: 4 }}>{f.label}</div>
                    <input type="number" value={form[f.key]} placeholder={f.ph}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} style={{ width: "100%" }} />
                  </div>
                ))}

                <div>
                  <div style={{ fontSize: 9, color: "#4a5568", letterSpacing: 2, marginBottom: 4 }}>リスク% (自動推奨: {modeConfig.risk}%)</div>
                  <input type="number" value={form.riskPct} step="0.5" min="0" max="5"
                    onChange={(e) => setForm({ ...form, riskPct: e.target.value })} style={{ width: "100%" }} />
                </div>
              </div>

              {/* Preview */}
              {form.resultR && form.rr && (
                <div style={{ marginTop: 16, background: "#080c10", border: "1px solid #1a2332", borderRadius: 6, padding: 14 }}>
                  <div style={{ fontSize: 9, color: "#4a5568", letterSpacing: 3, marginBottom: 8 }}>プレビュー計算</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                    {(() => {
                      const score = calcScore(form);
                      const riskAmt = balance * (Number(form.riskPct) / 100);
                      const pnl = Number(form.resultR) * riskAmt;
                      const newBal = balance + pnl;
                      return [
                        { label: "スコア", val: `${score}/100` },
                        { label: "リスク額", val: `¥${riskAmt.toFixed(0)}` },
                        { label: "損益", val: `${pnl >= 0 ? "+" : ""}¥${pnl.toFixed(0)}`, color: pnl >= 0 ? "#30d158" : "#ff2d55" },
                        { label: "新残高", val: `¥${newBal.toFixed(0)}` },
                      ].map((p, i) => (
                        <div key={i}>
                          <div style={{ fontSize: 9, color: "#4a5568", letterSpacing: 2 }}>{p.label}</div>
                          <div className="metric-val" style={{ fontSize: 14, color: p.color || "#c8d0db", marginTop: 2 }}>{p.val}</div>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}

              <div style={{ marginTop: 16 }}>
                <button className="btn-primary" onClick={handleAdd} disabled={!form.resultR || !form.rr || mode === "STOPPED"}>
                  {mode === "STOPPED" ? "⚠ 強制停止中 — エントリー不可" : "▶ トレード記録"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TRADES */}
        {tab === "trades" && (
          <div>
            <div style={{ fontSize: 9, color: "#4a5568", letterSpacing: 3, marginBottom: 12 }}>
              全{trades.length}件のトレード
            </div>
            {trades.length === 0 ? (
              <div className="card" style={{ textAlign: "center", color: "#4a5568", padding: 40 }}>
                トレードなし — エントリータブから記録してください
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #1a2332" }}>
                      {["日付", "ペア", "スコア", "リスク%", "RR", "結果R", "損益", "残高", ""].map((h) => (
                        <th key={h} style={{ textAlign: "left", padding: "8px 10px", fontSize: 9, color: "#4a5568", letterSpacing: 2, fontWeight: 400 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...trades].reverse().map((t) => (
                      <tr key={t.id} className="trade-row" style={{ borderBottom: "1px solid #1a2332" }}>
                        <td style={{ padding: "10px" }}>{t.date}</td>
                        <td style={{ padding: "10px" }}>{t.pair}</td>
                        <td style={{ padding: "10px" }}>
                          <span style={{ background: t.score >= 70 ? "#001a08" : t.score >= 50 ? "#2d1a00" : "#2d0010", color: t.score >= 70 ? "#30d158" : t.score >= 50 ? "#ff9500" : "#ff2d55", padding: "2px 8px", borderRadius: 3, fontSize: 10 }}>{t.score}</span>
                        </td>
                        <td style={{ padding: "10px" }}>{t.riskPct}%</td>
                        <td style={{ padding: "10px" }}>{t.rr}</td>
                        <td style={{ padding: "10px", color: Number(t.resultR) > 0 ? "#30d158" : "#ff2d55" }}>
                          {Number(t.resultR) > 0 ? "+" : ""}{t.resultR}R
                        </td>
                        <td style={{ padding: "10px", color: t.pnl >= 0 ? "#30d158" : "#ff2d55" }}>
                          {t.pnl >= 0 ? "+" : ""}¥{t.pnl.toFixed(0)}
                        </td>
                        <td style={{ padding: "10px" }}>¥{t.balance.toFixed(0)}</td>
                        <td style={{ padding: "10px" }}>
                          <button onClick={() => handleDelete(t.id)}
                            style={{ background: "none", border: "1px solid #1a2332", color: "#4a5568", cursor: "pointer", padding: "2px 8px", borderRadius: 3, fontSize: 10, fontFamily: "inherit" }}>
                            削除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
