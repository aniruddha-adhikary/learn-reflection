import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Chapter, SceneProps } from '../course/types';

const KIND_COLORS = ['#22d3ee', '#a78bfa', '#34d399', '#f5a524'] as const;
const ODD_COLOR = '#f87171';
const GREY = '#3a4a85';

interface Kind {
  readonly sentence: readonly [string, string];
  readonly short: (v: string) => string;
  readonly values: readonly string[];
}

const KINDS: readonly Kind[] = [
  { sentence: ['If credit score is below', '→ decline'], short: (v) => `score < ${v} → decline`, values: ['540', '560', '580', '600', '620', '640', '660'] },
  { sentence: ['If debt is over', '% of income → decline'], short: (v) => `debt > ${v}% → decline`, values: ['35', '38', '40', '42', '45', '50'] },
  { sentence: ['If country is', '→ send to a person'], short: (v) => `country ${v} → person`, values: ['XA', 'XB', 'XC', 'XD', 'XE'] },
  { sentence: ['If loan is over', '× yearly income → ask for security'], short: (v) => `loan > ${v}× income → security`, values: ['3', '4', '5', '6'] },
];
const ODD_ONES = ['staff loans: special path', 'split co-signers on ";"'] as const;

const CARD_W = 160;
const CARD_H = 32;
const CHIP_W = 50;

