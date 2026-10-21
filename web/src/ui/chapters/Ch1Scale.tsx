import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Chapter, SceneProps } from '../course/types';

const FAMILY_COLORS = ['#22d3ee', '#a78bfa', '#34d399', '#f5a524'] as const;
const TAIL_COLOR = '#f87171';
const FAMILY_SIZES = [14, 12, 10, 8] as const;
const TAIL = 4;
const TILE = 30;

interface Tile {
  readonly id: number;
  readonly family: number; // -1 = long tail
  readonly scatter: { x: number; y: number };
  readonly cluster: { x: number; y: number };
  readonly slot: { x: number; y: number };
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTiles(): Tile[] {
  const rand = mulberry32(7);
  const families: number[] = [];
  FAMILY_SIZES.forEach((n, f) => {
    for (let i = 0; i < n; i++) families.push(f);
  });
  for (let i = 0; i < TAIL; i++) families.push(-1);
  // shuffle so the scattered view looks unordered
  const order = families.map((f, i) => ({ f, k: rand(), i }));
  order.sort((a, b) => a.k - b.k);
  const perFamilyIndex = new Map<number, number>();
  return order.map((o, idx) => {
    const col = idx % 12;
    const row = Math.floor(idx / 12);
    const scatter = { x: 40 + col * 52 + (rand() - 0.5) * 14, y: 40 + row * 60 + (rand() - 0.5) * 16 };
    const k = perFamilyIndex.get(o.f) ?? 0;
    perFamilyIndex.set(o.f, k + 1);
    let cluster: { x: number; y: number };
    let slot: { x: number; y: number };
    if (o.f < 0) {
      cluster = { x: 560 + (k % 2) * 40, y: 300 + Math.floor(k / 2) * 40 };
      slot = { x: 560 + k * 38, y: 420 };
    } else {
      const cx = 40 + (o.f % 2) * 260;
      const cy = 20 + Math.floor(o.f / 2) * 160;
      cluster = { x: cx + (k % 5) * 40, y: cy + Math.floor(k / 5) * 40 };
      slot = { x: 120 + k * 32, y: 270 + o.f * 40 };
    }
    return { id: o.i, family: o.f, scatter, cluster, slot };
  });
}

type Phase = 'scatter' | 'visit' | 'cluster' | 'foundation' | 'slot' | 'fix' | 'calc';
const PHASES: readonly Phase[] = ['scatter', 'visit', 'cluster', 'foundation', 'slot', 'fix', 'calc'];

function tilePos(t: Tile, phase: Phase): { x: number; y: number } {
  if (phase === 'scatter' || phase === 'visit') return t.scatter;
  if (phase === 'cluster' || phase === 'foundation') return t.cluster;
  if (t.family < 0) return { x: 660 + (t.id % 4) * 40, y: 372 };
  return t.slot;
}

function tileColor(t: Tile, phase: Phase): string {
  if (phase === 'scatter' || phase === 'visit') return '#3a4a85';
  return t.family < 0 ? TAIL_COLOR : (FAMILY_COLORS[t.family] ?? '#888');
}

function CostMeter({ phase }: { phase: Phase }) {
  const perTicket = phase === 'scatter' ? 0 : 1;
  const classBurst = PHASES.indexOf(phase) >= PHASES.indexOf('foundation') ? 0.32 : 0;
  const classInstances = PHASES.indexOf(phase) >= PHASES.indexOf('slot') ? 0.06 : 0;
  const H = 300;
  return (
    <g transform="translate(860 40)">
      <text x={-10} y={-12} fill="#8f9bc7" fontSize={13}>
        AI spend
      </text>
      <rect x={0} y={0} width={44} height={H} rx={8} fill="#111a3a" stroke="#24315f" />
      <motion.rect
        x={0}
        width={44}
        rx={8}
        fill="#f87171"
        initial={false}
        animate={{ y: H - perTicket * H, height: perTicket * H }}
        transition={{ duration: phase === 'visit' ? 4.2 : 0.6, ease: 'linear' }}
      />
      <text x={22} y={H + 18} textAnchor="middle" fill="#f87171" fontSize={11}>
        per ticket
      </text>
      <rect x={70} y={0} width={44} height={H} rx={8} fill="#111a3a" stroke="#24315f" />
      <motion.rect
        x={70}
        width={44}
        rx={8}
        fill="#a78bfa"
        initial={false}
        animate={{ y: H - classBurst * H, height: classBurst * H }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />
      <motion.rect
        x={70}
        width={44}
        rx={4}
        fill="#34d399"
        initial={false}
        animate={{ y: H - (classBurst + classInstances) * H, height: classInstances * H }}
        transition={{ duration: 1.2, delay: 0.4 }}
      />
      <text x={92} y={H + 18} textAnchor="middle" fill="#a78bfa" fontSize={11}>
        per class
      </text>
    </g>
  );
}

function Calculator() {
  const [n, setN] = useState(120);
  const [perTicket, setPerTicket] = useState(300);
  const [burst, setBurst] = useState(9000);
  const [perInstance, setPerInstance] = useState(2);
  const [tailPct, setTailPct] = useState(8);

  const ticket = (k: number) => k * perTicket;
  const cls = (k: number) => burst + k * (1 - tailPct / 100) * perInstance + k * (tailPct / 100) * perTicket;
  const breakEven = useMemo(() => {
    for (let k = 1; k <= 2000; k++) if (cls(k) < ticket(k)) return k;
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perTicket, burst, perInstance, tailPct]);

  const maxN = 400;
  const maxCost = Math.max(ticket(maxN), cls(maxN));
  const W = 560;
  const H = 300;
  const px = (k: number) => (k / maxN) * W;
  const py = (c: number) => H - (c / maxCost) * H;
  const line = (f: (k: number) => number) =>
    Array.from({ length: 41 }, (_, i) => {
      const k = (i / 40) * maxN;
      return `${i === 0 ? 'M' : 'L'}${px(k).toFixed(1)},${py(f(k)).toFixed(1)}`;
    }).join(' ');

  const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
  const rows: [string, number, (v: number) => void, number, number, number, string][] = [
    ['Instances (N)', n, setN, 5, maxN, 5, String(n)],
    ['Frontier spend / ticket', perTicket, setPerTicket, 50, 1000, 10, money(perTicket)],
    ['Burst per class', burst, setBurst, 1000, 40000, 500, money(burst)],
    ['Spend / slotted instance', perInstance, setPerInstance, 0, 50, 1, money(perInstance)],
    ['Long tail %', tailPct, setTailPct, 0, 60, 1, `${String(tailPct)}%`],
  ];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 24, height: '100%', alignItems: 'center' }}
    >
      <div className="panel" style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontWeight: 650 }}>Your numbers</div>
        {rows.map(([label, value, set, min, max, step, shown]) => (
          <label key={label} className="slider-row" style={{ gridTemplateColumns: '150px 1fr 70px' }}>
            {label}
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={(e) => set(Number(e.target.value))}
            />
            <output>{shown}</output>
          </label>
        ))}
        <div style={{ fontSize: 14, marginTop: 6, lineHeight: 1.5 }}>
          At N = <b>{n}</b>: per-ticket <b style={{ color: 'var(--bad)' }}>{money(ticket(n))}</b> vs per-class{' '}
          <b style={{ color: 'var(--ok)' }}>{money(cls(n))}</b>
          <br />
          {breakEven === null ? (
            <span className="pill bad">No break-even below 2,000 instances</span>
          ) : (
            <span className="pill ok">Break-even at N ≈ {breakEven}</span>
          )}
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
          total ≈ burst + N × (1 − tail) × slotted + N × tail × ticket
        </div>
      </div>
      <svg viewBox={`-50 -20 ${String(W + 90)} ${String(H + 60)}`} className="canvas" style={{ maxHeight: 420 }}>
        <line x1={0} y1={H} x2={W} y2={H} stroke="#24315f" />
        <line x1={0} y1={0} x2={0} y2={H} stroke="#24315f" />
        <text x={W} y={H + 30} fill="#8f9bc7" fontSize={12} textAnchor="end">
          instances →
        </text>
        <text x={-10} y={-6} fill="#8f9bc7" fontSize={12}>
          total spend
        </text>
        <path d={line(ticket)} stroke="#f87171" strokeWidth={3} fill="none" />
        <path d={line(cls)} stroke="#34d399" strokeWidth={3} fill="none" />
        {breakEven !== null && breakEven <= maxN && (
          <g>
            <line x1={px(breakEven)} x2={px(breakEven)} y1={0} y2={H} stroke="#a78bfa" strokeDasharray="4 5" />
            <circle cx={px(breakEven)} cy={py(ticket(breakEven))} r={6} fill="#a78bfa" />
            <text x={px(breakEven) + 8} y={14} fill="#a78bfa" fontSize={12}>
              break-even
            </text>
          </g>
        )}
        <line x1={px(n)} x2={px(n)} y1={0} y2={H} stroke="#e8ecff44" />
        <text x={W - 4} y={py(ticket(maxN)) + 16} fill="#f87171" fontSize={12} textAnchor="end">
          one ticket at a time
        </text>
        <text x={W - 4} y={py(cls(maxN)) - 8} fill="#34d399" fontSize={12} textAnchor="end">
          one class, many slots
        </text>
      </svg>
    </motion.div>
  );
}

