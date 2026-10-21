import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Chapter, SceneProps } from '../course/types';
import { bureauScores, legacyCell, legacyCsvText, legacyRows, modernEvents } from '../data/sample';

const AMBER = '#f5a524';
const CYAN = '#22d3ee';

function Node({ x, y, w, title, sub, color, active }: { x: number; y: number; w: number; title: string; sub: string; color: string; active: boolean }) {
  return (
    <motion.g initial={false} animate={{ opacity: active ? 1 : 0.35 }} transform={`translate(${String(x)} ${String(y)})`}>
      <rect width={w} height={62} rx={14} fill="#111a3a" stroke={color} strokeOpacity={active ? 0.9 : 0.4} />
      <text x={w / 2} y={27} textAnchor="middle" fill="#e8ecff" fontSize={13} fontWeight={650}>
        {title}
      </text>
      <text x={w / 2} y={46} textAnchor="middle" fill={color} fontSize={11}>
        {sub}
      </text>
    </motion.g>
  );
}

function Doc({ color, label }: { color: string; label: string }) {
  return (
    <g>
      <path d="M0 0 h22 l8 8 v30 h-30 z" fill="#0d1430" stroke={color} strokeWidth={1.5} />
      <text x={15} y={27} textAnchor="middle" fill={color} fontSize={8} fontWeight={700}>
        {label}
      </text>
    </g>
  );
}

function LegacyLane({ beat }: { beat: number }) {
  const on = beat >= 1 && beat <= 3;
  const clock = beat <= 1 ? '09:00 → 18:00' : beat === 2 ? '02:00' : '07:00 next day';
  return (
    <g>
      <text x={20} y={22} fill={AMBER} fontSize={13} fontWeight={800} letterSpacing={1.5}>
        LOANDESK · 2004 · NIGHTLY BATCH
      </text>
      <motion.text x={980} y={22} textAnchor="end" fill={AMBER} fontSize={13} className="mono" key={clock} initial={{ opacity: 0 }} animate={{ opacity: on ? 1 : 0.4 }}>
        🕑 {clock}
      </motion.text>
      <Node x={20} y={60} w={150} title="Branch offices" sub="applications all day" color={AMBER} active={beat === 1} />
      <Node x={300} y={60} w={150} title="SFTP server" sub="one CSV per night" color={AMBER} active={beat === 2} />
      <Node x={560} y={60} w={180} title="Batch runner" sub="11 rules × every row" color={AMBER} active={beat === 3} />
      <Node x={840} y={60} w={140} title="Outbox CSV" sub="read next morning" color={AMBER} active={beat === 3} />
      {[170, 450, 740].map((x) => (
        <line key={x} x1={x + 4} y1={91} x2={x + (x === 170 ? 126 : x === 450 ? 106 : 96)} y2={91} stroke={AMBER} strokeOpacity={0.35} strokeDasharray="4 6" />
      ))}
      {beat === 1 &&
        legacyRows.map((row, i) => (
          <motion.g key={legacyCell(row, 'APP_ID')} initial={{ x: 40 + (i % 6) * 20, y: 200, opacity: 0 }} animate={{ x: 20 + (i % 4) * 72, y: 136 + Math.floor(i / 4) * 20, opacity: 1 }} transition={{ delay: i * 0.3, duration: 0.6 }}>
            <rect width={66} height={14} rx={4} fill="#2a2210" stroke={AMBER} strokeOpacity={0.6} />
            <text x={33} y={10} textAnchor="middle" fill={AMBER} fontSize={8} className="mono">
              {legacyCell(row, 'APP_ID')}
            </text>
          </motion.g>
        ))}
      {beat === 2 && (
        <motion.g initial={{ x: 210, y: 130 }} animate={{ x: [210, 300, 360], y: [130, 150, 136] }} transition={{ duration: 1.8, ease: 'easeInOut' }}>
          <Doc color={AMBER} label="CSV" />
        </motion.g>
      )}
      {beat === 3 &&
        legacyRows.map((row, i) => (
          <motion.g key={legacyCell(row, 'APP_ID')} initial={{ x: 470, y: 160, opacity: 0 }} animate={{ x: [470, 600, 700, 870], y: [160, 160, 160, 160], opacity: [0, 1, 1, 0] }} transition={{ delay: i * 0.5, duration: 2.2 }}>
            <rect width={56} height={14} rx={4} fill="#2a2210" stroke={AMBER} />
            <text x={28} y={10} textAnchor="middle" fill={AMBER} fontSize={8} className="mono">
              {legacyCell(row, 'APP_ID')}
            </text>
          </motion.g>
        ))}
      {beat === 3 &&
        Array.from({ length: 11 }, (_, r) => (
          <motion.circle key={r} cx={576 + r * 14.5} cy={196} r={4.5} fill={AMBER} initial={{ opacity: 0.2 }} animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 0.35, repeat: 12, delay: r * 0.03 }} />
        ))}
      {beat === 3 && (
        <text x={655} y={216} textAnchor="middle" fill="#8f9bc7" fontSize={10}>
          R01 … R11
        </text>
      )}
    </g>
  );
}

