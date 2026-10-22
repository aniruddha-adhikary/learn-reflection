import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Chapter, SceneProps } from '../course/types';
import { getterFlows, ruleSteps, type RuleRun, type RuleStep } from '../../porter';
import { legacyCell, legacyRows } from '../data/sample';
import r01Source from '../../../../playground/legacy/src/main/java/legacy/rules/R01_MinimumScore.java?raw';
import r02Source from '../../../../playground/legacy/src/main/java/legacy/rules/R02_DebtToIncome.java?raw';
import r10Source from '../../../../playground/legacy/src/main/java/legacy/rules/R10_ScoreBand.java?raw';

const AMBER = '#f5a524';
const CYAN = '#22d3ee';
const GREEN = '#34d399';
const VIOLET = '#a78bfa';
const TICK_MS = 1000;

const RULES = [
  { id: 'R01_MinimumScore', label: 'Minimum score', source: r01Source },
  { id: 'R02_DebtToIncome', label: 'Debt vs income', source: r02Source },
  { id: 'R10_ScoreBand', label: 'Score band', source: r10Source },
] as const;
type RuleId = (typeof RULES)[number]['id'];

const LOCAL_NAMES: Readonly<Record<string, readonly string[]>> = {
  R01_MinimumScore: ['this rule', 'the application', 'the decision'],
  R02_DebtToIncome: ['this rule', 'the application', 'the decision', 'applicant a'],
  R10_ScoreBand: ['this rule', 'the application', 'the decision', 'score s'],
};

function body(source: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => l.includes('public class'));
  if (start < 0) throw new Error('rule source has no class declaration');
  return lines.slice(start).join('\n').trimEnd();
}

interface Shown {
  readonly step: RuleStep;
  readonly called: string | null;
  readonly inside: readonly RuleStep[];
  readonly jumped: boolean | null;
}

function mainSteps(run: RuleRun): readonly Shown[] {
  const out: Shown[] = [];
  run.steps.forEach((step, i) => {
    if (step.depth !== 0) return;
    const inside: RuleStep[] = [];
    for (let j = i + 1; j < run.steps.length; j++) {
      const s = run.steps[j];
      if (!s || s.depth === 0) break;
      inside.push(s);
    }
    const next = run.steps.slice(i + 1).find((s) => s.depth === 0);
    const isBranch = step.mnemonic.startsWith('if');
    out.push({
      step,
      called: inside[0]?.method ?? null,
      inside: inside.filter((s) => s.depth === 1),
      jumped: isBranch && next ? next.offset === Number(step.operand) : null,
    });
  });
  return out;
}

const COMPARE: Readonly<Record<string, string>> = {
  if_icmpge: 'if the first is at least the second, skip ahead',
  if_icmplt: 'if the first is below the second, skip ahead',
  if_icmple: 'if the first is at most the second, skip ahead',
  if_icmpgt: 'if the first is above the second, skip ahead',
};

function plain(rule: RuleId, s: Shown): string {
  const { mnemonic, operand } = s.step;
  const locals = LOCAL_NAMES[rule] ?? [];
  const local = (n: number) => locals[n] ?? `slot ${String(n)}`;
  const m = /^[ai](load|store)_(\d)$/.exec(mnemonic);
  if (m) return m[1] === 'load' ? `pick up ${local(Number(m[2]))}` : `remember it as ${local(Number(m[2]))}`;
  if (mnemonic === 'iload' || mnemonic === 'aload') return `pick up ${local(Number(operand))}`;
  if (mnemonic === 'istore' || mnemonic === 'astore') return `remember it as ${local(Number(operand))}`;
  if (mnemonic.startsWith('invoke')) return s.called ? `ask: ${s.called}()` : `call ${operand}`;
  if (mnemonic === 'sipush' || mnemonic === 'bipush') return `put the number ${operand}`;
  if (mnemonic.startsWith('iconst_')) return `put the number ${mnemonic.slice(7).replace('m1', '-1')}`;
  if (mnemonic === 'ldc') return `put the text ${operand}`;
  if (mnemonic === 'imul') return 'multiply the top two';
  if (mnemonic === 'idiv') return 'divide the top two';
  if (mnemonic === 'goto') return 'jump ahead';
  if (mnemonic === 'return') return 'done';
  return COMPARE[mnemonic] ?? mnemonic;
}