interface Card {
  readonly id: number;
  readonly kind: number; // -1 = odd one out
  readonly label: string;
  readonly value: string;
  readonly scatter: { x: number; y: number };
  readonly grouped: { x: number; y: number };
  readonly slotted: { x: number; y: number };
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

const GROUP_ORIGIN = [
  { x: 20, y: 34 },
  { x: 430, y: 34 },
  { x: 20, y: 254 },
  { x: 430, y: 254 },
] as const;
const ROW_Y = (k: number) => 92 + k * 74;
const SLOT_X = 360;

function buildCards(): Card[] {
  const rand = mulberry32(11);
  const base: { kind: number; label: string; value: string; k: number }[] = [];
  KINDS.forEach((kind, f) => {
    kind.values.forEach((v, k) => base.push({ kind: f, label: kind.short(v), value: v, k }));
  });
  ODD_ONES.forEach((label, k) => base.push({ kind: -1, label, value: '', k }));
  const shuffled = base.map((b) => ({ b, r: rand() })).sort((p, q) => p.r - q.r);
  return shuffled.map(({ b }, idx) => {
    const scatter = { x: 20 + (idx % 5) * 165 + (rand() - 0.5) * 10, y: 50 + Math.floor(idx / 5) * 62 + (rand() - 0.5) * 10 };
    let grouped: { x: number; y: number };
    let slotted: { x: number; y: number };
    if (b.kind < 0) {
      grouped = { x: 640 + b.k * 0, y: 440 + b.k * 38 };
      slotted = { x: 660, y: 418 + b.k * 38 };
    } else {
      const o = GROUP_ORIGIN[b.kind] ?? { x: 0, y: 0 };
      grouped = { x: o.x + 14 + (b.k % 2) * 180, y: o.y + 40 + Math.floor(b.k / 2) * 40 };
      slotted = { x: SLOT_X + b.k * (CHIP_W + 8), y: ROW_Y(b.kind) + 30 };
    }
    return { id: idx, kind: b.kind, label: b.label, value: b.value, scatter, grouped, slotted };
  });
}

type Phase = 'scatter' | 'byhand' | 'group' | 'template' | 'slot' | 'fix' | 'calc';
const PHASES: readonly Phase[] = ['scatter', 'byhand', 'group', 'template', 'slot', 'fix', 'calc'];
const atLeast = (phase: Phase, p: Phase) => PHASES.indexOf(phase) >= PHASES.indexOf(p);

function cardColor(c: Card, phase: Phase): string {
  if (phase === 'scatter' || phase === 'byhand') return GREY;
  return c.kind < 0 ? ODD_COLOR : (KIND_COLORS[c.kind] ?? GREY);
}

function CostMeter({ phase }: { phase: Phase }) {
  const oneByOne = phase === 'scatter' ? 0 : 1;
  const build = atLeast(phase, 'template') ? 0.3 : 0;
  const after = atLeast(phase, 'slot') ? 0.07 : 0;
  const H = 300;
  return (
    <g transform="translate(880 70)">
      <text x={50} y={-28} fill="#e8ecff" fontSize={13} fontWeight={650} textAnchor="middle">
        Time &amp; money
      </text>
      <text x={50} y={-12} fill="#8f9bc7" fontSize={11} textAnchor="middle">
        spent so far
      </text>
      <rect x={0} y={0} width={40} height={H} rx={8} fill="#111a3a" stroke="#24315f" />
      <motion.rect x={0} width={40} rx={8} fill={ODD_COLOR} initial={false} animate={{ y: H - oneByOne * H, height: oneByOne * H }} transition={{ duration: phase === 'byhand' ? 4.5 : 0.6, ease: 'linear' }} />
      <text x={20} y={H + 18} textAnchor="middle" fill={ODD_COLOR} fontSize={11}>
        one by one
      </text>
      <rect x={60} y={0} width={40} height={H} rx={8} fill="#111a3a" stroke="#24315f" />
      <motion.rect x={60} width={40} rx={8} fill="#a78bfa" initial={false} animate={{ y: H - build * H, height: build * H }} transition={{ duration: 0.8 }} />
      <motion.rect x={60} width={40} rx={4} fill="#34d399" initial={false} animate={{ y: H - (build + after) * H, height: after * H }} transition={{ duration: 1.2, delay: 0.4 }} />
      <text x={80} y={H + 18} textAnchor="middle" fill="#a78bfa" fontSize={11}>
        template
      </text>
      <text x={80} y={H + 32} textAnchor="middle" fill="#a78bfa" fontSize={11}>
        way
      </text>
    </g>
  );
}

function Calculator({ engineer }: { engineer: boolean }) {
  const [n, setN] = useState(120);
  const [perRule, setPerRule] = useState(300);
  const [build, setBuild] = useState(9000);
  const [after, setAfter] = useState(2);
  const [oddPct, setOddPct] = useState(8);

  const byHand = (k: number) => k * perRule;
  const templ = (k: number) => build + k * (1 - oddPct / 100) * after + k * (oddPct / 100) * perRule;
  const breakEven = useMemo(() => {
    for (let k = 1; k <= 2000; k++) {
      if (build + k * (1 - oddPct / 100) * after + k * (oddPct / 100) * perRule < k * perRule) return k;
    }
    return null;
  }, [perRule, build, after, oddPct]);

  const maxN = 400;
  const maxCost = Math.max(byHand(maxN), templ(maxN));
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
    ['How many rules', n, setN, 5, maxN, 5, String(n)],
    ['Rewrite one rule by hand', perRule, setPerRule, 50, 1000, 10, money(perRule)],
    ['Build templates + tool (once)', build, setBuild, 1000, 40000, 500, money(build)],
    ['Each rule after that', after, setAfter, 0, 50, 1, money(after)],
    ['Odd ones out (by hand)', oddPct, setOddPct, 0, 60, 1, `${String(oddPct)}%`],
  ];

  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 24, height: '100%', alignItems: 'center' }}>
      <div className="panel" style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontWeight: 650 }}>Your numbers</div>
        {rows.map(([label, value, set, min, max, step, shown]) => (
          <label key={label} className="slider-row" style={{ gridTemplateColumns: '170px 1fr 70px' }}>
            {label}
            <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} />
            <output>{shown}</output>
          </label>
        ))}
        <div style={{ fontSize: 14, marginTop: 6, lineHeight: 1.6 }}>
          For <b>{n}</b> rules: one by one costs <b style={{ color: 'var(--bad)' }}>{money(byHand(n))}</b>, the template way costs{' '}
          <b style={{ color: 'var(--ok)' }}>{money(templ(n))}</b>
          <br />
          {breakEven === null ? (
            <span className="pill bad">The template way never pays off here</span>
          ) : (
            <span className="pill ok">Pays off from {breakEven} rules</span>
          )}
        </div>
        {engineer && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
            total ≈ burst + N × (1 − tail) × per-instance + N × tail × per-ticket
          </div>
        )}
      </div>
      <svg viewBox={`-50 -20 ${String(W + 90)} ${String(H + 60)}`} className="canvas" style={{ maxHeight: 420 }}>
        <line x1={0} y1={H} x2={W} y2={H} stroke="#24315f" />
        <line x1={0} y1={0} x2={0} y2={H} stroke="#24315f" />
        <text x={W} y={H + 30} fill="#8f9bc7" fontSize={12} textAnchor="end">
          number of rules →
        </text>
        <text x={-10} y={-6} fill="#8f9bc7" fontSize={12}>
          total cost
        </text>
        <path d={line(byHand)} stroke={ODD_COLOR} strokeWidth={3} fill="none" />
        <path d={line(templ)} stroke="#34d399" strokeWidth={3} fill="none" />
        {breakEven !== null && breakEven <= maxN && (
          <g>
            <line x1={px(breakEven)} x2={px(breakEven)} y1={0} y2={H} stroke="#a78bfa" strokeDasharray="4 5" />
            <circle cx={px(breakEven)} cy={py(byHand(breakEven))} r={6} fill="#a78bfa" />
            <text x={px(breakEven) + 8} y={14} fill="#a78bfa" fontSize={12}>
              pays off here
            </text>
          </g>
        )}
        <line x1={px(n)} x2={px(n)} y1={0} y2={H} stroke="#e8ecff44" />
        <text x={px(maxN * 0.62) - 10} y={py(byHand(maxN * 0.62)) - 10} fill={ODD_COLOR} fontSize={12} textAnchor="end">
          one by one
        </text>
        <text x={W - 4} y={py(templ(maxN)) - 10} fill="#34d399" fontSize={12} textAnchor="end">
          template way
        </text>
      </svg>
    </motion.div>
  );
}

