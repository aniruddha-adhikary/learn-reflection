import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { Chapter, SceneProps } from '../../course/types';
import { implementors, transform } from '../../../porter';
import { AMBER, CYAN, Code, GREEN, Note, Panel, RED, VIOLET, short } from './kit';

const RULE = 'legacy.engine.Rule';

function Scene({ beat, engineer }: SceneProps) {
  const result = useMemo(() => transform(), []);
  const again = useMemo(() => JSON.stringify(transform().data) === JSON.stringify(result.data), [result]);
  const legacyRules = useMemo(() => implementors(RULE).map(short), []);
  const families = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of result.rules) map.set(r.family, [...(map.get(r.family) ?? []), r.ruleId]);
    return [...map.entries()];
  }, [result]);
  const [pick, setPick] = useState(result.rules[0]?.ruleId ?? '');
  const record = result.rules.find((r) => r.ruleId === pick);

  if (beat === 0) {
    return (
      <div style={{ height: '100%', display: 'grid', gridTemplateColumns: '240px minmax(0, 1fr)', gap: 20, alignContent: 'safe center' }}>
        <Panel title="Found by reflection" color={AMBER}>
          {legacyRules.map((r, i) => (
            <motion.div key={r} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.08 * i }} className="mono" style={{ fontSize: 13 }}>{r}</motion.div>
          ))}
        </Panel>
        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {families.map(([family, ids], fi) => (
              <Panel key={family} title={family} color={CYAN} delay={0.9 + 0.2 * fi}>
                {ids.map((id) => <span key={id} className="pill modern mono" style={{ fontSize: 12 }}>{id}</span>)}
              </Panel>
            ))}
          </div>
          {result.findings.length > 0 && (
            <Panel title="Doesn't fit a template: a person does these" color={RED} delay={1.8}>
              {result.findings.map((f) => <div key={f.legacyRule} className="mono" style={{ fontSize: 13 }}>{f.legacyRule}: <span style={{ color: 'var(--muted)' }}>{f.reason}</span></div>)}
            </Panel>
          )}
          <Note>{String(legacyRules.length)} classes in, {String(result.rules.length)} filled-in templates and {String(result.findings.length)} reported misfit out. Reflection found the rules; bytecode reading filled in the numbers.</Note>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateColumns: '360px minmax(0, 1fr)', gap: 20, alignContent: 'safe center' }}>
      <div style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
        {result.rules.map((r) => (
          <button key={r.ruleId} className={`pill mono ${r.ruleId === pick ? 'ok' : ''}`} style={{ cursor: beat >= 2 ? 'pointer' : 'default', justifySelf: 'start', whiteSpace: 'nowrap', fontSize: 12 }} disabled={beat < 2 && r.ruleId !== pick} onClick={() => setPick(r.ruleId)}>
            {r.ruleId} <span style={{ color: 'var(--muted)' }}>← {r.legacyRule}</span>
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
        {record && (
          <Panel key={record.ruleId} title={`Generated ${record.ruleId} (${record.family})`} color={GREEN}>
            <Code>{JSON.stringify({ emit: record.emit, when: record.when }, null, 2)}</Code>
          </Panel>
        )}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className={`pill ${again ? 'ok' : 'bad'}`}>{again ? 'Run it again: byte-for-byte identical' : 'Second run differs'}</span>
          <span style={{ color: VIOLET, fontSize: 14 }}>No AI wrote this. The only AI input is the field links from the overview&apos;s chapter 5.</span>
        </motion.div>
        {engineer && <Code dim>{'facts (reflection) + paths (bytecode)\n  → match a template family\n  → fill its blanks with the literals\n  → emit JSON the modern engine loads'}</Code>}
      </div>
    </div>
  );
}

export const codegenChapter: Chapter = {
  id: 'codegen',
  title: 'Facts to code',
  subtitle: "Generate, don't hand-write",
  beats: [
    { caption: 'Reflection lists the rules; each one is matched to a template. The one that fits nothing is reported, not guessed.', ms: 8000 },
    { caption: 'Each generated rule is plain data the new engine loads. Run the generator again and you get exactly the same output.', ms: 7000 },
    { caption: 'Your turn: click any generated rule to see what came out.', ms: 60000 },
  ],
  Scene,
};
