// @ts-nocheck
import { useState, useMemo, useCallback, useEffect, useRef } from "react";

const INITIAL_BALANCE = 100000;

/* ============================================================
 * Design tokens (light / 軽快トーンの延長)
 * ========================================================== */
const T = {
  bg: "#f5f7fb",
  surface: "#ffffff",
  line: "#e6eaf2",
  ink: "#1e293b",
  sub: "#64748b",
  mute: "#94a3b8",
  brand: "#2563eb",
  up: "#15803d",
  down: "#b91c1c",
  warn: "#c2410c",
  radius: 14,
  font: "'Hiragino Sans', 'Noto Sans JP', system-ui, sans-serif",
};

/* ============================================================
 * Domain helpers
 * ========================================================== */
const defaultPlan = () => ({
  date: new Date().toISOString().split("T")[0],
  pair: "AUD/USD",
  side: "SELL",
  dailyDir: "DOWN",
  h4Dir: "DOWN",
  breakQuality: "B",
  spacePips: "",
  timeScore: "",
  entry: "",
  stop: "",
  riskPct: 2,
  rr: "",
  resultR: "",
  note: "",
});

function calcScore(t) {
  const align = t.dailyDir === t.h4Dir && t.dailyDir !== "RANGE" ? 30 : 0;
  const bq = { A: 30, B: 20, C: 10 }[t.breakQuality] || 0;
  const sp = Number(t.spacePips) >= 50 ? 20 : Number(t.spacePips) >= 30 ? 10 : 0;
  const ts = Math.min(Number(t.timeScore) || 0, 20);
  return { total: align + bq + sp + ts, align, bq, sp, ts };
}

// Go / No-Go 判定（モード考慮）
function verdict(score, mode) {
  if (mode === "STOPPED") return { key: "NOGO", label: "見送り（強制停止中）", color: T.down, bg: "#fef2f2", emoji: "⛔" };
  if (score >= 70) return { key: "GO", label: "GO — 条件良好", color: T.up, bg: "#f0fdf4", emoji: "✅" };
  if (score >= 50) return { key: "CAUTION", label: "要注意 — 妥協は禁物", color: T.warn, bg: "#fff7ed", emoji: "⚠️" };
  return { key: "NOGO", label: "見送り推奨 — 条件不足", color: T.down, bg: "#fef2f2", emoji: "🚫" };
}