function Stack({ values }: { values: readonly string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 8, minHeight: 220, justifyContent: 'flex-start', padding: 12, borderRadius: 14, border: '1px dashed var(--line)', background: '#0b1230' }}>
      <AnimatePresence initial={false}>
        {values.map((v, i) => (
          <motion.div
            key={`${String(i)}:${v}`}
            layout
            initial={{ opacity: 0, y: -30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 60 }}
            className="mono"
            style={{ padding: '10px 14px', borderRadius: 10, textAlign: 'center', fontSize: 17, fontWeight: 700, background: /^-?\d+$/.test(v) ? '#22d3ee22' : '#a78bfa22', border: `1px solid ${/^-?\d+$/.test(v) ? CYAN : VIOLET}`, color: '#e8ecff' }}
          >
            {v}
          </motion.div>
        ))}
      </AnimatePresence>
      {values.length === 0 && <div style={{ color: 'var(--muted)', textAlign: 'center', marginTop: 80 }}>empty</div>}
    </div>
  );
}

function Provenance({ run, rule }: { run: RuleRun; rule: RuleId }) {
  const flows = useMemo(() => getterFlows(), []);
  const called = [...new Map(run.steps.filter((s) => s.depth === 1 && s.method.startsWith('get') && s.method !== 'getApplicant').map((s) => [s.method, s])).values()];
  const constants = run.steps.filter((s) => s.depth === 0 && (s.mnemonic === 'sipush' || s.mnemonic === 'bipush'));
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ display: 'grid', gap: 14 }}>
      {called.map((s) => {
        const flow = flows.find((f) => f.owner === s.owner && f.method === s.method);
        if (!flow) throw new Error(`no getter flow for ${s.owner}.${s.method}`);
        return (
          <div key={s.method} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="pill modern">value on the stack</span>→
            <span className="pill legacy">{s.method}()</span>→
            <span className="pill ok">field {flow.fieldsRead.join(', ')}{flow.labels.includes('IDIV') ? ' ÷ 12' : ''}</span>
            <span style={{ color: 'var(--muted)' }}>comes from the applicant’s data</span>
          </div>
        );
      })}
      {constants.map((s) => (
        <div key={s.offset} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="pill ai" style={{ fontSize: 16 }}>{s.operand}</span>→
          <span>written into the rule itself. This is the number that drops into the template’s blank in chapter 1.</span>
        </div>
      ))}
      <div style={{ color: 'var(--muted)', fontSize: 14 }}>Rule {rule}: traced from the bytecode, not from reading variable names.</div>
    </motion.div>
  );
}

function InsidePlain({ step }: { step: RuleStep | undefined }) {
  const flows = useMemo(() => getterFlows(), []);
  if (!step) return null;
  const flow = flows.find((f) => f.owner === step.owner && f.method === step.method);
  if (!flow) return <div style={{ color: 'var(--muted)', fontSize: 13 }}>Runs a small piece of the old system.</div>;
  return <div style={{ color: 'var(--muted)', fontSize: 13 }}>It just reads the stored <b style={{ color: '#e8ecff' }}>{flow.fieldsRead.join(', ')}</b>{flow.labels.includes('IDIV') ? ' and divides it' : ''} and puts it on the stack.</div>;
}

