import type { CSSProperties } from 'react';
import { money } from '../shared/chips';

function textOn(bg: string) {
  const n = parseInt(bg.slice(1), 16);
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? '#1a1a1a' : '#ffffff';
}

export function Chip({ value, color, size = 48, style }: { value: number; color: string; size?: number; style?: CSSProperties }) {
  return (
    <div
      className="chip"
      style={{ width: size, height: size, fontSize: size * 0.27, background: color, color: textOn(color), ...style }}
    >
      <span>{money(value).replace('$', '')}</span>
    </div>
  );
}

/** A vertical stack of identical chips, drawn with offset edges. */
export function ChipStack({ value, color, count, size = 48 }: { value: number; color: string; count: number; size?: number }) {
  const shown = Math.min(count, 8);
  return (
    <div className="stack" style={{ width: size, height: size + shown * 4 }}>
      {Array.from({ length: shown }, (_, i) => (
        <Chip key={i} value={value} color={color} size={size} style={{ position: 'absolute', bottom: i * 4, left: 0 }} />
      ))}
    </div>
  );
}