function Templates({ phase, engineer }: { phase: Phase; engineer: boolean }) {
  return (
    <motion.g key="templates" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <text x={20} y={40} fill="#e8ecff" fontSize={15} fontWeight={700}>
        {engineer ? 'Foundation: one slot row per family' : 'Fill-in-the-blank templates, built once'}
      </text>
      <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
        <motion.rect x={SLOT_X} y={22} width={300} height={28} rx={14} fill="#1b1540" initial={false} animate={{ stroke: phase === 'fix' ? ['#a78bfa', ODD_COLOR, ODD_COLOR, '#34d399', '#34d399'] : '#a78bfa' }} transition={{ duration: 4.5, times: [0, 0.1, 0.5, 0.6, 1] }} />
        {phase === 'fix' ? (
          <>
            <motion.text x={SLOT_X + 150} y={41} fill={ODD_COLOR} fontSize={12} fontWeight={700} textAnchor="middle" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0, 0] }} transition={{ duration: 4.5, times: [0, 0.1, 0.5, 0.6, 1] }}>
              ✗ bug in the tool: “below” copied as “at or below”
            </motion.text>
            <motion.text x={SLOT_X + 150} y={41} fill="#34d399" fontSize={12} fontWeight={700} textAnchor="middle" initial={{ opacity: 0 }} animate={{ opacity: [0, 0, 0, 1, 1] }} transition={{ duration: 4.5, times: [0, 0.1, 0.5, 0.6, 1] }}>
              ✓ tool fixed once → all 7 rules fixed
            </motion.text>
          </>
        ) : (
          <text x={SLOT_X + 150} y={41} fill="#e8ecff" fontSize={12} textAnchor="middle">
            {engineer ? 'Transformer copies each old value ↓' : 'A tool copies each old rule’s number ↓'}
          </text>
        )}
      </motion.g>
      {KINDS.map((kind, f) => {
        const y = ROW_Y(f);
        const color = KIND_COLORS[f] ?? GREY;
        return (
          <g key={f}>
            <rect x={14} y={y} width={830} height={66} rx={14} fill="#0d1430" stroke={color} strokeOpacity={0.5} />
            <text x={30} y={y + 22} fill={color} fontSize={13} fontWeight={650}>
              {kind.sentence[0]}
              <tspan dx={6} fill="#e8ecff" fontFamily="JetBrains Mono Variable, monospace">[ ___ ]</tspan>
              <tspan dx={6}>{kind.sentence[1]}</tspan>
            </text>
            <text x={30} y={y + 48} fill="#8f9bc7" fontSize={11}>
              {phase === 'template' ? 'blanks are empty…' : `${String(kind.values.length)} old rules filled in`}
            </text>
          </g>
        );
      })}
      <rect x={640} y={400} width={204} height={96} rx={14} fill="none" stroke={ODD_COLOR} strokeOpacity={0.6} strokeDasharray="4 5" />
      <text x={652} y={414} fill={ODD_COLOR} fontSize={11} fontWeight={650}>
        odd ones out · done by hand
      </text>
    </motion.g>
  );
}

