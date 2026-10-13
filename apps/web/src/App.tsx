import { useCallback, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { VaultProvider, usePrint, useVault } from './lib/store.tsx';
import { Icon, PlateMark, type IconName } from './components/Icon.tsx';
import { Palette } from './components/Palette.tsx';
import { AtlasPage } from './atlas/AtlasPage.tsx';
import { AccessionPage } from './pages/Accession.tsx';
import { SessionPage } from './pages/Session.tsx';
import { GapsPage } from './pages/Gaps.tsx';
import { AskPage } from './pages/Ask.tsx';
import { SourcesPage } from './pages/Sources.tsx';
import { LogPage } from './pages/Log.tsx';

export function App() {
  const [palette, setPalette] = useState(false);
  const open = useCallback(() => setPalette(true), []);
  return (
    <VaultProvider onPalette={open}>
      <Shell />
      {palette && <Palette onClose={() => setPalette(false)} />}
      <Keys onPalette={open} />
    </VaultProvider>
  );
}

function Shell() {
  const { due, atlas, health, openPalette } = useVault();
  const [print, setPrint] = usePrint();
  const loc = useLocation();
  const gaps = atlas?.gaps.length ?? 0;

  const links: [to: string, label: string, icon: IconName, count?: number, hot?: boolean][] = [
    ['/', 'Atlas', 'atlas'],
    ['/accession', 'Accession', 'accession'],
    ['/session', 'Session', 'session', due, due > 0],
    ['/gaps', 'Gaps', 'gaps', gaps, gaps > 0],
    ['/ask', 'Ask', 'ask'],
    ['/sources', 'Sources', 'sources'],
    ['/log', 'Log', 'log'],
  ];

  useEffect(() => {
    const name = links.find(([to]) => to !== '/' && loc.pathname.startsWith(to))?.[1];
    document.title = name ? `${name} · CortexOrbit` : 'CortexOrbit';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname]);

  const night = print === 'positive';

  return (
    <div className="shell">
      <header className="topbar">
        <nav className="pillnav" aria-label="Main">
          <NavLink to="/" className="mark" aria-label="CortexOrbit atlas">
            <PlateMark />
            <b>
              Cortex<span>Orbit</span>
            </b>
          </NavLink>
          <div className="nav">
            {links.map(([to, label, icon, count, hot]) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                <Icon name={icon} size={18} />
                {label}
                {count ? <span className={`count${hot ? ' hot' : ''}`}>{count}</span> : null}
              </NavLink>
            ))}
          </div>
          <div className="nav-right">
            <span
              className={`ai-dot${health?.ai === 'online' ? ' on' : ''}`}
              title={health?.ai === 'online' ? `Extraction, grading and answers by ${health.provider} · ${health.model}` : 'Offline: add a Claude, Gemini, OpenRouter or Groq key to .env (or run Ollama) for AI extraction, grading and answers'}
            >
              <span>{health?.ai === 'online' ? health.provider : 'Offline'}</span>
            </span>
            <button className="icon-btn" onClick={openPalette} aria-label="Find anything (Ctrl K)" title="Find anything (Ctrl K)">
              <Icon name="search" size={18} />
            </button>
            <button
              className="icon-btn"
              onClick={() => setPrint(night ? 'negative' : 'positive')}
              aria-label={night ? 'Switch to daylight' : 'Switch to night'}
              title={night ? 'Daylight' : 'Night'}
            >
              <Icon name={night ? 'sun' : 'moon'} size={18} />
            </button>
          </div>
        </nav>
      </header>
      <main className="main" id="main">
        <Routes>
          <Route path="/" element={<AtlasPage />} />
          <Route path="/accession" element={<AccessionPage />} />
          <Route path="/session" element={<SessionPage />} />
          <Route path="/gaps" element={<GapsPage />} />
          <Route path="/ask" element={<AskPage />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="/log" element={<LogPage />} />
          <Route path="*" element={<AtlasPage />} />
        </Routes>
      </main>
    </div>
  );
}

function Keys({ onPalette }: { onPalette: () => void }) {
  const nav = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onPalette();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') {
        const finder = document.getElementById('finder');
        if (finder) {
          e.preventDefault();
          finder.focus();
        } else {
          e.preventDefault();
          onPalette();
        }
      } else if (e.key === 'g') {
        nav('/');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav, onPalette]);
  return null;
}
