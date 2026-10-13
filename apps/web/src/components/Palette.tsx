import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { useVault } from '../lib/store.tsx';

interface Item {
  group: string;
  label: string;
  sub?: string;
  meta?: string;
  run: () => void;
}

export function Palette({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const { atlas } = useVault();
  const [q, setQ] = useState('');
  const [passages, setPassages] = useState<{ chunkId: number; sourceId: number; accession: string; text: string }[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setPassages([]);
      return;
    }
    const t = window.setTimeout(() => api.search(term).then((r) => setPassages(r.passages)).catch(() => {}), 160);
    return () => window.clearTimeout(t);
  }, [q]);

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => {
      nav(to);
      onClose();
    };
    const actions: Item[] = [
      { group: 'Go', label: 'Accession a source', meta: 'A', run: go('/accession') },
      { group: 'Go', label: 'Start an observing session', meta: 'S', run: go('/session') },
      { group: 'Go', label: 'Review fading stars', run: go('/session?mode=fading') },
      { group: 'Go', label: 'Explain something back', run: go('/session?mode=explain') },
      { group: 'Go', label: 'Ask the vault', run: go('/ask') },
      { group: 'Go', label: 'Uncatalogued objects (gaps)', run: go('/gaps') },
      { group: 'Go', label: 'Observing log', run: go('/log') },
    ];
    const term = q.trim().toLowerCase();
    const concepts: Item[] = (atlas?.concepts ?? [])
      .filter((c) => !term || c.name.toLowerCase().includes(term) || c.catalog.toLowerCase().includes(term) || c.aliases.some((a) => a.toLowerCase().includes(term)))
      .slice(0, term ? 8 : 5)
      .map((c) => ({ group: 'Objects', label: c.name, meta: c.catalog, sub: c.summary, run: go(`/?c=${c.id}`) }));
    const found: Item[] = passages.map((p) => ({ group: 'In your sources', label: p.text.slice(0, 90), meta: p.accession, run: go(`/sources?open=${p.sourceId}`) }));
    const acts = term ? actions.filter((a) => a.label.toLowerCase().includes(term)) : actions;
    return [...concepts, ...found, ...acts];
  }, [q, atlas, passages, nav, onClose]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  let lastGroup = '';
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Find and go">
        <input
          className="field"
          autoFocus
          placeholder="Find an object, a passage, or a place…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-controls="palette-list"
          aria-activedescendant={`pi-${active}`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') items[active]?.run();
          }}
        />
        <ul id="palette-list" ref={listRef} role="listbox">
          {items.length === 0 && <li className="group">Nothing matches.</li>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <li key={`${it.group}-${i}`}>
                {head && <div className="group">{head}</div>}
                <button id={`pi-${i}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={it.run}>
                  <span>{it.label}</span>
                  {it.meta ? <span className="cat">{it.meta}</span> : <span />}
                  {it.sub && <span className="sub">{it.sub}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