function Scene({ beat }: SceneProps) {
  const tiles = useMemo(buildTiles, []);
  const phase = PHASES[beat] ?? 'scatter';
  if (phase === 'calc') return <Calculator />;
  const showFoundation = PHASES.indexOf(phase) >= PHASES.indexOf('foundation');

  return (
    <svg viewBox="0 0 1000 480" className="canvas" role="img" aria-label="Instances, families and slots">
      <AnimatePresence>
        {showFoundation && (
          <motion.g key="foundation" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <rect x={20} y={248} width={600} height={190} rx={18} fill="#0d1430" stroke="#a78bfa" strokeDasharray="6 6" />
            <text x={36} y={240} fill="#a78bfa" fontSize={14} fontWeight={700}>
              FOUNDATION · one slot row per family
            </text>
            {FAMILY_SIZES.map((size, f) => (
              <g key={f}>
                <text x={36} y={290 + f * 40} fill={FAMILY_COLORS[f]} fontSize={12}>
                  family {String.fromCharCode(65 + f)}
                </text>
                {Array.from({ length: size }, (_, k) => (
                  <rect
                    key={k}
                    x={120 + k * 32}
                    y={270 + f * 40}
                    width={TILE - 4}
                    height={TILE - 4}
                    rx={6}
                    fill="none"
                    stroke={FAMILY_COLORS[f]}
                    strokeOpacity={0.45}
                  />
                ))}
              </g>
            ))}
            <g transform="translate(645 250)">
              <rect width={180} height={64} rx={14} fill="#1b1540" stroke="#a78bfa" />
              <text x={90} y={28} textAnchor="middle" fill="#e8ecff" fontSize={13} fontWeight={650}>
                Transformer
              </text>
              <text x={90} y={47} textAnchor="middle" fill="#a78bfa" fontSize={10}>
                built once · senior + strong model
              </text>
            </g>
            <rect x={645} y={350} width={180} height={88} rx={14} fill="none" stroke={TAIL_COLOR} strokeOpacity={0.5} strokeDasharray="4 5" />
            <text x={655} y={366} fill={TAIL_COLOR} fontSize={11}>
              long tail · by hand
            </text>
          </motion.g>
        )}
      </AnimatePresence>
      {phase === 'cluster' &&
        FAMILY_SIZES.map((_, f) => (
          <motion.text
            key={f}
            x={40 + (f % 2) * 260}
            y={14 + Math.floor(f / 2) * 160}
            fill={FAMILY_COLORS[f]}
            fontSize={13}
            fontWeight={700}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
          >
            family {String.fromCharCode(65 + f)} · same shape ×{FAMILY_SIZES[f]}
          </motion.text>
        ))}
      {tiles.map((t, i) => {
        const p = tilePos(t, phase);
        const isTail = t.family < 0;
        const bounce = phase === 'slot' && isTail;
        return (
          <motion.g
            key={t.id}
            initial={{ x: p.x, y: p.y, opacity: 0, scale: 0.4 }}
            animate={{
              x: bounce ? [t.cluster.x, 300, 340, p.x] : p.x,
              y: bounce ? [t.cluster.y, 300, 260, p.y] : p.y,
              opacity: 1,
              scale: phase === 'fix' && !isTail ? [1, 1.35, 1] : 1,
            }}
            transition={{
              duration: bounce ? 1.6 : 0.9,
              delay:
                phase === 'scatter'
                  ? i * 0.02
                  : phase === 'slot'
                    ? i * 0.035
                    : phase === 'fix'
                      ? (t.slot.x - 120) / 900
                      : 0,
              ease: 'easeInOut',
            }}
          >
            <motion.rect
              width={TILE - 4}
              height={TILE - 4}
              rx={6}
              initial={false}
              animate={{
                fill:
                  phase === 'visit'
                    ? ['#3a4a85', '#f87171', '#5b3b55']
                    : phase === 'fix' && !isTail
                      ? ['#34d399', '#e8ecff', tileColor(t, phase)]
                      : tileColor(t, phase),
              }}
              transition={{
                duration: phase === 'visit' ? 0.5 : 0.6,
                delay: phase === 'visit' ? i * 0.088 : phase === 'fix' ? (t.slot.x - 120) / 900 : 0,
              }}
            />
            <rect x={6} y={7} width={14} height={2.5} rx={1} fill="#ffffff55" />
            <rect x={6} y={12} width={10} height={2.5} rx={1} fill="#ffffff40" />
            <rect x={6} y={17} width={12} height={2.5} rx={1} fill="#ffffff30" />
          </motion.g>
        );
      })}
      {phase === 'visit' && (
        <motion.g
          initial={{ x: 0, y: 0 }}
          animate={{
            x: tiles.map((t) => t.scatter.x + 6),
            y: tiles.map((t) => t.scatter.y - 18),
          }}
          transition={{ duration: 4.2, ease: 'linear' }}
        >
          <circle r={9} fill="#f87171" />
          <text y={4} textAnchor="middle" fontSize={10} fill="#1a0b0b" fontWeight={800}>
            AI
          </text>
        </motion.g>
      )}
      <CostMeter phase={phase} />
    </svg>
  );
}