function Scene({ beat, engineer }: SceneProps) {
  const cards = useMemo(buildCards, []);
  const phase = PHASES[beat] ?? 'scatter';
  if (phase === 'calc') return <Calculator engineer={engineer} />;
  const slottedView = atLeast(phase, 'slot');

  return (
    <svg viewBox="0 0 1000 510" className="canvas" role="img" aria-label="Business rules, grouped and filled into templates">
      {phase === 'group' &&
        KINDS.map((kind, f) => {
          const o = GROUP_ORIGIN[f] ?? { x: 0, y: 0 };
          const color = KIND_COLORS[f] ?? GREY;
          return (
            <motion.g key={f} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
              <rect x={o.x} y={o.y} width={390} height={200} rx={16} fill="#0d1430" stroke={color} strokeOpacity={0.45} />
              <text x={o.x + 14} y={o.y + 24} fill={color} fontSize={13} fontWeight={700}>
                {kind.sentence[0]} ___ {kind.sentence[1]}
              </text>
            </motion.g>
          );
        })}
      {phase === 'group' && (
        <motion.text x={520} y={474} fill={ODD_COLOR} fontSize={12} textAnchor="end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}>
          a few don’t fit any pattern →
        </motion.text>
      )}
      <AnimatePresence>{atLeast(phase, 'template') && <Templates phase={phase} engineer={engineer} />}</AnimatePresence>
      {cards.map((c, i) => {
        const odd = c.kind < 0;
        const inTemplate = phase === 'template';
        const pos = slottedView ? c.slotted : phase === 'group' || inTemplate ? c.grouped : c.scatter;
        const chip = slottedView && !odd;
        const w = chip ? CHIP_W : CARD_W;
        const fixDelay = c.kind >= 0 ? c.slotted.x / 1400 : 0;
        return (
          <motion.g
            key={c.id}
            initial={{ x: pos.x, y: pos.y, opacity: 0 }}
            animate={{
              x: pos.x,
              y: pos.y,
              opacity: inTemplate ? 0 : 1,
              scale: phase === 'fix' && c.kind === 0 ? [1, 1.2, 1, 1.2, 1] : 1,
            }}
            transition={{
              duration: 0.9,
              delay: phase === 'scatter' ? i * 0.04 : phase === 'slot' ? i * 0.06 : phase === 'fix' ? fixDelay : 0,
              ease: 'easeInOut',
            }}
          >
            <motion.rect
              height={CARD_H}
              rx={8}
              initial={false}
              animate={{
                width: w,
                fill:
                  phase === 'byhand'
                    ? [GREY, ODD_COLOR, '#5b3b55']
                    : phase === 'fix' && c.kind === 0
                      ? [cardColor(c, phase), ODD_COLOR, ODD_COLOR, '#34d399', '#34d399']
                      : cardColor(c, phase),
                fillOpacity:
                  phase === 'scatter' || phase === 'byhand'
                    ? 1
                    : phase === 'fix' && c.kind === 0
                      ? [0.22, 0.85, 0.85, 0.85, 0.22]
                      : 0.22,
                stroke: cardColor(c, phase),
              }}
              transition={{
                duration: phase === 'byhand' ? 0.5 : phase === 'fix' ? 4.5 : 0.6,
                ...(phase === 'fix' ? { times: [0, 0.1, 0.5, 0.6, 1] } : {}),
                delay: phase === 'byhand' ? i * 0.18 : phase === 'fix' ? fixDelay : 0,
              }}
            />
            <text x={chip ? CHIP_W / 2 : 10} y={21} fill="#e8ecff" fontSize={chip ? 13 : 11} fontWeight={chip ? 700 : 500} textAnchor={chip ? 'middle' : 'start'} fontFamily={chip ? 'JetBrains Mono Variable, monospace' : undefined}>
              {chip ? c.value : c.label}
            </text>
          </motion.g>
        );
      })}
      {phase === 'byhand' && (
        <motion.g
          initial={{ x: cards[0]?.scatter.x ?? 0, y: 0 }}
          animate={{ x: cards.map((c) => c.scatter.x + CARD_W - 10), y: cards.map((c) => c.scatter.y - 6) }}
          transition={{ duration: cards.length * 0.18, ease: 'linear' }}
        >
          <circle r={11} fill={ODD_COLOR} />
          <text y={4} textAnchor="middle" fontSize={11}>
            ✍
          </text>
        </motion.g>
      )}
      <CostMeter phase={phase} />
    </svg>
  );
}

