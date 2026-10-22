import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Chapter, SceneProps } from '../course/types';
import { facts, getterFlows, type ClassFacts, type GetterFlow } from '../../porter';
import { legacyCell, legacyRows } from '../data/sample';

const AMBER = '#f5a524';
const CYAN = '#22d3ee';
const GREEN = '#34d399';
const RED = '#f87171';
const APPLICANT = 'legacy.model.Applicant';
const MODERN_PATHS = ['applicant.fullName', 'income.annual', 'credit.score', 'debt.monthly', 'employment', 'residence.country'] as const;

interface Live {
  readonly fact: ClassFacts;
  readonly flows: readonly GetterFlow[];
}

let cache: Live | undefined;
function live(): Live {
  if (cache) return cache;
  const fact = facts().data.find((c) => c.class === APPLICANT);
  if (!fact) throw new Error(`facts: ${APPLICANT} missing`);
  const flows = getterFlows().filter((f) => f.owner === APPLICANT);
  if (flows.length === 0) throw new Error(`dataflow: no getters found on ${APPLICANT}`);
  cache = { fact, flows };
  return cache;
}

function propertyOf(method: string): string {
  const bare = method.startsWith('is') ? method.slice(2) : method.slice(3);
  return bare.charAt(0).toLowerCase() + bare.slice(1);
}

/** What a name-only matcher would guess: a modern path whose words contain the old property name. */
function nameGuess(property: string): string | null {
  const p = property.toLowerCase();
  return MODERN_PATHS.find((path) => path.toLowerCase().split('.').some((seg) => seg.includes(p) || p.includes(seg))) ?? null;
}

function divisorOf(flow: GetterFlow): number | null {
  if (!flow.labels.includes('IDIV')) return null;
  const push = flow.instructions.find((i) => flow.sourceOffsets.includes(i.offset) && (i.mnemonic === 'bipush' || i.mnemonic === 'sipush'));
  if (!push) throw new Error(`${flow.method}: IDIV without a constant divisor`);
  return Number(push.operand);
}

const ROW_H = 54;
const TOP = 70;

function Box({ x, y, w, text, color, dim, strike }: { x: number; y: number; w: number; text: string; color: string; dim?: boolean; strike?: boolean }) {
  return (
    <motion.g initial={{ opacity: 0, x: x - 12 }} animate={{ opacity: dim ? 0.35 : 1, x }} transition={{ duration: 0.4 }}>
      <rect y={y} width={w} height={38} rx={10} fill="#111a3a" stroke={color} strokeOpacity={0.8} />
      <text x={w / 2} y={y + 24} textAnchor="middle" fill={strike ? RED : '#e8ecff'} fontSize={14} fontFamily="var(--mono)" textDecoration={strike ? 'line-through' : undefined}>
        {text}
      </text>
    </motion.g>
  );
}

function Link({ x1, y1, x2, y2, color, dashed, delay = 0, label }: { x1: number; y1: number; x2: number; y2: number; color: string; dashed?: boolean; delay?: number; label?: string | undefined }) {
  const mx = (x1 + x2) / 2;
  const d = `M${String(x1)} ${String(y1)} C${String(mx)} ${String(y1)} ${String(mx)} ${String(y2)} ${String(x2)} ${String(y2)}`;
  return (
    <g>
      <motion.path d={d} fill="none" stroke={color} strokeWidth={2.2} strokeDasharray={dashed ? '6 6' : undefined} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7, delay }} />
      {label && (
        <motion.text x={mx} y={(y1 + y2) / 2 - 8} textAnchor="middle" fill={color} fontSize={13} fontWeight={700} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: delay + 0.6 }}>
          {label}
        </motion.text>
      )}
    </g>
  );
}