export const scaleChapter: Chapter = {
  id: 'scale',
  title: 'The pattern you keep paying for',
  subtitle: 'Think once per class, not once per ticket',
  beats: [
    {
      caption: 'A legacy system holds hundreds of rules, forms and pages. Each square is one of them.',
      detail: 'In this course the instances are the business rules of LoanDesk, a 2004-era loan system.',
      ms: 4500,
    },
    {
      caption: 'Today we migrate them one ticket at a time: one engineer and one frontier model per square, again and again.',
      detail: 'Nobody keeps the reasoning, so the same thoughts get paid for N times. AI cost grows with headcount.',
      ms: 6000,
    },
    {
      caption: 'Look across all of them at once and the same shapes repeat. Agents are good at finding these families.',
      detail: 'A family is a set of instances with the same values on the important variation axes. A human confirms each one.',
      ms: 5500,
    },
    {
      caption: 'So think once per family: a senior engineer and a strong model build a foundation with slots, plus a transformer.',
      detail: 'This is a spend burst, but it is an investment in the whole class, not in one ticket.',
      ms: 5500,
    },
    {
      caption: 'Now each instance just slots in, run by a script or a small model. Misfits bounce out to a short long tail.',
      detail: 'A misfit is a signal: a new family, a new axis, or a change to the foundation.',
      ms: 6500,
    },
    {
      caption: 'A mistake spreads across the whole class, and so does the fix. Fix the generator once and every instance is repaired.',
      detail: 'Generated artifacts are treated like compiled binaries: regenerate them, never hand-edit them.',
      ms: 5000,
    },
    {
      caption: 'Try your own numbers. Where is your break-even point?',
      detail: 'Below break-even, migrating by hand is cheaper. That is fine: measure N first.',
      ms: 60000,
    },
  ],
  Scene,
};