export const scaleChapter: Chapter = {
  id: 'scale',
  title: 'Stop paying for the same work twice',
  subtitle: 'Spot the pattern, build it once',
  beats: [
    {
      caption: 'An old system is full of business rules. Here are 24 of them from a loan system.',
      detail: 'Each card is one instance. In other systems it could be a form, a page or a report.',
      ms: 4500,
    },
    {
      caption: 'The usual way: rewrite each rule by hand, often with an AI chat, one at a time. The cost grows with every rule.',
      detail: 'Per-ticket frontier spend. The reasoning is not kept, so it gets paid for again on the next ticket.',
      ms: 6500,
    },
    {
      caption: 'Look closer: most rules are the same sentence with a different number.',
      detail: 'Engineers call these families: instances with the same shape on the axes that matter. A person confirms each group.',
      ms: 6000,
    },
    {
      caption: 'So build one fill-in-the-blank template for each kind of rule, plus a tool that copies the numbers into the blanks. This is done once.',
      detail: 'Template = foundation with slots. Copying tool = transformer (a generator). A senior engineer and a strong model build it, so this is the expensive step.',
      ms: 6500,
    },
    {
      caption: 'Now every old rule drops into its template automatically and cheaply. The few odd ones out are done by hand.',
      detail: 'Odd ones out are a signal: maybe a new kind of rule, or the template needs to change.',
      ms: 6500,
    },
    {
      caption: 'If the copying tool has a bug, every rule of that kind is wrong in the same way. Fix the tool once and they are all fixed.',
      detail: 'Fix the generator, never the output. Generated rules are treated like compiled code.',
      ms: 6000,
    },
    {
      caption: 'Try your own numbers. When does building the template pay off?',
      detail: 'Below the pay-off point, doing it by hand is cheaper. Count your rules first.',
      ms: 60000,
    },
  ],
  Scene,
};
