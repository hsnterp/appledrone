/* orchard-ui.jsx — React chrome (screen-fixed): summary bar, legend/filter,
   tree detail panel. World overlays live in the Three scene module. */
const { useState, useEffect } = React;
const O = window.ORCHARD;
const bus = window.bus;

function emit(type, detail) { bus.dispatchEvent(new CustomEvent(type, { detail })); }

/* ---- top summary bar (kept minimal: total count) ------------------- */
function SummaryBar({ total }) {
  return (
    <header className="bar">
      <div className="brand">
        <span className="brand-mark">✻</span>
        <div className="brand-txt">
          <div className="brand-name">Pomona</div>
          <div className="brand-sub">Orchard Field Survey</div>
        </div>
      </div>
      <div className="bar-total">
        <span className="bt-num">{total}</span>
        <span className="bt-lbl">apples<br/>mapped</span>
      </div>
      <div className="bar-meta">
        <div className="bm-row"><span>session</span><b>{O.session.sessionId}</b></div>
        <div className="bm-row"><span>captured</span><b>Jun 5, 2026 · 09:14</b></div>
        <div className="bm-row"><span>trees</span><b>{O.trees.length}</b></div>
      </div>
    </header>
  );
}

/* ---- ripeness legend / filter (highlight, never hide) -------------- */
function Legend({ filterKey, setFilter, totals }) {
  return (
    <div className="legend">
      <div className="legend-cap">Ripeness key — <em>tap to highlight</em></div>
      <div className="legend-rows">
        {O.RIPENESS_ORDER.map((k) => {
          const r = O.RIPENESS[k];
          const n = totals[k] || 0;
          const active = filterKey === k;
          const dim = filterKey && !active;
          return (
            <button key={k}
              className={'leg-chip' + (active ? ' active' : '') + (dim ? ' dim' : '')}
              onClick={() => setFilter(active ? null : k)}>
              <span className="leg-dot" style={{ background: r.color }}></span>
              <span className="leg-name">{r.label}</span>
              <span className="leg-n">{n}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---- ruled breakdown bar ------------------------------------------- */
function RuleBar({ k, value, max }) {
  const r = O.RIPENESS[k];
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="rb">
      <div className="rb-top">
        <span className="rb-name"><span className="rb-dot" style={{ background: r.color }}></span>{r.label}</span>
        <span className="rb-val">{value}</span>
      </div>
      <div className="rb-track"><div className="rb-fill" style={{ width: pct + '%', background: r.color }}></div></div>
    </div>
  );
}

/* ---- per-tree detail panel (journal page) -------------------------- */
function DetailPanel({ treeId, onClose }) {
  const g = treeId ? O.byTree[treeId] : null;
  if (!g) return null;
  const open = true;
  const max = Math.max(g.breakdown.ripe, g.breakdown.unripe, g.breakdown.overripe, 1);
  const dom = O.RIPENESS[g.dominant];
  const uncertain = g.detections.filter((d) => d.isUncertain);
  return (
    <aside className="panel open">
      <button className="panel-close" onClick={onClose}>← back to orchard</button>
      <div className="panel-head">
        <div className="ph-id">{g.treeId}</div>
        <div className="ph-meta">Row {g.row} · specimen</div>
      </div>
      <div className="panel-figure">
        <div className="pf-num">{g.total}</div>
        <div className="pf-lbl">apples detected</div>
        <div className="pf-dom" style={{ '--dot': dom.color }}>mostly <b>{dom.label.toLowerCase()}</b></div>
      </div>
      <div className="panel-sec">
        <div className="sec-cap">Ripeness breakdown</div>
        <RuleBar k="ripe" value={g.breakdown.ripe} max={max} />
        <RuleBar k="unripe" value={g.breakdown.unripe} max={max} />
        <RuleBar k="overripe" value={g.breakdown.overripe} max={max} />
      </div>
      <div className="panel-sec">
        <div className="sec-cap">Field notes</div>
        {uncertain.length === 0 ? (
          <p className="note-clean">No uncertain detections — all reads above threshold.</p>
        ) : (
          <ul className="note-list">
            <li className="nl-head">{uncertain.length} flagged for review</li>
            {uncertain.map((d) => (
              <li key={d.id} className="nl-item">
                <span className="nl-dot"></span>
                <span className="nl-txt">{d.fruitType} · possible {O.RIPENESS[d.ripeness].label.toLowerCase()}</span>
                <span className="nl-conf">{Math.round(d.confidence * 100)}%</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="panel-coords">
        ~ {Math.round(g.x)}, {Math.round(g.z)} cm from mission pad
      </div>
    </aside>
  );
}

/* ---- root ---------------------------------------------------------- */
function App() {
  const [selected, setSelected] = useState(null);
  const [filterKey, setFilterKey] = useState(null);

  useEffect(() => {
    const onSel = (e) => setSelected(e.detail.treeId);
    const onDe = () => setSelected(null);
    bus.addEventListener('orchard:select', onSel);
    bus.addEventListener('orchard:deselect', onDe);
    return () => {
      bus.removeEventListener('orchard:select', onSel);
      bus.removeEventListener('orchard:deselect', onDe);
    };
  }, []);

  const setFilter = (k) => { setFilterKey(k); emit('ui:filter', { key: k }); };
  const close = () => { setSelected(null); emit('ui:reset'); };

  return (
    <>
      <SummaryBar total={O.totals.total} />
      <Legend filterKey={filterKey} setFilter={setFilter} totals={O.totals} />
      <DetailPanel treeId={selected} onClose={close} />
      <div className="hint">drag to look · scroll to zoom · click a tree to inspect</div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('ui')).render(<App />);
