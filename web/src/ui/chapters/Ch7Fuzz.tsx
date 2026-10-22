import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { Chapter, SceneProps } from '../course/types';
import { fuzz, type FuzzCaseTrace, type FuzzResult } from '../../porter';
import { courseBindings } from '../../course-data';

const GREEN = '#34d399';
const RED = '#f87171';
const AMBER = '#f5a524';
const CYAN = '#22d3ee';

type Which = 'correct' | 'mistake';
const cache = new Map<Which, FuzzResult>();
function fuzzFor(which: Which): FuzzResult {
  const hit = cache.get(which);
  if (hit) return hit;
  const result = fuzz(courseBindings[which]);
  cache.set(which, result);
  return result;
}

function outcome(o: FuzzCaseTrace['legacy']): string {
  if (o.error) return `error: ${o.error}`;
  return o.codes.length === 0 ? 'no codes' : o.codes.join(', ');
}

function show(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(show).join(', ')}]`;
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new Error(`fuzz: unexpected input value ${JSON.stringify(value)}`);
}

function Flow() {
  return (
    <div style={{ position: 'relative', height: 300 }}>
      <div className="pill" style={{ position: 'absolute', left: 0, top: 130 }}>generated input</div>
      <div className="pill legacy" style={{ position: 'absolute', left: '45%', top: 60, fontSize: 16 }}>LoanDesk (old code, real bytecode)</div>
      <div className="pill modern" style={{ position: 'absolute', left: '45%', top: 200, fontSize: 16 }}>LoanFlow (template rules)</div>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <motion.div key={i} style={{ position: 'absolute', width: 12, height: 12, borderRadius: 6, background: i % 2 ? CYAN : AMBER, top: 136 }}
          animate={{ left: ['12%', '42%'], top: [136, i % 2 ? 206 : 66], opacity: [0, 1, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.27 }} />
      ))}
      <motion.div className="pill ok" style={{ position: 'absolute', right: 0, top: 130, fontSize: 16 }} animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 1.6 }}>
        same answer?
      </motion.div>
    </div>
  );
}

function Grid({ result, picked, onPick }: { result: FuzzResult; picked: FuzzCaseTrace | null; onPick: (t: FuzzCaseTrace) => void }) {
  const byRule = useMemo(() => {
    const map = new Map<string, FuzzCaseTrace[]>();
    for (const t of result.trace) map.set(t.rule, [...(map.get(t.rule) ?? []), t]);
    return [...map];
  }, [result]);
  return (
    <div style={{ display: 'grid', gap: 5 }}>
      {byRule.map(([rule, cases], ri) => {
        const bad = cases.filter((c) => !c.agree).length;
        return (
          <motion.div key={rule} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 * ri }} style={{ display: 'grid', gridTemplateColumns: '170px 1fr 90px', gap: 10, alignItems: 'center' }}>
            <span className="mono" style={{ fontSize: 12, color: bad ? RED : 'var(--text)' }}>{rule}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {cases.map((c, i) => (
                <button key={i} aria-label={`${rule} case ${String(i + 1)}`} onClick={() => { onPick(c); }}
                  style={{ width: 9, height: 9, padding: 0, borderRadius: 2, cursor: 'pointer', border: picked === c ? '1px solid #fff' : 'none', background: c.agree ? '#34d39988' : RED }} />
              ))}
            </div>
            <span className={`pill ${bad ? 'bad' : 'ok'}`} style={{ fontSize: 11 }}>{bad ? `${String(bad)} differ` : `${String(cases.length)} agree`}</span>
          </motion.div>
        );
      })}
    </div>
  );
}

function Scene({ beat, engineer }: SceneProps) {
  const [choice, setChoice] = useState<Which>('mistake');
  const which: Which = beat <= 2 ? 'correct' : beat === 3 ? 'mistake' : choice;
  const result = fuzzFor(which);
  const [picked, setPicked] = useState<FuzzCaseTrace | null>(null);
  const selected = picked && result.trace.includes(picked) ? picked : result.trace.find((t) => !t.agree) ?? null;
  const rules = [...new Set(result.data.disagreements.map((d) => d.rule))];
  return (
    <div style={{ height: '100%', display: 'grid', alignContent: 'safe center', gap: 14 }}>
      {beat === 0 && <Flow />}
      {beat === 1 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ fontSize: 20, lineHeight: 1.6, maxWidth: 760 }}>
          Test inputs are not random guesses. They are built from the numbers and words found inside the old code, like the <b style={{ color: AMBER }}>580</b> in “score below 580”, plus the values just above and below it, where a copying mistake would show up.
          {engineer && <div className="mono" style={{ fontSize: 13, color: 'var(--muted)', marginTop: 10 }}>Seeded java.util.Random (seed 731), ported bit-for-bit, so the browser and the Java playground generate the same {result.data.cases} cases.</div>}
        </motion.div>
      )}
      {beat >= 2 && (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {beat === 4 ? (['correct', 'mistake'] as const).map((w) => (
              <button key={w} className={`pill ${w === choice ? (w === 'mistake' ? 'bad' : 'ok') : ''}`} style={{ cursor: 'pointer' }} onClick={() => { setChoice(w); setPicked(null); }}>
                {w === 'correct' ? 'Correct AI links' : 'AI links with the S → EMPLOYED mistake'}
              </button>
            )) : <span className={`pill ${which === 'mistake' ? 'bad' : 'ok'}`}>{which === 'mistake' ? 'AI links with the S → EMPLOYED mistake' : 'Correct AI links'}</span>}
            <span style={{ color: 'var(--muted)' }}>
              {result.data.cases} cases · {result.data.disagreements.length === 0 ? <b style={{ color: GREEN }}>0 disagreements</b> : <b style={{ color: RED }}>{result.data.disagreements.length} disagreements in {rules.join(', ')}</b>}
            </span>
          </div>
          <Grid key={which} result={result} picked={selected} onPick={setPicked} />
          <div style={{ minHeight: 60 }}>
            {selected && !selected.agree && (
              <motion.div key={result.trace.indexOf(selected)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ display: 'grid', gap: 6 }}>
                <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{selected.rule} · {Object.entries(selected.input).map(([k, v]) => `${k}=${show(v)}`).join('  ')}</span>
                <div style={{ display: 'flex', gap: 10 }}>
                  <span className="pill legacy">old: {outcome(selected.legacy)}</span>
                  <span style={{ color: RED, fontWeight: 800 }}>≠</span>
                  <span className="pill modern">new: {outcome(selected.modern)}</span>
                </div>
              </motion.div>
            )}
            {selected?.agree && <span style={{ color: GREEN }}>{selected.rule}: both systems answered “{outcome(selected.legacy)}”.</span>}
          </div>
        </>
      )}
    </div>
  );
}

export const fuzzChapter: Chapter = {
  id: 'fuzz',
  title: 'Prove it',
  subtitle: 'Differential fuzzing across two systems',
  beats: [
    { caption: 'Last step: feed the same inputs to the old system and the new one, and compare every answer.', detail: 'Differential fuzzing. The old side runs the real compiled LoanDesk code.', ms: 6000 },
    { caption: 'The inputs come from the old code itself.', ms: 7000 },
    { caption: 'With the correct AI links, every case agrees. Each square is one test case.', detail: 'Computed live in this page: legacy bytecode on the TypeScript JVM vs the generated modern rules.', ms: 9000 },
    { caption: 'With the AI’s S → EMPLOYED mistake, red squares appear, and only on the two rules that care about self-employment.', detail: 'Same failure shape as in chapter 1: one bad link, every affected rule wrong the same way. Fix the link once.', ms: 10000 },
    { caption: 'Your turn: switch the AI links and click any red square to see the input and both answers.', ms: 60000 },
  ],
  Scene,
};
