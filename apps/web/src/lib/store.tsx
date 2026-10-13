import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AtlasPayload, Health } from '@cortex/core';
import { api } from './api.ts';

interface Vault {
  atlas: AtlasPayload | null;
  health: Health | null;
  due: number;
  refresh: () => Promise<void>;
  toast: (msg: string, bad?: boolean) => void;
  openPalette: () => void;
}

const Ctx = createContext<Vault | null>(null);

export function useVault() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useVault outside VaultProvider');
  return v;
}

export function VaultProvider({ children, onPalette }: { children: ReactNode; onPalette: () => void }) {
  const [atlas, setAtlas] = useState<AtlasPayload | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [due, setDue] = useState(0);
  const [toastMsg, setToast] = useState<{ msg: string; bad: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const toast = useCallback((msg: string, bad = false) => {
    setToast({ msg, bad });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), bad ? 6000 : 3200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([api.atlas(), api.session('due')]);
      setAtlas(a);
      setDue(s.dueTotal);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not reach the server.', true);
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
    api.health().then(setHealth).catch(() => setHealth({ ai: 'offline', provider: null, model: null }));
  }, [refresh]);

  const value = useMemo(() => ({ atlas, health, due, refresh, toast, openPalette: onPalette }), [atlas, health, due, refresh, toast, onPalette]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {toastMsg && (
        <div className={`toast${toastMsg.bad ? ' bad' : ''}`} role="status" aria-live="polite">
          {toastMsg.msg}
        </div>
      )}
    </Ctx.Provider>
  );
}

export function usePrint(): ['negative' | 'positive', (p: 'negative' | 'positive') => void] {
  const read = () => {
    const explicit = document.documentElement.dataset.print as 'negative' | 'positive' | undefined;
    if (explicit) return explicit;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'positive' : 'negative';
  };
  const [print, setPrint] = useState(read);
  const set = useCallback((p: 'negative' | 'positive') => {
    document.documentElement.dataset.print = p;
    try {
      localStorage.setItem('cortex.print', p);
    } catch {
      /* storage may be unavailable */
    }
    setPrint(p);
    window.dispatchEvent(new Event('cortex:print'));
  }, []);
  return [print, set];
}

export function relDays(iso: string, now = Date.now()): string {
  const d = Math.round((now - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function fmtDays(d: number): string {
  if (!Number.isFinite(d)) return 'not within a year';
  if (d < 1) return 'today';
  if (d < 1.5) return 'tomorrow';
  if (d < 60) return `in ${Math.round(d)} days`;
  return `in ${Math.round(d / 30)} months`;
}
