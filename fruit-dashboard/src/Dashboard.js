import { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import './Dashboard.css';

const API_BASE_URL = 'http://localhost:5000/api';

const RIPENESS = {
  ripe:      { label: 'Ripe',      color: '#5F8A4C' },
  unripe:    { label: 'Unripe',    color: '#C9A227' },
  overripe:  { label: 'Overripe',  color: '#A8482F' },
  uncertain: { label: 'Uncertain', color: '#C2702E' },
};

const FRUIT_COLORS = {
  apple:  '#A8482F',
  mango:  '#C9A227',
  banana: '#7d9b62',
};

// Earthy palette for fruits beyond the three above, assigned deterministically.
const EXTRA_FRUIT_PALETTE = [
  '#5F8A4C', '#C2702E', '#8C5A6E', '#9B8540',
  '#6E8B7B', '#7A5C3E', '#4C7A8A', '#B08968',
];

const fruitColor = (name) => {
  const key = (name || '').toLowerCase();
  if (FRUIT_COLORS[key]) return FRUIT_COLORS[key];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return EXTRA_FRUIT_PALETTE[h % EXTRA_FRUIT_PALETTE.length];
};

const fruitsInSession = (sessionData) =>
  (sessionData?.fruitCounts ?? []).map(f => f.name.toLowerCase());

export default function Dashboard({ sessionId }) {
  const [sessionData, setSessionData]       = useState(null);
  const [fruitRipeness, setFruitRipeness]   = useState({});
  const [selectedFruit, setSelectedFruit]   = useState('apple');
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState(null);

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    fetch(`${API_BASE_URL}/session/${sessionId}/stats`)
      .then(r => { if (!r.ok) throw new Error('Failed to fetch stats'); return r.json(); })
      .then(data => { setSessionData(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [sessionId]);

  useEffect(() => {
    if (!sessionData) return;
    const load = async () => {
      const result = {};
      for (const fruit of fruitsInSession(sessionData)) {
        try {
          const r = await fetch(`${API_BASE_URL}/fruit/${encodeURIComponent(fruit)}/ripeness`);
          result[fruit] = r.ok ? await r.json() : { ripe: 0, unripe: 0, overripe: 0, total: 0 };
        } catch {
          result[fruit] = { ripe: 0, unripe: 0, overripe: 0, total: 0 };
        }
      }
      setFruitRipeness(result);
    };
    load();
  }, [sessionData]);

  useEffect(() => {
    if (!sessionData) return;
    const available = fruitsInSession(sessionData);
    if (available.length > 0 && !available.includes(selectedFruit)) {
      setSelectedFruit(available[0]);
    }
  }, [sessionData, selectedFruit]);

  if (!sessionId || loading) {
    return (
      <div className="db-splash">
        <div className="db-spin" />
        <div>Reading the orchard…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="db-splash error">
        <div>Couldn't load stats — {error}</div>
        <div className="db-splash-sub">Make sure the Flask server is running on port 5000</div>
      </div>
    );
  }

  if (!sessionData) return null;

  const totalFruits = sessionData.fruitCounts?.reduce((a, c) => a + c.value, 0) ?? 0;
  const ripeCount   = sessionData.ripenessDistribution?.find(r => r.name === 'Ripe')?.value ?? 0;
  const uncertainCount = sessionData.uncertainDetections?.length ?? 0;

  const ripenessChartData = (sessionData.ripenessDistribution ?? []).map(r => ({
    name: r.name,
    value: r.value,
    color: RIPENESS[r.name.toLowerCase()]?.color ?? '#C8B894',
  }));

  const fruits = fruitsInSession(sessionData);

  const fruitChartData = (sessionData.fruitCounts ?? []).map(f => ({
    name: f.name,
    value: f.value,
    color: fruitColor(f.name),
  }));

  const sel  = fruitRipeness[selectedFruit] ?? { ripe: 0, unripe: 0, overripe: 0, total: 0 };
  const bars = [
    { key: 'ripe',     label: 'Ripe',     count: sel.ripe },
    { key: 'unripe',   label: 'Unripe',   count: sel.unripe },
    { key: 'overripe', label: 'Overripe', count: sel.overripe },
  ];

  return (
    <div className="db">
      <div className="db-header">
        <div className="db-title">Harvest Overview</div>
        <div className="db-sub">Latest drone scan · session <span className="db-session-id">{sessionId?.slice(0, 8)}</span></div>
      </div>

      <div className="db-body">
        {/* stat cards */}
        <div className="db-stat-row">
          <div className="db-card db-stat">
            <div className="db-stat-label">Total fruits</div>
            <div className="db-stat-num">{totalFruits}</div>
            <div className="db-stat-sub">mapped this session</div>
          </div>
          <div className="db-card db-stat">
            <div className="db-stat-label">Ripe</div>
            <div className="db-stat-num" style={{ color: RIPENESS.ripe.color }}>{ripeCount}</div>
            <div className="db-stat-sub">ready for harvest</div>
          </div>
          <div className="db-card db-stat">
            <div className="db-stat-label">Uncertain</div>
            <div className="db-stat-num" style={{ color: RIPENESS.uncertain.color }}>{uncertainCount}</div>
            <div className="db-stat-sub">needs review</div>
          </div>
        </div>

        {/* charts row */}
        <div className="db-chart-row">
          <div className="db-card db-chart-card">
            <div className="db-card-cap">Ripeness distribution</div>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={ripenessChartData} cx="50%" cy="50%" innerRadius={60} outerRadius={95}
                  paddingAngle={4} dataKey="value">
                  {ripenessChartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#F5EEDD', border: '1.5px solid #2E2A22', borderRadius: 3, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
                  formatter={(v, n) => [v, n]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="db-legend">
              {ripenessChartData.map(d => (
                <span key={d.name} className="db-leg-item">
                  <span className="db-leg-dot" style={{ background: d.color }} />
                  {d.name} <span className="db-leg-n">{d.value}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="db-card db-chart-card">
            <div className="db-card-cap">Fruit breakdown</div>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={fruitChartData} cx="50%" cy="50%" innerRadius={60} outerRadius={95}
                  paddingAngle={4} dataKey="value">
                  {fruitChartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#F5EEDD', border: '1.5px solid #2E2A22', borderRadius: 3, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
                  formatter={(v, n) => [v, n]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="db-legend">
              {fruitChartData.map(d => (
                <span key={d.name} className="db-leg-item">
                  <span className="db-leg-dot" style={{ background: d.color }} />
                  {d.name} <span className="db-leg-n">{d.value}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* per-fruit ripeness detail */}
        <div className="db-card db-detail-card">
          <div className="db-card-cap">Ripeness by fruit</div>
          <div className="db-fruit-tabs">
            {fruits.map(f => (
              <button
                key={f}
                className={`db-fruit-btn${selectedFruit === f ? ' active' : ''}`}
                onClick={() => setSelectedFruit(f)}
                style={selectedFruit === f ? { '--dot': fruitColor(f) } : {}}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="db-bars">
            {bars.map(b => {
              const pct = sel.total > 0 ? Math.round((b.count / sel.total) * 100) : 0;
              return (
                <div key={b.key} className="db-bar-row">
                  <div className="db-bar-head">
                    <span className="db-bar-name">
                      <span className="db-bar-dot" style={{ background: RIPENESS[b.key].color }} />
                      {b.label}
                    </span>
                    <span className="db-bar-val">{b.count}</span>
                  </div>
                  <div className="db-track">
                    <div className="db-fill" style={{ width: pct + '%', background: RIPENESS[b.key].color }} />
                  </div>
                </div>
              );
            })}
            <div className="db-total-row">
              <span>Total {selectedFruit}s</span>
              <span className="db-total-num">{sel.total}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
