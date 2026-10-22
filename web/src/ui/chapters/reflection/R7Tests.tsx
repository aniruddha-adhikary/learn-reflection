import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { Chapter, SceneProps } from '../../course/types';
import { classView, fuzz } from '../../../porter';
import { AMBER, CYAN, Code, GREEN, Note, Panel, RED, VIOLET, short } from './kit';

function show(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(show).join(', ')}]`;
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new Error(`fuzz: unexpected value ${JSON.stringify(value)}`);
}

function fieldType(key: string): string {
  const hash = key.lastIndexOf('#');
  if (hash < 0) throw new Error(`fuzz domain key ${key} has no owner`);
  const owner = key.slice(0, hash);
  const name = key.slice(hash + 1);
  const field = classView(owner).declaredFields.find((f) => f.name === name);
  if (!field) throw new Error(`No reflected field ${key}`);
  return short(field.javaType);
}

function Scene({ beat, engineer }: SceneProps) {
  const result = useMemo(() => fuzz(), []);
  const rules = Object.keys(result.data.domains);
  const [pick, setPick] = useState(rules[0] ?? '');
  const rule = beat >= 2 ? pick : (rules[0] ?? '');
  const domain = result.data.domains[rule];
  if (!domain) throw new Error(`fuzz has no domain for ${rule}`);
  const perRule = rules.map((r) => [r, result.trace.filter((t) => t.rule === r).length] as const);
  const max = Math.max(...perRule.map(([, n]) => n));
  const cases = result.trace.filter((t) => t.rule === rule);

  return (
    <div style={{ height: '100%', display: 'grid', gap: 14, alignContent: 'safe center' }}>
      {beat >= 2 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {rules.map((r) => <button key={r} className={`pill mono ${r === rule ? 'ok' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setPick(r)}>{r}</button>)}
        </div>
      )}
      {beat === 1 ? (
        <div style={{ display: 'grid', gap: 6 }}>
          {perRule.map(([r, n], i) => (
            <div key={r} style={{ display: 'grid', gridTemplateColumns: '220px 1fr 50px', gap: 10, alignItems: 'center' }}>
              <span className="mono" style={{ fontSize: 13, color: AMBER }}>{r}</span>
              <motion.div initial={{ width: 0 }} animate={{ width: `${String((100 * n) / max)}%` }} transition={{ delay: 0.1 * i, duration: 0.6 }} style={{ height: 14, borderRadius: 7, background: CYAN }} />
              <span className="mono">{String(n)}</span>
            </div>
          ))}
          <Note>{String(result.data.cases)} cases in total, each run through the old Java rule and the new generated rule. Seeded, so every run produces the same cases.</Note>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 18 }}>
          <Panel key={rule} title={`What ${rule} reads (reflection gives the type)`} color={AMBER}>
            {Object.entries(domain.fields).map(([key, values], i) => (
              <motion.div key={key} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 * i }} style={{ display: 'grid', gap: 2 }}>
                <span className="mono" style={{ fontSize: 13 }}>
                  <span style={{ color: VIOLET }}>{fieldType(key)}</span> {key.slice(key.lastIndexOf('#') + 1)}
                </span>
                <span className="mono" style={{ fontSize: 12, color: CYAN, wordBreak: 'break-word' }}>{values.map(show).join('  ')}</span>
              </motion.div>
            ))}
          </Panel>
          <Panel key={`${rule}-lit`} title="Numbers and strings found in its bytecode" color={GREEN} delay={0.3}>
            <div className="mono" style={{ fontSize: 13 }}>ints: {domain.integerLiterals.map(String).join(', ') || '—'}</div>
            <div className="mono" style={{ fontSize: 13 }}>strings: {domain.stringLiterals.map((s) => JSON.stringify(s)).join(', ') || '—'}</div>
            <Note>Each literal becomes a boundary: just below, on, and just above. That&apos;s where rules break.</Note>
            {beat >= 2 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                {cases.map((c, i) => <span key={i} title={JSON.stringify(c.input)} style={{ width: 10, height: 10, borderRadius: 2, background: c.agree ? GREEN : RED }} />)}
              </div>
            )}
          </Panel>
        </div>
      )}
      {engineer && <Code dim>{'domain(rule) = reflected field types × bytecode literals (±1)\nrandom = new java.util.Random(seed)   // same LCG in the browser'}</Code>}
    </div>
  );
}

export const testsChapter: Chapter = {
  id: 'tests',
  title: 'Facts to tests',
  subtitle: 'Inputs from the code itself',
  beats: [
    { caption: 'For each rule: reflection says which fields it reads and their types; bytecode gives the numbers it compares against.', ms: 8000 },
    { caption: 'Turn those into test inputs, right around every threshold. Hundreds of cases, nobody typed them.', ms: 7000 },
    { caption: 'Your turn: pick a rule and see its inputs and every case it got. Green means old and new agree.', ms: 0 },
  ],
  Scene,
};