function ModernLane({ beat }: { beat: number }) {
  const on = beat >= 4 && beat <= 5;
  const y0 = 250;
  return (
    <g transform={`translate(0 ${String(y0)})`}>
      <text x={20} y={22} fill={CYAN} fontSize={13} fontWeight={800} letterSpacing={1.5}>
        LOANFLOW · TODAY · LIVE EVENTS
      </text>
      <Node x={20} y={50} w={140} title="Web & mobile" sub="apply any time" color={CYAN} active={on} />
      <Node x={250} y={50} w={130} title="S3 bucket" sub="object created" color={CYAN} active={on} />
      <Node x={460} y={50} w={130} title="Intake" sub="per event" color={CYAN} active={on} />
      <Node x={670} y={50} w={160} title="Rule engine" sub="rule templates" color={CYAN} active={on} />
      <Node x={880} y={50} w={100} title="Decision" sub="in ~1 s" color={CYAN} active={on} />
      <Node x={670} y={170} w={160} title="Credit bureau" sub="service call" color="#a78bfa" active={beat === 5} />
      {beat === 5 && (
        <motion.line x1={750} y1={112} x2={750} y2={170} stroke="#a78bfa" strokeWidth={2} strokeDasharray="5 5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} />
      )}
      {on &&
        modernEvents.slice(0, 8).map((ev, i) => (
          <motion.g
            key={ev.id}
            initial={{ x: 120, y: 125, opacity: 0 }}
            animate={{ x: [120, 300, 510, 730, 910], y: [125, 125, 125, 125, 125], opacity: [0, 1, 1, 1, 0] }}
            transition={{ duration: 3, delay: i * 0.7, repeat: Infinity, repeatDelay: 2.6 }}
          >
            <rect width={58} height={16} rx={8} fill="#08303a" stroke={CYAN} />
            <text x={29} y={11} textAnchor="middle" fill={CYAN} fontSize={8} className="mono">
              {'{'} {ev.id} {'}'}
            </text>
          </motion.g>
        ))}
      {beat === 5 &&
        modernEvents.slice(0, 8).map((ev, i) => (
          <motion.circle key={ev.id} cx={750} r={5} fill="#a78bfa" initial={{ cy: 118, opacity: 0 }} animate={{ cy: [118, 178, 118], opacity: [0, 1, 0] }} transition={{ duration: 1, delay: 1.6 + i * 0.7, repeat: Infinity, repeatDelay: 4.6 }} />
        ))}
    </g>
  );
}

const ROWS: readonly { csv: string; legacy: string; modern: string; via?: string }[] = [
  { csv: 'APP_ID', legacy: 'appId', modern: 'id' },
  { csv: 'APPL_NAME', legacy: 'name', modern: 'applicant.fullName' },
  { csv: 'ANNUAL_INC', legacy: 'annualIncome', modern: 'applicant.income.annual' },
  { csv: 'CRED_SCR', legacy: 'creditScore', modern: 'CreditBureau.scoreFor(…)', via: 'service' },
  { csv: 'EMP_STAT', legacy: 'empStat', modern: 'applicant.employment' },
  { csv: 'DEBT_MO', legacy: 'monthlyDebt', modern: 'applicant.debts.monthlyTotal' },
  { csv: 'CNTRY', legacy: 'country', modern: 'applicant.residence.countryCode' },
  { csv: 'LOAN_AMT', legacy: 'amount', modern: 'request.principal' },
  { csv: 'TERM_MO', legacy: 'termMonths', modern: 'request.termMonths' },
  { csv: 'COLLAT', legacy: 'collateral', modern: 'request.secured' },
  { csv: 'CO_SIGNERS', legacy: 'coSigners', modern: 'guarantors[ ]' },
];

