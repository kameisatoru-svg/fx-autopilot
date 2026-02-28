// @ts-nocheck
import { useState, useMemo, useCallback, useEffect } from "react";

const INITIAL_BALANCE = 100000;

const defaultForm = {
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

function calcScore(t) {
  const align = t.dailyDir === t.h4Dir ? 30 : 0;
  const bq = { A: 30, B: 20, C: 10 }[t.breakQuality] || 0;
  const sp = Number(t.spacePips) >= 50 ? 20 : Number(t.spacePips) >= 30 ? 10 : 0;
  const ts = Math.min(Number(t.timeScore) || 0, 20);
  return align + bq + sp + ts;
}

function getMode(trades, balance) {
  if (trades.length === 0) return "NORMAL";
  const recent10 = trades.slice(-10);
  const avgR = recent10.reduce((s, t) => s + (Number(t.resultR) || 0), 0) / Math.max(recent10.length, 1);
  const maxBal = trades.reduce((m, t) => Math.max(m, t.balance), INITIAL_BALANCE);
  const dd = ((maxBal - balance) / maxBal) * 100;
  const last3 = trades.slice(-3);
  const con3loss = last3.length === 3 && last3.every(t => (Number(t.resultR) || 0) < 0);
  const month = new Date().toISOString().slice(0, 7);
  const monthPnl = trades.filter(t => t.date?.startsWith(month)).reduce((s, t) => s + (t.pnl || 0), 0);
  if (dd >= 10) return "STOPPED";
  if ((monthPnl / INITIAL_BALANCE) * 100 <= -5) return "DEFENSE";
  if (con3loss) return "NORMAL";
  if (avgR > 0.5 && dd < 5) return "ATTACK";
  return "NORMAL";
}

const MODE_CFG = {
  STOPPED: { label: "強制停止", risk: 0, color: "#b91c1c", bg: "#fef2f2", border: "#fca5a5", emoji: "🛑" },
  DEFENSE: { label: "守備モード", risk: 1, color: "#c2410c", bg: "#fff7ed", border: "#fdba74", emoji: "🛡️" },
  NORMAL:  { label: "通常モード", risk: 2, color: "#15803d", bg: "#f0fdf4", border: "#86efac", emoji: "⚡" },
  ATTACK:  { label: "攻撃モード", risk: 3, color: "#1d4ed8", bg: "#eff6ff", border: "#93c5fd", emoji: "🚀" },
};

export default function App() {
  const [trades, setTrades] = useState(() => {
    try {
      const saved = localStorage.getItem("fx_trades");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [form, setForm] = useState(defaultForm);
  const [tab, setTab] = useState("dash");
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    try { localStorage.setItem("fx_trades", JSON.stringify(trades)); } catch {}
  }, [trades]);

  const balance = useMemo(() =>
    trades.length > 0 ? trades[trades.length - 1].balance : INITIAL_BALANCE,
    [trades]);

  const mode = useMemo(() => getMode(trades, balance), [trades, balance]);
  const cfg = MODE_CFG[mode];

  const currentDD = useMemo(() => {
    if (trades.length === 0) return 0;
    const maxBal = trades.reduce((m, t) => Math.max(m, t.balance), INITIAL_BALANCE);
    return ((maxBal - balance) / maxBal) * 100;
  }, [trades, balance]);

  const stats = useMemo(() => {
    if (trades.length === 0) return { winRate: 0, avgWinR: 0, expectancy: 0, maxDD: 0, totalR: 0, streak: 0, wins: 0, losses: 0 };
    const wins = trades.filter(t => (Number(t.resultR) || 0) > 0);
    const losses = trades.filter(t => (Number(t.resultR) || 0) < 0);
    const winRate = wins.length / trades.length;
    const avgWinR = wins.length > 0 ? wins.reduce((s, t) => s + Number(t.resultR), 0) / wins.length : 0;
    const expectancy = winRate * avgWinR - (1 - winRate);
    const totalR = trades.reduce((s, t) => s + (Number(t.resultR) || 0), 0);
    let maxBal = INITIAL_BALANCE, maxDD = 0;
    for (const t of trades) {
      maxBal = Math.max(maxBal, t.balance);
      maxDD = Math.max(maxDD, ((maxBal - t.balance) / maxBal) * 100);
    }
    let streak = 0;
    for (let i = trades.length - 1; i >= 0; i--) {
      if ((Number(trades[i].resultR) || 0) < 0) streak++;
      else break;
    }
    return { winRate, avgWinR, expectancy, maxDD, totalR, streak, wins: wins.length, losses: losses.length };
  }, [trades]);

  const handleAdd = useCallback(() => {
    if (!form.resultR || !form.rr) return;
    const score = calcScore(form);
    const prevBal = trades.length > 0 ? trades[trades.length - 1].balance : INITIAL_BALANCE;
    const riskAmt = prevBal * (Number(form.riskPct) / 100);
    const pnl = Number(form.resultR) * riskAmt;
    setTrades(prev => [...prev, {
      ...form, id: Date.now(), score, pnl, balance: prevBal + pnl, win: Number(form.resultR) > 0
    }]);
    setForm({ ...defaultForm, date: new Date().toISOString().split("T")[0] });
    setTab("dash");
  }, [form, trades]);

  const profitPct = ((balance - INITIAL_BALANCE) / INITIAL_BALANCE) * 100;

  const S = {
    wrap: { fontFamily: "'Hiragino Sans', 'Noto Sans JP', sans-serif", background: "#f8fafc", minHeight: "100vh", fontSize: 14 },
    header: { background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 },
    modeBadge: { background: cfg.bg, border: `1.5px solid ${cfg.border}`, borderRadius: 10, padding: "6px 14px", textAlign: "center" },
    tabs: { background: "#fff", borderBottom: "1px solid #e2e8f0", display: "flex", overflowX: "auto" },
    tab: (active) => ({ background: "none", border: "none", borderBottom: active ? "2.5px solid #2563eb" : "2.5px solid transparent", color: active ? "#2563eb" : "#94a3b8", padding: "10px 16px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }),
    card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, marginBottom: 12 },
    label: { fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 4, display: "block", letterSpacing: 0.5 },
    input: { width: "100%", padding: "9px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 14, fontFamily: "inherit", background: "#fff", color: "#1e293b", outline: "none" },
    btnGreen: { background: "#16a34a", color: "#fff", border: "none", padding: "13px 0", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", fontSize: 15, fontWeight: 700, width: "100%", marginTop: 16 },
    btnStopped: { background: "#dc2626", color: "#fff", border: "none", padding: "13px 0", borderRadius: 10, cursor: "not-allowed", fontFamily: "inherit", fontSize: 14, fontWeight: 700, width: "100%", marginTop: 16 },
  };

  const preview = useMemo(() => {
    if (!form.resultR || !form.rr) return null;
    const riskAmt = balance * (Number(form.riskPct) / 100);
    const pnl = Number(form.resultR) * riskAmt;
    return { score: calcScore(form), riskAmt, pnl, newBal: balance + pnl };
  }, [form, balance]);

  const recent10 = trades.slice(-10);
  const avgR10 = recent10.length > 0 ? recent10.reduce((s, t) => s + (Number(t.resultR) || 0), 0) / recent10.length : 0;

  return (
    <div style={S.wrap}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input:focus, select:focus { border-color: #2563eb !important; box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }
        .pulse { animation: pulse 1.5s infinite; }
        ::-webkit-scrollbar { height: 4px; } ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 2px; }
      `}</style>

      {/* Header */}
      <div style={S.header}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>📊 FX Autopilot</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>¥{balance.toLocaleString()} ({profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}%)</div>
        </div>
        <div style={S.modeBadge}>
          <div style={{ fontSize: 10, color: cfg.color, fontWeight: 700 }}>現在のモード</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: cfg.color }} className={mode === "STOPPED" ? "pulse" : ""}>{cfg.emoji} {cfg.label}</div>
          <div style={{ fontSize: 11, color: cfg.color, opacity: 0.8 }}>リスク {cfg.risk}%</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={S.tabs}>
        {[["dash","📈 ダッシュ"],["entry","✏️ 記録"],["list","📋 履歴"],["cond","⚡ 条件"]].map(([t,l]) => (
          <button key={t} style={S.tab(tab===t)} onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>

      <div style={{ padding: "16px", maxWidth: 600, margin: "0 auto" }}>

        {/* DASHBOARD */}
        {tab === "dash" && (
          <>
            {/* KPI 2x2 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              {[
                { label: "現在残高", val: `¥${balance.toLocaleString()}`, sub: `${profitPct >= 0 ? "+" : ""}${profitPct.toFixed(2)}%`, color: profitPct >= 0 ? "#15803d" : "#b91c1c" },
                { label: "勝率", val: `${(stats.winRate * 100).toFixed(1)}%`, sub: `${stats.wins}勝 ${stats.losses}敗`, color: stats.winRate >= 0.5 ? "#15803d" : "#c2410c" },
                { label: "期待値", val: `${stats.expectancy >= 0 ? "+" : ""}${stats.expectancy.toFixed(3)}R`, sub: `累計 ${stats.totalR >= 0 ? "+" : ""}${stats.totalR.toFixed(1)}R`, color: stats.expectancy >= 0 ? "#15803d" : "#b91c1c" },
                { label: "最大DD", val: `${stats.maxDD.toFixed(2)}%`, sub: `現在 ${currentDD.toFixed(2)}%`, color: stats.maxDD >= 5 ? "#b91c1c" : "#1d4ed8" },
              ].map((m, i) => (
                <div key={i} style={{ ...S.card, borderLeft: `4px solid ${m.color}`, marginBottom: 0 }}>
                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginBottom: 6 }}>{m.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: m.color }}>{m.val}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 3 }}>{m.sub}</div>
                </div>
              ))}
            </div>

            {/* Risk row */}
            <div style={{ ...S.card, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {[
                { label: "連敗数", val: `${stats.streak}連敗`, warn: stats.streak >= 3 },
                { label: "現在DD", val: `${currentDD.toFixed(1)}%`, warn: currentDD >= 5 },
                { label: "推奨リスク", val: `${cfg.risk}%`, warn: mode === "STOPPED" },
              ].map((r, i) => (
                <div key={i} style={{ textAlign: "center", background: r.warn ? "#fef2f2" : "#f8fafc", borderRadius: 8, padding: "10px 6px" }}>
                  <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>{r.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: r.warn ? "#b91c1c" : "#1e293b", marginTop: 4 }}>{r.val}</div>
                </div>
              ))}
            </div>

            {/* Equity Curve */}
            {trades.length > 1 && (
              <div style={S.card}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 10 }}>📈 資金曲線</div>
                <div style={{ height: 120 }}>
                  <svg width="100%" height="100%" viewBox={`0 0 ${trades.length + 1} 100`} preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#16a34a" stopOpacity="0.2"/>
                        <stop offset="100%" stopColor="#16a34a" stopOpacity="0"/>
                      </linearGradient>
                    </defs>
                    {(() => {
                      const all = [INITIAL_BALANCE, ...trades.map(t => t.balance)];
                      const min = Math.min(...all), max = Math.max(...all), range = max - min || 1;
                      const y = b => 100 - ((b - min) / range) * 85 - 7;
                      const pts = all.map((b, i) => `${i},${y(b)}`).join(" ");
                      return (<>
                        <line x1="0" y1={y(INITIAL_BALANCE)} x2={all.length - 1} y2={y(INITIAL_BALANCE)} stroke="#e2e8f0" strokeWidth="0.5" strokeDasharray="1"/>
                        <polygon points={`0,100 ${pts} ${all.length-1},100`} fill="url(#g)"/>
                        <polyline points={pts} stroke="#16a34a" strokeWidth="0.8" fill="none" strokeLinejoin="round"/>
                        <circle cx={all.length - 1} cy={y(all[all.length - 1])} r="1.5" fill="#16a34a"/>
                      </>);
                    })()}
                  </svg>
                </div>
              </div>
            )}

            {trades.length === 0 && (
              <div style={{ ...S.card, textAlign: "center", color: "#94a3b8", padding: 40 }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>📭</div>
                まだトレードがありません<br/>
                <span style={{ fontSize: 13 }}>「✏️ 記録」タブから追加してください</span>
              </div>
            )}
          </>
        )}

        {/* ENTRY */}
        {tab === "entry" && (
          <>
            <div style={{ background: cfg.bg, border: `2px solid ${cfg.border}`, borderRadius: 12, padding: "14px 16px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 11, color: cfg.color, fontWeight: 700 }}>オートパイロット判定</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: cfg.color }}>{cfg.emoji} {cfg.label}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: cfg.color, opacity: 0.7 }}>推奨リスク</div>
                <div style={{ fontSize: 36, fontWeight: 900, color: cfg.color, lineHeight: 1 }}>{cfg.risk}<span style={{ fontSize: 18 }}>%</span></div>
                <div style={{ fontSize: 11, color: cfg.color, opacity: 0.7 }}>≈ ¥{(balance * cfg.risk / 100).toFixed(0)}</div>
              </div>
            </div>

            <div style={S.card}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={S.label}>日付</label>
                  <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} style={S.input}/>
                </div>
                <div>
                  <label style={S.label}>通貨ペア</label>
                  <input type="text" value={form.pair} placeholder="USD/JPY" onChange={e => setForm({...form, pair: e.target.value})} style={S.input}/>
                </div>
                {[
                  { label: "日足方向", key: "dailyDir", opts: ["UP","DOWN","RANGE"] },
                  { label: "4時間足方向", key: "h4Dir", opts: ["UP","DOWN","RANGE"] },
                  { label: "ブレイク質", key: "breakQuality", opts: ["A","B","C"] },
                ].map(f => (
                  <div key={f.key}>
                    <label style={S.label}>{f.label}</label>
                    <select value={form[f.key]} onChange={e => setForm({...form, [f.key]: e.target.value})} style={S.input}>
                      {f.opts.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
                {[
                  { label: "空間 pips", key: "spacePips", ph: "例: 40" },
                  { label: "時間帯スコア (0〜20)", key: "timeScore", ph: "例: 15" },
                  { label: "RR", key: "rr", ph: "例: 2.5" },
                  { label: "結果R (+2, -1...)", key: "resultR", ph: "例: +2" },
                ].map(f => (
                  <div key={f.key}>
                    <label style={S.label}>{f.label}</label>
                    <input type="number" value={form[f.key]} placeholder={f.ph} onChange={e => setForm({...form, [f.key]: e.target.value})} style={S.input}/>
                  </div>
                ))}
                <div style={{ gridColumn: "1/-1" }}>
                  <label style={S.label}>リスク % （推奨: {cfg.risk}%）</label>
                  <input type="number" value={form.riskPct} step="0.5" min="0" max="5" onChange={e => setForm({...form, riskPct: e.target.value})} style={S.input}/>
                </div>
              </div>

              {preview && (
                <div style={{ marginTop: 14, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12 }}>
                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 8 }}>📋 計算プレビュー</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, textAlign: "center" }}>
                    {[
                      { label: "スコア", val: `${preview.score}/100`, color: preview.score >= 70 ? "#15803d" : preview.score >= 50 ? "#c2410c" : "#b91c1c" },
                      { label: "リスク額", val: `¥${preview.riskAmt.toFixed(0)}`, color: "#1e293b" },
                      { label: "損益", val: `${preview.pnl >= 0 ? "+" : ""}¥${preview.pnl.toFixed(0)}`, color: preview.pnl >= 0 ? "#15803d" : "#b91c1c" },
                      { label: "新残高", val: `¥${preview.newBal.toFixed(0)}`, color: "#1e293b" },
                    ].map((p, i) => (
                      <div key={i}>
                        <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>{p.label}</div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: p.color, marginTop: 3 }}>{p.val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {mode === "STOPPED"
                ? <button style={S.btnStopped} disabled>🛑 強制停止中 — エントリー不可</button>
                : <button style={S.btnGreen} onClick={handleAdd} disabled={!form.resultR || !form.rr}>✅ トレードを記録する</button>
              }
            </div>
          </>
        )}

        {/* LIST */}
        {tab === "list" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>全 {trades.length} 件</div>
              {trades.length > 0 && (
                <button onClick={() => setShowConfirm(true)}
                  style={{ background: "none", border: "1px solid #fca5a5", color: "#b91c1c", padding: "4px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>
                  全削除
                </button>
              )}
            </div>
            {showConfirm && (
              <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: "#b91c1c", fontWeight: 700, marginBottom: 10 }}>⚠️ 全データを削除しますか？</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => { setTrades([]); setShowConfirm(false); }}
                    style={{ background: "#b91c1c", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>削除する</button>
                  <button onClick={() => setShowConfirm(false)}
                    style={{ background: "#fff", border: "1px solid #e2e8f0", padding: "8px 16px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>キャンセル</button>
                </div>
              </div>
            )}
            {trades.length === 0 ? (
              <div style={{ ...S.card, textAlign: "center", color: "#94a3b8", padding: 40 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                トレードなし
              </div>
            ) : (
              [...trades].reverse().map(t => (
                <div key={t.id} style={{ ...S.card, borderLeft: `4px solid ${Number(t.resultR) > 0 ? "#16a34a" : "#dc2626"}`, marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>{t.pair} <span style={{ fontSize: 11, color: "#94a3b8" }}>{t.date}</span></div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>スコア {t.score} | RR {t.rr} | リスク {t.riskPct}%</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: Number(t.resultR) > 0 ? "#15803d" : "#b91c1c" }}>
                        {Number(t.resultR) > 0 ? "+" : ""}{t.resultR}R
                      </div>
                      <div style={{ fontSize: 12, color: t.pnl >= 0 ? "#15803d" : "#b91c1c" }}>
                        {t.pnl >= 0 ? "+" : ""}¥{t.pnl.toFixed(0)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid #f1f5f9" }}>
                    <div style={{ fontSize: 12, color: "#64748b" }}>残高 ¥{t.balance.toFixed(0)}</div>
                    <button onClick={() => setTrades(p => p.filter(x => x.id !== t.id))}
                      style={{ background: "none", border: "1px solid #e2e8f0", color: "#94a3b8", cursor: "pointer", padding: "2px 10px", borderRadius: 5, fontSize: 11, fontFamily: "inherit" }}>削除</button>
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {/* CONDITIONS */}
        {tab === "cond" && (
          <>
            <div style={S.card}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", marginBottom: 14 }}>⚡ 攻撃モード発動条件</div>
              {[
                { label: "直近10回 平均R > 0.5", ok: avgR10 > 0.5, val: `${avgR10.toFixed(3)}R` },
                { label: "ドローダウン < 5%", ok: currentDD < 5, val: `${currentDD.toFixed(2)}%` },
                { label: "3連敗していない", ok: stats.streak < 3, val: `${stats.streak}連敗` },
              ].map((c, i, arr) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: i < arr.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 26, height: 26, borderRadius: "50%", background: c.ok ? "#f0fdf4" : "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
                      {c.ok ? "✓" : "✗"}
                    </div>
                    <span style={{ fontSize: 13, color: "#1e293b" }}>{c.label}</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: c.ok ? "#15803d" : "#b91c1c", marginLeft: 8 }}>{c.val}</span>
                </div>
              ))}
            </div>

            <div style={S.card}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", marginBottom: 14 }}>🚦 制限ロジック</div>
              {[
                { label: "DD -10% 強制停止", current: `現在 ${currentDD.toFixed(1)}%`, danger: currentDD >= 8 },
                { label: "3連敗で攻撃モード禁止", current: `連敗 ${stats.streak}回`, danger: stats.streak >= 3 },
                { label: "月間 -5% 守備モード固定", current: "月次確認中", danger: false },
              ].map((r, i, arr) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: i < arr.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                  <span style={{ fontSize: 13, color: r.danger ? "#b91c1c" : "#1e293b" }}>{r.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: r.danger ? "#b91c1c" : "#64748b", background: r.danger ? "#fef2f2" : "#f8fafc", padding: "3px 10px", borderRadius: 20 }}>{r.current}</span>
                </div>
              ))}
            </div>

            <div style={{ ...S.card, background: "#f0fdf4", border: "1px solid #86efac" }}>
              <div style={{ fontSize: 12, color: "#15803d", fontWeight: 700, marginBottom: 6 }}>💾 データ保存状態</div>
              <div style={{ fontSize: 13, color: "#166534" }}>
                {trades.length}件のトレードがこの端末に保存されています。<br/>
                <span style={{ fontSize: 11, color: "#15803d", opacity: 0.8 }}>ブラウザのデータを消去すると削除されます。</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