function Stepper({ beat, engineer }: SceneProps) {
  const [rule, setRule] = useState<RuleId>('R01_MinimumScore');
  const [appId, setAppId] = useState('A-1002');
  const effectiveApp = beat === 2 ? 'A-1001' : beat === 4 ? appId : 'A-1002';
  const effectiveRule: RuleId = beat === 4 ? rule : 'R01_MinimumScore';
  const run = useMemo(() => ruleSteps(effectiveRule, effectiveApp), [effectiveRule, effectiveApp]);
  const shown = useMemo(() => mainSteps(run), [run]);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => { setCursor(beat === 0 || beat === 3 ? shown.length : 0); setPlaying(true); }, [beat, shown]);
  useEffect(() => {
    if (!playing || beat === 0 || beat === 3 || cursor >= shown.length) return;
    const t = setTimeout(() => { setCursor((c) => c + 1); }, TICK_MS);
    return () => { clearTimeout(t); };
  }, [playing, cursor, shown.length, beat]);
  const current = shown[Math.min(cursor, shown.length - 1)];
  if (!current) throw new Error(`${effectiveRule}: no steps`);
  const done = cursor >= shown.length;
  const stack = done ? [] : current.step.stack;
  const row = legacyRows.find((r) => legacyCell(r, 'APP_ID') === effectiveApp);
  if (!row) throw new Error(`no CSV row ${effectiveApp}`);
  const source = RULES.find((r) => r.id === effectiveRule)?.source ?? '';
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {beat === 4 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {RULES.map((r) => (
            <button key={r.id} className={`pill ${r.id === rule ? 'modern' : ''}`} style={{ cursor: 'pointer' }} onClick={() => { setRule(r.id); }}>{r.label}</button>
          ))}
          <select value={appId} onChange={(e) => { setAppId(e.target.value); }} style={{ background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 8px' }}>
            {legacyRows.map((r) => <option key={legacyCell(r, 'APP_ID')} value={legacyCell(r, 'APP_ID')}>{legacyCell(r, 'APP_ID')} · score {legacyCell(r, 'CRED_SCR')}</option>)}
          </select>
          <button className="pill" style={{ cursor: 'pointer' }} onClick={() => { setPlaying((p) => !p); }}>{playing ? 'Pause' : 'Play'}</button>
          <button className="pill" style={{ cursor: 'pointer' }} onClick={() => { setPlaying(false); setCursor((c) => Math.min(c + 1, shown.length)); }}>Step</button>
          <button className="pill" style={{ cursor: 'pointer' }} onClick={() => { setCursor(0); setPlaying(true); }}>Restart</button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 0.8fr 1fr', gap: 22, alignItems: 'start' }}>
        <div style={{ background: '#0d1430', border: '1px solid var(--line)', borderRadius: 14, padding: 14 }}>
          <div className="kicker" style={{ color: AMBER }}>{engineer ? `${run.rule}.execute · bytecode` : 'The steps the machine follows'}</div>
          {beat === 0 && <pre className="mono" style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0', whiteSpace: 'pre-wrap' }}>{body(source)}</pre>}
          {shown.map((s, i) => {
            const active = i === cursor && !done;
            const past = i < cursor;
            return (
              <motion.div key={`${String(s.step.offset)}-${String(i)}`} animate={{ opacity: past || active || beat === 0 ? 1 : 0.35 }} className="mono" style={{ display: 'flex', gap: 10, padding: '5px 8px', marginTop: 3, borderRadius: 8, fontSize: 13, background: active ? '#22d3ee22' : 'transparent', border: `1px solid ${active ? CYAN : 'transparent'}` }}>
                {engineer && <span style={{ color: 'var(--muted)', width: 22 }}>{s.step.offset}</span>}
                <span style={{ flex: 1 }}>{engineer ? `${s.step.mnemonic} ${s.step.operand}` : plain(effectiveRule, s)}</span>
                {s.jumped !== null && past && beat !== 0 && <span style={{ color: s.jumped ? GREEN : AMBER }}>{s.jumped ? 'jumped' : 'fell through'}</span>}
              </motion.div>
            );
          })}
        </div>
        <div>
          <div className="kicker" style={{ color: CYAN, marginBottom: 8 }}>{engineer ? 'Operand stack' : 'The stack of plates'}</div>
          <Stack values={stack} />
          {engineer && !done && (
            <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>locals: [{current.step.locals.join(', ')}]</div>
          )}
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="pill legacy" style={{ justifySelf: 'start' }}>{effectiveApp} · {legacyCell(row, 'APPL_NAME')} · score {legacyCell(row, 'CRED_SCR')}</div>
          <AnimatePresence mode="wait">
            {!done && current.inside.length > 0 && (
              <motion.div key={cursor} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} style={{ border: `1px solid ${VIOLET}`, borderRadius: 12, padding: 12, background: '#a78bfa14' }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Looking inside {current.called}()</div>
                {engineer
                  ? current.inside.map((s) => <div key={`${s.method}${String(s.offset)}`} className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{s.mnemonic} {s.operand}</div>)
                  : <InsidePlain step={current.inside[0]} />}
              </motion.div>
            )}
          </AnimatePresence>
          {beat === 3 && <Provenance run={run} rule={effectiveRule} />}
          {done && beat !== 3 && beat !== 0 && (
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={{ fontSize: 18 }}>
              Decision: {run.codes.length + run.referrals.length === 0
                ? <span className="pill ok">no codes added</span>
                : [...run.codes, ...run.referrals].map((c) => <span key={c} className="pill bad" style={{ marginRight: 6 }}>{c}</span>)}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

function Scene(props: SceneProps) {
  return (
    <div style={{ height: '100%', display: 'grid', alignContent: 'center' }}>
      <Stepper {...props} />
    </div>
  );
}

export const machineChapter: Chapter = {
  id: 'bytecode',
  title: 'Read the machine',
  subtitle: 'Follow values through bytecode',
  beats: [
    { caption: 'This is a real rule from LoanDesk. Java turns it into a short list of simple steps for a machine.', detail: 'Compiled bytecode, decoded in your browser.', ms: 6000 },
    { caption: 'The machine works like a stack of plates: put values on top, take the top ones off to compare them.', detail: 'Running for real on a small JVM written in TypeScript. Applicant A-1002 has a score of 575.', ms: 14000 },
    { caption: 'Another applicant, another path. With a score of 760 the comparison jumps past “decline”.', detail: 'Branches taken are recorded step by step from the run.', ms: 14000 },
    { caption: 'Now we can say where every value came from: from the applicant’s data, or written into the rule itself.', detail: 'Provenance: stack slots traced back to getters, fields and constants.', ms: 9000 },
    { caption: 'Your turn. Pick a rule and an applicant, then step through it.', detail: 'Toggle Engineer view to see raw bytecode, offsets and locals.', ms: 60000 },
  ],
  Scene,
};
