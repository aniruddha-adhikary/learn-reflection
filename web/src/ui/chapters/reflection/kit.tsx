import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import type { LabValue } from '../../../porter';

export const AMBER = '#f5a524';
export const CYAN = '#22d3ee';
export const GREEN = '#34d399';
export const RED = '#f87171';
export const VIOLET = '#a78bfa';

export function short(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? name : name.slice(dot + 1);
}

export function pkg(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(0, dot);
}

export function worldColor(name: string): string {
  if (name.startsWith('legacy.')) return AMBER;
  if (name.startsWith('modern.')) return CYAN;
  throw new Error(`Class ${name} is neither legacy nor modern`);
}

export function simpleName(value: LabValue): string {
  if (value !== null && typeof value === 'object' && 'object' in value) return short(value.object);
  return fmt(value);
}

export function fmt(value: LabValue): string {
  if (value === null) return 'null';
  if (typeof value === 'object') return 'object' in value ? `‹${short(value.object)}›` : `[${value.map(fmt).join(', ')}]`;
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

export function Code({ children, delay = 0, dim = false }: { children: string; delay?: number; dim?: boolean }) {
  return (
    <motion.pre
      className="mono"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: dim ? 0.45 : 1, y: 0 }}
      transition={{ delay }}
      style={{ margin: 0, padding: '10px 14px', borderRadius: 10, background: '#0b1022', border: '1px solid #232b4a', fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: '#e8ecff' }}
    >
      {children}
    </motion.pre>
  );
}

export function Panel({ title, color, children, delay = 0 }: { title: string; color: string; children: ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay }}
      style={{ border: `1px solid ${color}55`, borderRadius: 14, padding: 14, background: `${color}0d`, display: 'grid', gap: 8, alignContent: 'start' }}
    >
      <div className="kicker" style={{ color }}>{title}</div>
      {children}
    </motion.div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <div style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.5 }}>{children}</div>;
}
