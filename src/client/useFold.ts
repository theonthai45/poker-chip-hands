import { useEffect, useState } from 'react';

/** How the table should arrange itself around a fold. */
export type FoldLayout = 'tabletop' | 'book' | null;
export type FoldPref = 'auto' | 'off' | 'tabletop' | 'book';

const KEY = 'fold';
// Viewport Segments API: the browser reports two screen halves when the device is partly folded.
const STACKED = '(vertical-viewport-segments: 2)';
const SIDE_BY_SIDE = '(horizontal-viewport-segments: 2)';

function readPref(): FoldPref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'off' || v === 'tabletop' || v === 'book') return v;
  } catch {
    /* private mode */
  }
  return 'auto';
}

function detect(): FoldLayout {
  if (typeof matchMedia !== 'function') return null;
  if (matchMedia(STACKED).matches) return 'tabletop';
  if (matchMedia(SIDE_BY_SIDE).matches) return 'book';
  return null;
}

/**
 * Picks a split layout when the phone is half folded: `tabletop` when the halves
 * are stacked (bottom half flat on the table), `book` when they are side by side.
 * Browsers that do not report the fold can be switched by hand.
 */
export function useFold() {
  const [pref, setPrefState] = useState<FoldPref>(readPref);
  const [detected, setDetected] = useState<FoldLayout>(detect);

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const queries = [matchMedia(STACKED), matchMedia(SIDE_BY_SIDE)];
    const update = () => setDetected(detect());
    for (const q of queries) q.addEventListener('change', update);
    return () => {
      for (const q of queries) q.removeEventListener('change', update);
    };
  }, []);

  const setPref = (p: FoldPref) => {
    setPrefState(p);
    try {
      localStorage.setItem(KEY, p);
    } catch {
      /* private mode */
    }
  };

  const layout: FoldLayout = pref === 'auto' ? detected : pref === 'off' ? null : pref;
  return { layout, pref, setPref, detected };
}