// 通貨ペアの pip 情報 + 決済通貨→円 概算レート
const QUOTE_TO_JPY = { JPY: 1, USD: 161, EUR: 184, GBP: 213, AUD: 111, NZD: 97, CAD: 118, CHF: 181 };
function pipInfo(pair) {
  const quote = (pair.split("/")[1] || "USD").toUpperCase().trim();
  const pipSize = quote === "JPY" ? 0.01 : 0.0001;
  return { quote, pipSize, quoteToJpy: QUOTE_TO_JPY[quote] ?? 1 };
}
// SL幅(pips) と リスク額(¥) から 標準ロット数(100,000通貨=1.0)
function calcLots(pair, slPips, riskJpy, quoteToJpy) {
  if (!slPips || slPips <= 0) return null;
  const pipValuePerLotJpy = 100000 * pipInfo(pair).pipSize * quoteToJpy; // 1.0ロットの1pip価値(¥)
  if (pipValuePerLotJpy <= 0) return null;
  const lots = riskJpy / (slPips * pipValuePerLotJpy);
  return { lots, pipValuePerLotJpy };
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

/* ============================================================
 * Data layer (localStorage; 将来 Supabase へ差替えやすい形)
 * ========================================================== */
function useTrades() {
  const [trades, setTrades] = useState(() => {
    try {
      const saved = localStorage.getItem("fx_trades");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem("fx_trades", JSON.stringify(trades)); } catch {}
  }, [trades]);
  return [trades, setTrades];
}

/* ============================================================
 * App
 * ========================================================== */
export default function App() {
  const [trades, setTrades] = useTrades();
  const [plan, setPlan] = useState(defaultPlan);
  const [tab, setTab] = useState("dash");
  const [showConfirm, setShowConfirm] = useState(false);
  const [quoteRate, setQuoteRate] = useState(() => pipInfo("AUD/USD").quoteToJpy);
  const fileRef = useRef(null);

  // ペア変更時に決済通貨レートを自動追従（手入力で上書き可）
  useEffect(() => { setQuoteRate(pipInfo(plan.pair).quoteToJpy); }, [plan.pair]);

  const balance = useMemo(() =>
    trades.length > 0 ? trades[trades.length - 1].balance : INITIAL_BALANCE, [trades]);
  const mode = useMemo(() => getMode(trades, balance), [trades, balance]);
  const cfg = MODE_CFG[mode];
  const profitPct = ((balance - INITIAL_BALANCE) / INITIAL_BALANCE) * 100;

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
    for (const t of trades) { maxBal = Math.max(maxBal, t.balance); maxDD = Math.max(maxDD, ((maxBal - t.balance) / maxBal) * 100); }
    let streak = 0;
    for (let i = trades.length - 1; i >= 0; i--) { if ((Number(trades[i].resultR) || 0) < 0) streak++; else break; }
    return { winRate, avgWinR, expectancy, maxDD, totalR, streak, wins: wins.length, losses: losses.length };
  }, [trades]);

  // --- プラン由来の算出値（プラン/記録 共通）
  const sc = useMemo(() => calcScore(plan), [plan]);
  const v = useMemo(() => verdict(sc.total, mode), [sc.total, mode]);
  const slPips = useMemo(() => {
    const e = Number(plan.entry), s = Number(plan.stop);
    if (!e || !s) return null;
    return Math.abs(e - s) / pipInfo(plan.pair).pipSize;
  }, [plan.entry, plan.stop, plan.pair]);
  const riskJpy = balance * (Number(plan.riskPct) / 100);
  const lotInfo = useMemo(() => slPips ? calcLots(plan.pair, slPips, riskJpy, Number(quoteRate)) : null, [plan.pair, slPips, riskJpy, quoteRate]);

  const recent10 = trades.slice(-10);
  const avgR10 = recent10.length > 0 ? recent10.reduce((s, t) => s + (Number(t.resultR) || 0), 0) / recent10.length : 0;

  /* --- actions --- */
  const recordTrade = useCallback(() => {
    if (!plan.resultR || !plan.rr) return;
    const score = calcScore(plan).total;
    const prevBal = trades.length > 0 ? trades[trades.length - 1].balance : INITIAL_BALANCE;
    const riskAmt = prevBal * (Number(plan.riskPct) / 100);
    const pnl = Number(plan.resultR) * riskAmt;
    setTrades(prev => [...prev, {
      ...plan, id: Date.now(), score, pnl, balance: prevBal + pnl, win: Number(plan.resultR) > 0,
    }]);
    setPlan(defaultPlan());
    setTab("dash");
  }, [plan, trades]);

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(trades, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `fx-trades-${new Date().toISOString().split("T")[0]}.json`;
    a.click(); URL.revokeObjectURL(url);
  }, [trades]);

  const importJson = useCallback((e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (Array.isArray(data)) setTrades(data);
      } catch { alert("読み込みに失敗しました（JSON形式を確認してください）"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  /* --- 分析: スコア帯別 / ペア別 期待値 --- */
  const analysis = useMemo(() => {
    const buckets = [
      { key: "80+", lo: 80, hi: 101 },
      { key: "70-79", lo: 70, hi: 80 },
      { key: "50-69", lo: 50, hi: 70 },
      { key: "<50", lo: -1, hi: 50 },
    ].map(b => {
      const ts = trades.filter(t => (t.score ?? 0) >= b.lo && (t.score ?? 0) < b.hi);
      const n = ts.length;
      const exp = n ? ts.reduce((s, t) => s + (Number(t.resultR) || 0), 0) / n : 0;
      const wr = n ? ts.filter(t => Number(t.resultR) > 0).length / n : 0;
      return { ...b, n, exp, wr };
    });
    const byPair = {};
    for (const t of trades) {
      const p = t.pair || "?";
      (byPair[p] = byPair[p] || []).push(Number(t.resultR) || 0);
    }
    const pairs = Object.entries(byPair).map(([p, rs]) => ({
      pair: p, n: rs.length, totalR: rs.reduce((a, b) => a + b, 0),
      wr: rs.filter(r => r > 0).length / rs.length,
    })).sort((a, b) => b.totalR - a.totalR);
    return { buckets, pairs };
  }, [trades]);

  /* --- styles --- */
  const S = {
    wrap: { fontFamily: T.font, background: T.bg, minHeight: "100vh", fontSize: 14, color: T.ink, paddingBottom: 24 },
    header: { background: T.surface, borderBottom: `1px solid ${T.line}`, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 },
    modeBadge: { background: cfg.bg, border: `1.5px solid ${cfg.border}`, borderRadius: 12, padding: "6px 14px", textAlign: "center" },
    tabs: { background: T.surface, borderBottom: `1px solid ${T.line}`, display: "flex", overflowX: "auto", position: "sticky", top: 57, zIndex: 9 },
    tab: (a) => ({ background: "none", border: "none", borderBottom: a ? `2.5px solid ${T.brand}` : "2.5px solid transparent", color: a ? T.brand : T.mute, padding: "11px 15px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }),
    card: { background: T.surface, border: `1px solid ${T.line}`, borderRadius: T.radius, padding: 16, marginBottom: 12, boxShadow: "0 1px 2px rgba(16,24,40,0.04)" },
    label: { fontSize: 11, color: T.sub, fontWeight: 700, marginBottom: 4, display: "block", letterSpacing: 0.3 },
    input: { width: "100%", padding: "10px 12px", border: `1.5px solid ${T.line}`, borderRadius: 9, fontSize: 14, fontFamily: "inherit", background: "#fff", color: T.ink, outline: "none" },
    btn: (bg, fg = "#fff") => ({ background: bg, color: fg, border: "none", padding: "13px 0", borderRadius: 11, cursor: "pointer", fontFamily: "inherit", fontSize: 15, fontWeight: 800, width: "100%", marginTop: 14 }),
    chip: (bg, fg) => ({ background: bg, color: fg, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20 }),
  };

  const Field = ({ label, k, ph, type = "number", step }) => (
    <div>
      <label style={S.label}>{label}</label>
      <input type={type} step={step} value={plan[k]} placeholder={ph}
        onChange={e => setPlan({ ...plan, [k]: e.target.value })} style={S.input} />
    </div>
  );
  const Select = ({ label, k, opts }) => (
    <div>
      <label style={S.label}>{label}</label>
      <select value={plan[k]} onChange={e => setPlan({ ...plan, [k]: e.target.value })} style={S.input}>
        {opts.map(o => <option key={o}>{o}</option>)}
      </select>
    </div>
  );

  // スコア内訳バー
  const ScoreBar = () => (
    <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", background: "#eef2f7", marginTop: 6 }}>
      {[["方向", sc.align, "#2563eb"], ["質", sc.bq, "#16a34a"], ["空間", sc.sp, "#0891b2"], ["時間", sc.ts, "#9333ea"]].map(([n, val, c]) => (
        <div key={n} title={`${n} ${val}`} style={{ width: `${val}%`, background: c }} />
      ))}
    </div>
  );

  return (
    <div style={S.wrap}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        input:focus,select:focus{border-color:${T.brand}!important;box-shadow:0 0 0 3px rgba(37,99,235,0.12)}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        .pulse{animation:pulse 1.5s infinite}
        ::-webkit-scrollbar{height:4px}::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:2px}
      `}</style>

      {/* Header */}
      <div style={S.header}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 900, color: T.ink }}>📊 FX Autopilot</div>
          <div style={{ fontSize: 11, color: T.mute }}>¥{balance.toLocaleString()} ({profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}%)</div>
        </div>
        <div style={S.modeBadge}>
          <div style={{ fontSize: 10, color: cfg.color, fontWeight: 700 }}>現在のモード</div>
          <div style={{ fontSize: 15, fontWeight: 900, color: cfg.color }} className={mode === "STOPPED" ? "pulse" : ""}>{cfg.emoji} {cfg.label}</div>
          <div style={{ fontSize: 11, color: cfg.color, opacity: 0.8 }}>リスク {cfg.risk}%</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={S.tabs}>
        {[["dash", "📈 ダッシュ"], ["plan", "🎯 プラン"], ["entry", "✏️ 記録"], ["list", "📋 履歴"], ["stats", "📊 分析"], ["cond", "⚡ 条件"]].map(([t, l]) => (
          <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>

      <div style={{ padding: 16, maxWidth: 620, margin: "0 auto" }}>

        {/* ---------------- DASHBOARD ---------------- */}
        {tab === "dash" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              {[
                { label: "現在残高", val: `¥${balance.toLocaleString()}`, sub: `${profitPct >= 0 ? "+" : ""}${profitPct.toFixed(2)}%`, color: profitPct >= 0 ? T.up : T.down },
                { label: "勝率", val: `${(stats.winRate * 100).toFixed(1)}%`, sub: `${stats.wins}勝 ${stats.losses}敗`, color: stats.winRate >= 0.5 ? T.up : T.warn },
                { label: "期待値", val: `${stats.expectancy >= 0 ? "+" : ""}${stats.expectancy.toFixed(3)}R`, sub: `累計 ${stats.totalR >= 0 ? "+" : ""}${stats.totalR.toFixed(1)}R`, color: stats.expectancy >= 0 ? T.up : T.down },
                { label: "最大DD", val: `${stats.maxDD.toFixed(2)}%`, sub: `現在 ${currentDD.toFixed(2)}%`, color: stats.maxDD >= 5 ? T.down : T.brand },
              ].map((m, i) => (
                <div key={i} style={{ ...S.card, borderLeft: `4px solid ${m.color}`, marginBottom: 0 }}>
                  <div style={{ fontSize: 11, color: T.sub, fontWeight: 700, marginBottom: 6 }}>{m.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: m.color }}>{m.val}</div>
                  <div style={{ fontSize: 12, color: T.mute, marginTop: 3 }}>{m.sub}</div>
                </div>
              ))}
            </div>

            <div style={{ ...S.card, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {[
                { label: "連敗数", val: `${stats.streak}連敗`, warn: stats.streak >= 3 },
                { label: "現在DD", val: `${currentDD.toFixed(1)}%`, warn: currentDD >= 5 },
                { label: "推奨リスク", val: `${cfg.risk}%`, warn: mode === "STOPPED" },
              ].map((r, i) => (
                <div key={i} style={{ textAlign: "center", background: r.warn ? "#fef2f2" : "#f8fafc", borderRadius: 10, padding: "10px 6px" }}>
                  <div style={{ fontSize: 10, color: T.sub, fontWeight: 700 }}>{r.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: r.warn ? T.down : T.ink, marginTop: 4 }}>{r.val}</div>
                </div>
              ))}
            </div>

            {trades.length > 1 && (
              <div style={S.card}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.sub, marginBottom: 10 }}>📈 資金曲線</div>
                <div style={{ height: 120 }}>
                  <svg width="100%" height="100%" viewBox={`0 0 ${trades.length + 1} 100`} preserveAspectRatio="none">
                    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#16a34a" stopOpacity="0.2" /><stop offset="100%" stopColor="#16a34a" stopOpacity="0" /></linearGradient></defs>
                    {(() => {
                      const all = [INITIAL_BALANCE, ...trades.map(t => t.balance)];
                      const min = Math.min(...all), max = Math.max(...all), range = max - min || 1;
                      const y = b => 100 - ((b - min) / range) * 85 - 7;
                      const pts = all.map((b, i) => `${i},${y(b)}`).join(" ");
                      return (<>
                        <line x1="0" y1={y(INITIAL_BALANCE)} x2={all.length - 1} y2={y(INITIAL_BALANCE)} stroke="#e2e8f0" strokeWidth="0.5" strokeDasharray="1" />
                        <polygon points={`0,100 ${pts} ${all.length - 1},100`} fill="url(#g)" />
                        <polyline points={pts} stroke="#16a34a" strokeWidth="0.8" fill="none" strokeLinejoin="round" />
                        <circle cx={all.length - 1} cy={y(all[all.length - 1])} r="1.5" fill="#16a34a" />
                      </>);
                    })()}
                  </svg>
                </div>
              </div>
            )}

            {trades.length === 0 && (
              <div style={{ ...S.card, textAlign: "center", color: T.mute, padding: 40 }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>🎯</div>
                まだトレードがありません<br />
                <span style={{ fontSize: 13 }}>「🎯 プラン」でエントリー前チェックから始めましょう</span>
              </div>
            )}
          </>
        )}

        {/* ---------------- PLAN (Go/No-Go + Lot) ---------------- */}
        {tab === "plan" && (
          <>
            {/* 判定ヒーロー */}
            <div style={{ background: v.bg, border: `2px solid ${v.color}33`, borderRadius: T.radius, padding: "16px 18px", marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: v.color, fontWeight: 800, letterSpacing: 0.5 }}>エントリー前 判定</div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 4 }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: v.color }}>{v.emoji} {v.label}</div>
                <div style={{ fontSize: 30, fontWeight: 900, color: v.color, lineHeight: 1 }}>{sc.total}<span style={{ fontSize: 15 }}>/100</span></div>
              </div>
              <ScoreBar />
              <div style={{ fontSize: 11, color: v.color, marginTop: 8, opacity: 0.85 }}>
                方向{sc.align} ・ 質{sc.bq} ・ 空間{sc.sp} ・ 時間{sc.ts}　|　推奨リスク {cfg.risk}%（{cfg.label}）
              </div>
            </div>

            {/* セットアップ入力 */}
            <div style={S.card}>
              <div style={{ fontSize: 12, fontWeight: 800, color: T.sub, marginBottom: 12 }}>① セットアップ</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="通貨ペア" k="pair" ph="AUD/USD" type="text" />
                <Select label="方向" k="side" opts={["SELL", "BUY"]} />
                <Select label="日足方向" k="dailyDir" opts={["UP", "DOWN", "RANGE"]} />
                <Select label="4時間足方向" k="h4Dir" opts={["UP", "DOWN", "RANGE"]} />
                <Select label="ブレイク質" k="breakQuality" opts={["A", "B", "C"]} />
                <Field label="空間 pips" k="spacePips" ph="例: 60" />
                <Field label="時間帯スコア (0〜20)" k="timeScore" ph="例: 15" />
                <Field label="想定RR" k="rr" ph="例: 2.5" step="0.1" />
              </div>
            </div>

            {/* ロット計算 */}
            <div style={S.card}>
              <div style={{ fontSize: 12, fontWeight: 800, color: T.sub, marginBottom: 12 }}>② ロット計算</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="エントリー価格" k="entry" ph="例: 0.6910" step="0.0001" />
                <Field label="損切り価格" k="stop" ph="例: 0.6942" step="0.0001" />
                <Field label={`リスク % (推奨 ${cfg.risk}%)`} k="riskPct" ph="2" step="0.5" />
                <div>
                  <label style={S.label}>{pipInfo(plan.pair).quote}→円 レート</label>
                  <input type="number" value={quoteRate} step="0.1"
                    disabled={pipInfo(plan.pair).quote === "JPY"}
                    onChange={e => setQuoteRate(e.target.value)} style={{ ...S.input, opacity: pipInfo(plan.pair).quote === "JPY" ? 0.5 : 1 }} />
                </div>
              </div>

              <div style={{ marginTop: 14, background: "#f8fafc", border: `1px solid ${T.line}`, borderRadius: 10, padding: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, textAlign: "center" }}>
                  {[
                    { label: "SL幅", val: slPips ? `${slPips.toFixed(1)}pips` : "—", color: T.ink },
                    { label: "リスク額", val: `¥${riskJpy.toFixed(0)}`, color: T.down },
                    { label: "推奨ロット", val: lotInfo ? `${lotInfo.lots.toFixed(2)}` : "—", color: T.brand },
                    { label: "想定利益", val: (slPips && plan.rr) ? `+¥${(riskJpy * Number(plan.rr)).toFixed(0)}` : "—", color: T.up },
                  ].map((p, i) => (
                    <div key={i}>
                      <div style={{ fontSize: 10, color: T.sub, fontWeight: 700 }}>{p.label}</div>
                      <div style={{ fontSize: 15, fontWeight: 900, color: p.color, marginTop: 3 }}>{p.val}</div>
                    </div>
                  ))}
                </div>
                {lotInfo && (
                  <div style={{ fontSize: 10, color: T.mute, marginTop: 8, textAlign: "center" }}>
                    1.0ロットあたり 1pip ≈ ¥{lotInfo.pipValuePerLotJpy.toFixed(0)} で計算
                  </div>
                )}
              </div>

              <button style={S.btn(v.key === "NOGO" ? "#94a3b8" : T.brand)} onClick={() => setTab("entry")}>
                {v.key === "NOGO" ? "⚠️ 条件不足だが記録へ進む" : "この計画で記録へ進む →"}
              </button>
            </div>
          </>
        )}

        {/* ---------------- ENTRY (結果記録) ---------------- */}
        {tab === "entry" && (
          <>
            <div style={{ background: cfg.bg, border: `2px solid ${cfg.border}`, borderRadius: T.radius, padding: "14px 16px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 11, color: cfg.color, fontWeight: 700 }}>{plan.pair} ・ {plan.side}</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: cfg.color }}>スコア {sc.total}/100</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: cfg.color, opacity: 0.7 }}>リスク {plan.riskPct}%</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: cfg.color, lineHeight: 1 }}>{lotInfo ? lotInfo.lots.toFixed(2) : "—"}<span style={{ fontSize: 13 }}> lot</span></div>
              </div>
            </div>

            <div style={S.card}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="日付" k="date" type="date" />
                <Field label="結果R (+2, -1...)" k="resultR" ph="例: +2" step="0.1" />
                <Field label="実RR" k="rr" ph="例: 2.5" step="0.1" />
                <Field label="リスク %" k="riskPct" ph="2" step="0.5" />
                <div style={{ gridColumn: "1/-1" }}>
                  <label style={S.label}>メモ（任意）</label>
                  <input type="text" value={plan.note} placeholder="気づき・反省点" onChange={e => setPlan({ ...plan, note: e.target.value })} style={S.input} />
                </div>
              </div>

              {plan.resultR && plan.rr && (
                <div style={{ marginTop: 14, background: "#f8fafc", border: `1px solid ${T.line}`, borderRadius: 10, padding: 12, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, textAlign: "center" }}>
                  {[
                    { label: "損益", val: `${Number(plan.resultR) >= 0 ? "+" : ""}¥${(Number(plan.resultR) * riskJpy).toFixed(0)}`, color: Number(plan.resultR) >= 0 ? T.up : T.down },
                    { label: "新残高", val: `¥${(balance + Number(plan.resultR) * riskJpy).toFixed(0)}`, color: T.ink },
                    { label: "スコア", val: `${sc.total}/100`, color: sc.total >= 70 ? T.up : sc.total >= 50 ? T.warn : T.down },
                  ].map((p, i) => (
                    <div key={i}><div style={{ fontSize: 10, color: T.sub, fontWeight: 700 }}>{p.label}</div><div style={{ fontSize: 14, fontWeight: 900, color: p.color, marginTop: 3 }}>{p.val}</div></div>
                  ))}
                </div>
              )}

              {mode === "STOPPED"
                ? <button style={{ ...S.btn("#dc2626"), cursor: "not-allowed" }} disabled>🛑 強制停止中 — エントリー不可</button>
                : <button style={S.btn(T.up)} onClick={recordTrade} disabled={!plan.resultR || !plan.rr}>✅ トレードを記録する</button>}
            </div>
          </>
        )}

        {/* ---------------- LIST ---------------- */}
        {tab === "list" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8 }}>
              <div style={{ fontSize: 13, color: T.sub, fontWeight: 700 }}>全 {trades.length} 件</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={exportJson} style={{ ...S.chip("#eff6ff", T.brand), border: "1px solid #bfdbfe", cursor: "pointer", fontFamily: "inherit" }}>⬇ 書出</button>
                <button onClick={() => fileRef.current?.click()} style={{ ...S.chip("#f0fdf4", T.up), border: "1px solid #bbf7d0", cursor: "pointer", fontFamily: "inherit" }}>⬆ 読込</button>
                <input ref={fileRef} type="file" accept="application/json" onChange={importJson} style={{ display: "none" }} />
                {trades.length > 0 && <button onClick={() => setShowConfirm(true)} style={{ ...S.chip("#fff", T.down), border: "1px solid #fca5a5", cursor: "pointer", fontFamily: "inherit" }}>全削除</button>}
              </div>
            </div>
            {showConfirm && (
              <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: T.down, fontWeight: 700, marginBottom: 10 }}>⚠️ 全データを削除しますか？（先に書出推奨）</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => { setTrades([]); setShowConfirm(false); }} style={{ background: T.down, color: "#fff", border: "none", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>削除する</button>
                  <button onClick={() => setShowConfirm(false)} style={{ background: "#fff", border: `1px solid ${T.line}`, padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>キャンセル</button>
                </div>
              </div>
            )}
            {trades.length === 0 ? (
              <div style={{ ...S.card, textAlign: "center", color: T.mute, padding: 40 }}><div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>トレードなし</div>
            ) : [...trades].reverse().map(t => (
              <div key={t.id} style={{ ...S.card, borderLeft: `4px solid ${Number(t.resultR) > 0 ? T.up : T.down}`, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: T.ink }}>{t.pair} {t.side && <span style={{ fontSize: 10, color: t.side === "BUY" ? T.up : T.down }}>{t.side}</span>} <span style={{ fontSize: 11, color: T.mute }}>{t.date}</span></div>
                    <div style={{ fontSize: 12, color: T.sub, marginTop: 3 }}>スコア {t.score} | RR {t.rr} | リスク {t.riskPct}%</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 18, fontWeight: 900, color: Number(t.resultR) > 0 ? T.up : T.down }}>{Number(t.resultR) > 0 ? "+" : ""}{t.resultR}R</div>
                    <div style={{ fontSize: 12, color: t.pnl >= 0 ? T.up : T.down }}>{t.pnl >= 0 ? "+" : ""}¥{t.pnl.toFixed(0)}</div>
                  </div>
                </div>
                {t.note && <div style={{ fontSize: 12, color: T.sub, marginTop: 8, background: "#f8fafc", borderRadius: 8, padding: "6px 10px" }}>📝 {t.note}</div>}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: `1px solid #f1f5f9` }}>
                  <div style={{ fontSize: 12, color: T.sub }}>残高 ¥{t.balance.toFixed(0)}</div>
                  <button onClick={() => setTrades(p => p.filter(x => x.id !== t.id))} style={{ background: "none", border: `1px solid ${T.line}`, color: T.mute, cursor: "pointer", padding: "2px 10px", borderRadius: 6, fontSize: 11, fontFamily: "inherit" }}>削除</button>
                </div>
              </div>
            ))}
          </>
        )}

        {/* ---------------- STATS (分析) ---------------- */}
        {tab === "stats" && (
          <>
            <div style={S.card}>
              <div style={{ fontSize: 13, fontWeight: 800, color: T.ink, marginBottom: 4 }}>🎯 スコア帯別 期待値</div>
              <div style={{ fontSize: 11, color: T.mute, marginBottom: 12 }}>スコアリングが機能しているか検証（高スコア＝高期待値が理想）</div>
              {analysis.buckets.map((b, i, arr) => (
                <div key={b.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: i < arr.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, width: 64 }}>{b.key}</div>
                  <div style={{ fontSize: 11, color: T.mute, width: 60 }}>{b.n}件</div>
                  <div style={{ fontSize: 11, color: T.sub, width: 70 }}>勝率 {(b.wr * 100).toFixed(0)}%</div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: b.exp >= 0 ? T.up : T.down, width: 72, textAlign: "right" }}>{b.n ? `${b.exp >= 0 ? "+" : ""}${b.exp.toFixed(2)}R` : "—"}</div>
                </div>
              ))}
            </div>
            <div style={S.card}>
              <div style={{ fontSize: 13, fontWeight: 800, color: T.ink, marginBottom: 12 }}>💱 ペア別 成績</div>
              {analysis.pairs.length === 0 ? <div style={{ fontSize: 12, color: T.mute }}>データなし</div> : analysis.pairs.map((p, i, arr) => (
                <div key={p.pair} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: i < arr.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, width: 90 }}>{p.pair}</div>
                  <div style={{ fontSize: 11, color: T.mute, width: 50 }}>{p.n}件</div>
                  <div style={{ fontSize: 11, color: T.sub, width: 70 }}>勝率 {(p.wr * 100).toFixed(0)}%</div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: p.totalR >= 0 ? T.up : T.down, width: 72, textAlign: "right" }}>{p.totalR >= 0 ? "+" : ""}{p.totalR.toFixed(1)}R</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ---------------- CONDITIONS ---------------- */}
        {tab === "cond" && (
          <>
            <div style={S.card}>
              <div style={{ fontSize: 13, fontWeight: 800, color: T.ink, marginBottom: 14 }}>⚡ 攻撃モード発動条件</div>
              {[
                { label: "直近10回 平均R > 0.5", ok: avgR10 > 0.5, val: `${avgR10.toFixed(3)}R` },
                { label: "ドローダウン < 5%", ok: currentDD < 5, val: `${currentDD.toFixed(2)}%` },
                { label: "3連敗していない", ok: stats.streak < 3, val: `${stats.streak}連敗` },
              ].map((c, i, arr) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: i < arr.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 26, height: 26, borderRadius: "50%", background: c.ok ? "#f0fdf4" : "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{c.ok ? "✓" : "✗"}</div>
                    <span style={{ fontSize: 13, color: T.ink }}>{c.label}</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: c.ok ? T.up : T.down, marginLeft: 8 }}>{c.val}</span>
                </div>
              ))}
            </div>
            <div style={S.card}>
              <div style={{ fontSize: 13, fontWeight: 800, color: T.ink, marginBottom: 14 }}>🚦 制限ロジック</div>
              {[
                { label: "DD -10% 強制停止", current: `現在 ${currentDD.toFixed(1)}%`, danger: currentDD >= 8 },
                { label: "3連敗で攻撃モード禁止", current: `連敗 ${stats.streak}回`, danger: stats.streak >= 3 },
                { label: "月間 -5% 守備モード固定", current: "月次確認中", danger: false },
              ].map((r, i, arr) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: i < arr.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                  <span style={{ fontSize: 13, color: r.danger ? T.down : T.ink }}>{r.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: r.danger ? T.down : T.sub, background: r.danger ? "#fef2f2" : "#f8fafc", padding: "3px 10px", borderRadius: 20 }}>{r.current}</span>
                </div>
              ))}
            </div>
            <div style={{ ...S.card, background: "#fffbeb", border: "1px solid #fde68a" }}>
              <div style={{ fontSize: 12, color: "#b45309", fontWeight: 700, marginBottom: 6 }}>💾 データ保存：この端末のみ</div>
              <div style={{ fontSize: 13, color: "#92400e" }}>
                履歴は localStorage に保存中（{trades.length}件）。<br />
                <span style={{ fontSize: 11 }}>機種変・ブラウザ消去で失われます。「📋履歴」から定期的に <b>⬇書出</b> でバックアップを。クラウド同期は今後対応予定。</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
