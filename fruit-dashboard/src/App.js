import { useState, useEffect } from 'react';
import Dashboard from './Dashboard';
import OrchardMap from './OrchardMap';
import './App.css';

const API_BASE_URL = 'http://localhost:5000/api';

function App() {
  const [tab, setTab] = useState('orchard');
  const [sessionId, setSessionId] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE_URL}/sessions`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(sessions => { if (sessions?.length) setSessionId(sessions[0].sessionId); })
      .catch(() => {});
  }, []);

  return (
    <div className="pomona-shell">
      <nav className="pomona-tabs">
        <button
          className={`pomona-tab-btn${tab === 'orchard' ? ' active' : ''}`}
          onClick={() => setTab('orchard')}
        >
          Orchard
        </button>
        <button
          className={`pomona-tab-btn${tab === 'stats' ? ' active' : ''}`}
          onClick={() => setTab('stats')}
        >
          Stats
        </button>
      </nav>
      <div className="pomona-content">
        {tab === 'orchard' && <OrchardMap sessionId={sessionId} />}
        {tab === 'stats' && <Dashboard sessionId={sessionId} />}
      </div>
    </div>
  );
}

export default App;