function Bytecode({ flow, engineer, beat }: { flow: GetterFlow; engineer: boolean; beat: number }) {
  const row = legacyRows[0];
  if (!row) throw new Error('no legacy rows');
  const annual = Number(legacyCell(row, 'ANNUAL_INC'));
  const divisor = divisorOf(flow);
  const plain: Record<string, string> = { getfield: 'read the field', bipush: 'push a number', sipush: 'push a number', idiv: 'divide', ireturn: 'hand back the result', aload_0: 'take this record' };
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, alignItems: 'start' }}>
      <div style={{ background: '#0d1430', border: '1px solid var(--line)', borderRadius: 14, padding: 18 }}>
        <div className="kicker" style={{ color: AMBER }}>{engineer ? `${flow.method}${flow.descriptor} · compiled bytecode` : `What ${flow.method}() really does`}</div>
        {flow.instructions.map((ins, i) => {
          const hot = flow.sourceOffsets.includes(ins.offset);
          return (
            <motion.div key={ins.offset} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 * i }} className="mono" style={{ display: 'flex', gap: 14, padding: '7px 10px', marginTop: 6, borderRadius: 8, background: hot ? '#22d3ee22' : 'transparent', border: `1px solid ${hot ? CYAN : 'transparent'}` }}>
              {engineer && <span style={{ color: 'var(--muted)', width: 24 }}>{ins.offset}</span>}
              <span style={{ color: hot ? CYAN : '#e8ecff', width: 150 }}>{engineer ? ins.mnemonic : (plain[ins.mnemonic] ?? ins.mnemonic)}</span>
              <span style={{ color: 'var(--muted)' }}>{ins.operand.replace('legacy/model/Applicant.', '')}</span>
            </motion.div>
          );
        })}
      </div>
      <div style={{ display: 'grid', gap: 14, alignContent: 'center', height: '100%' }}>
        <motion.div className="pill legacy" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.4 }} style={{ fontSize: 18, justifySelf: 'start' }}>
          annualIncome = {annual.toLocaleString()}
        </motion.div>
        {divisor !== null && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} style={{ fontSize: 26, fontWeight: 800 }}>
            ÷ {divisor} = <span style={{ color: beat >= 3 ? RED : CYAN }}>{(annual / divisor).toLocaleString()}</span>
          </motion.div>
        )}
        {beat >= 3 && divisor !== null && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ fontSize: 17, lineHeight: 1.5 }}>
            Applicant {legacyCell(row, 'APP_ID')}: getIncome() gives <b style={{ color: RED }}>{(annual / divisor).toLocaleString()}</b> a month, but the new system’s income.annual is{' '}
            <b style={{ color: CYAN }}>{annual.toLocaleString()}</b> a year. Linking them by name would be wrong by {divisor}×.
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