function modernValue(path: string, i: number): string {
  const ev = modernEvents[i];
  if (ev === undefined) return '';
  const a = ev.applicant;
  switch (path) {
    case 'id': return ev.id;
    case 'applicant.fullName': return a.fullName;
    case 'applicant.income.annual': return String(a.income.annual);
    case 'CreditBureau.scoreFor(…)': return String(bureauScores[a.applicantId] ?? '∅');
    case 'applicant.employment': return a.employment;
    case 'applicant.debts.monthlyTotal': return String(a.debts.monthlyTotal);
    case 'applicant.residence.countryCode': return a.residence.countryCode ?? 'null';
    case 'request.principal': return String(ev.request.principal);
    case 'request.termMonths': return String(ev.request.termMonths);
    case 'request.secured': return String(ev.request.secured);
    case 'guarantors[ ]': return `[${ev.guarantors.map((g) => JSON.stringify(g.name)).join(', ')}]`;
    default: throw new Error(`Unknown modern path ${path}`);
  }
}

function ShapeView({ engineer }: { engineer: boolean }) {
  const [sel, setSel] = useState(5);
  const row = legacyRows[sel];
  if (row === undefined) throw new Error('No legacy row selected');
  const RH = 30;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 10, height: '100%' }}>
      <div className="chips">
        {legacyRows.map((r, i) => (
          <button key={legacyCell(r, 'APP_ID')} className="chip-btn" aria-pressed={i === sel} onClick={() => setSel(i)}>
            {legacyCell(r, 'APP_ID')}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 1000 ${String(60 + ROWS.length * RH)}`} className="canvas">
        <text x={10} y={20} fill={AMBER} fontSize={12} fontWeight={800}>CSV COLUMN (SFTP)</text>
        <text x={300} y={20} fill={AMBER} fontSize={12} fontWeight={800}>LEGACY OBJECT FIELD</text>
        <text x={640} y={20} fill={CYAN} fontSize={12} fontWeight={800}>MODERN EVENT / SERVICE</text>
        {ROWS.map((r, k) => {
          const y = 40 + k * RH;
          const lv = legacyCell(row, r.csv);
          return (
            <g key={r.csv}>
              <motion.g initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: k * 0.05 }}>
                <rect x={10} y={y} width={240} height={RH - 6} rx={6} fill="#2a2210" stroke="#f5a52455" />
                <text x={20} y={y + 16} fill={AMBER} fontSize={11} className="mono">{r.csv}</text>
                <text x={240} y={y + 16} fill="#e8ecff" fontSize={11} className="mono" textAnchor="end">{lv === '' ? '(empty)' : lv}</text>
              </motion.g>
              <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 + k * 0.05 }}>
                <rect x={300} y={y} width={240} height={RH - 6} rx={6} fill="#1d1a12" stroke="#f5a52433" />
                <text x={310} y={y + 16} fill="#e8ecff" fontSize={11} className="mono">{engineer ? `private ${r.legacy}` : r.legacy}</text>
              </motion.g>
              <motion.g initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.8 + k * 0.05 }}>
                <rect x={640} y={y} width={350} height={RH - 6} rx={6} fill={r.via === undefined ? '#08303a' : '#1b1540'} stroke={r.via === undefined ? '#22d3ee55' : '#a78bfa88'} />
                <text x={650} y={y + 16} fill={r.via === undefined ? CYAN : '#a78bfa'} fontSize={11} className="mono">{r.modern}</text>
                <text x={980} y={y + 16} fill="#e8ecff" fontSize={11} className="mono" textAnchor="end">{modernValue(r.modern, sel)}</text>
              </motion.g>
              <motion.path d={`M250 ${String(y + 12)} C275 ${String(y + 12)} 275 ${String(y + 12)} 300 ${String(y + 12)}`} stroke="#f5a52488" fill="none" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.3 + k * 0.05 }} />
              <motion.path d={`M540 ${String(y + 12)} C590 ${String(y + 12)} 590 ${String(y + 12)} 640 ${String(y + 12)}`} stroke="#8f9bc755" strokeDasharray="3 4" fill="none" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.7 + k * 0.05 }} />
            </g>
          );
        })}
        <text x={590} y={52 + ROWS.length * RH} fill="#8f9bc7" fontSize={11} textAnchor="middle">
          dashed = &quot;how do we know these line up?&quot; → chapter 5
        </text>
      </svg>
    </motion.div>
  );
}

function SameRule() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', alignItems: 'center', height: '100%', gap: 10 }}>
      <div className="panel" style={{ borderColor: '#f5a52466' }}>
        <span className="pill legacy">LoanDesk · R01_MinimumScore.java</span>
        <pre className="mono" style={{ fontSize: 14, lineHeight: 1.6, margin: '12px 0 0' }}>
          {'if (app.getApplicant()\n      .getCredScr() < 580) {\n  d.addCode("DECLINE_LOW_SCORE");\n}'}
        </pre>
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>score arrives as a CSV column, copied into a field</div>
      </div>
      <motion.div style={{ textAlign: 'center', fontSize: 34, color: 'var(--ok)' }} animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1.6 }}>
        ≡
      </motion.div>
      <div className="panel" style={{ borderColor: '#22d3ee66' }}>
        <span className="pill modern">LoanFlow · rules.json (filled-in template)</span>
        <pre className="mono" style={{ fontSize: 14, lineHeight: 1.6, margin: '12px 0 0' }}>
          {'{ "when": { "cmp": "<",\n    "l": { "read": "credit.score" },\n    "r": { "int": 580 } },\n  "emit": "DECLINE_LOW_SCORE" }'}
        </pre>
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>score comes from the credit-bureau service, on demand</div>
      </div>
    </motion.div>
  );
}

function Scene({ beat, engineer }: SceneProps) {
  if (beat === 6) return <ShapeView engineer={engineer} />;
  if (beat === 7) return <SameRule />;
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <svg viewBox="0 0 1000 500" className="canvas" role="img" aria-label="Legacy batch flow and modern event flow">
        <line x1={0} y1={236} x2={1000} y2={236} stroke="#24315f" />
        <LegacyLane beat={beat} />
        <ModernLane beat={beat} />
      </svg>
      <AnimatePresence>
        {beat === 2 && engineer && (
          <motion.pre
            className="panel mono"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{ position: 'absolute', right: 0, top: '28%', fontSize: 11, maxWidth: 520, overflow: 'hidden', margin: 0 }}
          >
            {legacyCsvText.split('\r\n').slice(0, 6).join('\n')}
            {'\n…'}
          </motion.pre>
        )}
      </AnimatePresence>
    </div>
  );
}

export const worldsChapter: Chapter = {
  id: 'worlds',
  title: 'Two worlds, one business',
  subtitle: 'Old data flow vs new data flow',
  beats: [
    { caption: 'Meet LoanDesk, a loan system from 2004, and LoanFlow, its replacement. They make the same business decisions.', ms: 4500 },
    { caption: 'In LoanDesk, applications pile up all day…', detail: 'Twelve real (synthetic) applications: the same twelve run through every chapter.', ms: 5000 },
    { caption: '…and at 2 AM one CSV file is dropped on an SFTP server.', detail: 'Every field is a flat column. The credit score is just a number someone typed into it.', ms: 4500 },
    { caption: 'A batch job runs all 11 rules on every row. Decisions are ready the next morning.', detail: 'Rules read plain fields like getCredScr(). One crash can take a row down with it.', ms: 6000 },
    { caption: 'In LoanFlow, each application arrives on its own as an event, and is decided in about a second.', detail: 'SFTP batch → S3 object-created events. Nightly → live.', ms: 6000 },
    { caption: 'Some data is not even in the payload any more: the credit score now comes from a service.', detail: 'Direct fields → service calls. The rule engine asks the credit bureau only when a rule needs the score.', ms: 6000 },
    { caption: 'Same applicant, two shapes. Pick any applicant and compare the flat CSV with the nested event.', detail: 'Private legacy fields vs JavaBeans modern model. Different names, nesting, enums, and a service.', ms: 30000 },
    { caption: 'The shape around the rule changed completely. The business logic did not, and that is what we carry across.', detail: 'The modern rule is generated data in a slot, not hand-written code. Chapters 3–7 show how.', ms: 30000 },
  ],
  Scene,
};