function Map3({ data, beat, engineer }: { data: Live; beat: number; engineer: boolean }) {
  const [renamed, setRenamed] = useState(false);
  const showFacts = beat >= 4;
  const showRename = beat >= 5;
  const fieldLabel = (f: string) => (renamed && f === 'creditScore' ? 'cs' : f);
  return (
    <div>
      <svg viewBox="0 0 1000 470" style={{ width: '100%', maxHeight: '58vh' }}>
        <text x={40} y={40} fill={AMBER} fontSize={13} fontWeight={800} letterSpacing={1.5}>{engineer ? 'GETTERS (names)' : 'OLD NAMES'}</text>
        {showFacts && <text x={380} y={40} fill={GREEN} fontSize={13} fontWeight={800} letterSpacing={1.5}>{engineer ? 'FIELD READ (bytecode)' : 'WHAT IS REALLY READ'}</text>}
        <text x={720} y={40} fill={CYAN} fontSize={13} fontWeight={800} letterSpacing={1.5}>NEW SYSTEM</text>
        {data.flows.map((flow, i) => {
          const y = TOP + i * ROW_H;
          const guess = nameGuess(propertyOf(flow.method));
          const gi = guess ? MODERN_PATHS.indexOf(guess as (typeof MODERN_PATHS)[number]) : -1;
          const field = flow.fieldsRead[0];
          const div = divisorOf(flow);
          return (
            <g key={flow.method}>
              <Box x={40} y={y} w={230} text={`${flow.method}()`} color={AMBER} />
              {beat >= 1 && !showFacts && (gi >= 0 ? (
                <Link x1={270} y1={y + 19} x2={720} y2={TOP + gi * ROW_H + 19} color={flow.labels.includes('IDIV') && beat >= 3 ? RED : AMBER} dashed delay={0.1 * i} label={flow.labels.includes('IDIV') && beat >= 3 ? '✗ wrong by ' + String(div) + '×' : undefined} />
              ) : (
                <motion.text x={300} y={y + 25} fill={RED} fontSize={13} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>no name match</motion.text>
              ))}
              {showFacts && field && (
                <>
                  <Link x1={270} y1={y + 19} x2={380} y2={y + 19} color={GREEN} delay={0.1 * i} label={div !== null ? `÷${String(div)}` : undefined} />
                  <Box x={380} y={y} w={210} text={fieldLabel(field)} color={GREEN} />
                </>
              )}
            </g>
          );
        })}
        {showFacts && !showRename && (
          <motion.text x={655} y={TOP + 6 * ROW_H + 30} textAnchor="middle" fill="#a78bfa" fontSize={14} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
            Linking these real fields to the new system is the one job we give AI → chapter 5
          </motion.text>
        )}
        {MODERN_PATHS.map((p, i) => (
          <Box key={p} x={720} y={TOP + i * ROW_H} w={240} text={p} color={CYAN} />
        ))}
        {showRename && (
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <rect x={380} y={TOP + 6 * ROW_H + 8} width={580} height={44} rx={10} fill={renamed ? '#f8717122' : '#34d39922'} stroke={renamed ? RED : GREEN} />
            <text x={400} y={TOP + 6 * ROW_H + 35} fill="#e8ecff" fontSize={14}>
              Hand-written mapping “creditScore → credit.score”: {renamed ? '✗ field creditScore not found' : '✓ works today'}
            </text>
          </motion.g>
        )}
      </svg>
      {showRename && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button style={{ height: 38, padding: '0 16px', borderRadius: 10, border: `1px solid ${CYAN}`, background: renamed ? 'transparent' : CYAN, color: renamed ? CYAN : '#04202a', fontWeight: 700, cursor: 'pointer' }} onClick={() => { setRenamed((r) => !r); }}>
            {renamed ? 'Undo the rename' : 'What if someone renames creditScore to cs?'}
          </button>
          <span style={{ color: 'var(--muted)' }}>{renamed ? 'The read facts follow the code, so the green arrow still finds it.' : 'A what-if: try it for real in the playground (exercise 2).'}</span>
        </div>
      )}
      {engineer && showFacts && (
        <table className="mono" style={{ fontSize: 12, marginTop: 10, color: 'var(--muted)' }}>
          <tbody>
            {data.fact.properties.map((p) => (
              <tr key={p.property}><td style={{ paddingRight: 18 }}>property {p.property}</td><td style={{ paddingRight: 18 }}>read {p.readMethod || '—'}</td><td>write {p.writeMethod || '—'}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Scene({ beat, engineer }: SceneProps) {
  const data = live();
  const income = data.flows.find((f) => f.method === 'getIncome');
  if (!income) throw new Error('getIncome not found on legacy Applicant');
  return (
    <div style={{ height: '100%', display: 'grid', alignContent: 'center' }}>
      <AnimatePresence mode="wait">
        {beat === 2 || beat === 3 ? (
          <motion.div key="bc" exit={{ opacity: 0 }}><Bytecode flow={income} engineer={engineer} beat={beat} /></motion.div>
        ) : (
          <motion.div key="map" exit={{ opacity: 0 }}><Map3 data={data} beat={beat} engineer={engineer} /></motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const namesChapter: Chapter = {
  id: 'names',
  title: 'Never trust a name',
  subtitle: 'Read what the code really does',
  beats: [
    { caption: 'Old code is full of names someone picked 20 years ago. These are the ways LoanDesk reads an applicant.', detail: 'Listed live from the compiled LoanDesk classes in your browser: reflection, no source code.', ms: 5000 },
    { caption: 'The obvious move: match old names to new names. income goes to income.annual. Some names match nothing at all.', detail: 'A name-only matcher, the way a quick script or a rushed AI prompt would do it.', ms: 6000 },
    { caption: 'But a name is only a label. Open getIncome() and look at what it actually does, step by step.', detail: 'The real compiled bytecode. Highlighted steps are the ones the result depends on (provenance analysis).', ms: 7000 },
    { caption: 'It takes the yearly income and divides by 12. “income” is really monthly income.', detail: 'Read from the bytecode: getfield annualIncome, bipush 12, idiv.', ms: 8000 },
    { caption: 'So we never trust names. For every old getter we read which field it really touches, and what it does to it.', detail: 'Derived for every getter by running provenance analysis on the bytecode, live in this page.', ms: 8000 },
    { caption: 'And when somebody renames something, facts read from the code keep up. Hand-written name mappings break.', detail: 'Facts are recomputed from the compiled classes on every run, so nothing goes stale.', ms: 30000 },
  ],
  Scene,
};
