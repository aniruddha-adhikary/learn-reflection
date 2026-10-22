import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { Chapter, SceneProps } from '../course/types';
import { inert, transform, type RuleRecord } from '../../porter';
import r01Source from '../../../../playground/legacy/src/main/java/legacy/rules/R01_MinimumScore.java?raw';

const AMBER = '#f5a524';
const CYAN = '#22d3ee';
const GREEN = '#34d399';
const RED = '#f87171';
const VIOLET = '#a78bfa';
const SERVICE_METRICS: ReadonlySet<string> = new Set(['credit.score']);

function reads(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => { reads(v, out); });
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'read' && typeof v === 'string') out.add(v);
      else reads(v, out);
    }
  }
  return out;
}

function body(source: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => l.includes('public class'));
  if (start < 0) throw new Error('rule source has no class declaration');
  return lines.slice(start).join('\n').trimEnd();
}

function RuleCard({ rule, active, onClick }: { rule: RuleRecord; active: boolean; onClick: () => void }) {
  const metrics = [...reads(rule.when)];
  return (
    <button onClick={onClick} style={{ textAlign: 'left', cursor: 'pointer', background: active ? '#22d3ee18' : '#0d1430', border: `1px solid ${active ? CYAN : 'var(--line)'}`, borderRadius: 10, padding: '7px 10px', color: 'var(--text)' }}>
      <div className="mono" style={{ fontSize: 12 }}>{rule.ruleId} → {rule.emit}</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
        {metrics.map((m) => <span key={m} className={`pill ${SERVICE_METRICS.has(m) ? 'ai' : 'modern'}`} style={{ fontSize: 10, padding: '1px 6px' }}>{m}</span>)}
      </div>
    </button>
  );
}

function Scene({ beat, engineer }: SceneProps) {
  const rules = useMemo(() => transform().rules, []);
  const tripwire = useMemo(() => inert(), []);
  const r01 = rules.find((r) => r.legacyRule === 'R01_MinimumScore');
  if (!r01) throw new Error('transform: R01_MinimumScore produced no rule');
  const [picked, setPicked] = useState(r01.ruleId);
  const pickedRule = rules.find((r) => r.ruleId === picked) ?? r01;
  const touchesService = (r: RuleRecord) => [...reads(r.when)].some((m) => SERVICE_METRICS.has(m));
  return (
    <div style={{ height: '100%', display: 'grid', alignContent: 'center', gap: 16 }}>
      {beat === 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 12, alignItems: 'center' }}>
          <div style={{ border: `1px solid ${AMBER}`, borderRadius: 14, padding: 14, background: '#f5a52410' }}>
            <div className="kicker" style={{ color: AMBER }}>Old: code that reads a field</div>
            <pre className="mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{body(r01Source)}</pre>
          </div>
          <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.5, duration: 0.6 }} style={{ height: 3, background: VIOLET, transformOrigin: 'left' }} />
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1 }} style={{ border: `1px solid ${CYAN}`, borderRadius: 14, padding: 14, background: '#22d3ee10' }}>
            <div className="kicker" style={{ color: CYAN }}>New: a filled-in template</div>
            <pre className="mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{JSON.stringify(r01, null, 2)}</pre>
          </motion.div>
        </div>
      )}
      {beat >= 1 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 22 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, alignContent: 'start' }}>
            {rules.map((r, i) => (
              <motion.div key={r.ruleId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: beat === 2 && touchesService(r) ? 0.35 : 1, y: 0 }} transition={{ delay: 0.05 * i }}>
                <RuleCard rule={r} active={beat === 3 && r.ruleId === pickedRule.ruleId} onClick={() => { setPicked(r.ruleId); }} />
              </motion.div>
            ))}
          </div>
          <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="pill modern">event payload</span>
              <span style={{ color: 'var(--muted)' }}>arrives with the application</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="pill ai">credit.score</span>
              <span style={{ color: 'var(--muted)' }}>a call to the credit bureau, made only when a rule needs it</span>
            </div>
            {beat === 2 && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ display: 'grid', gap: 8 }}>
                <div style={{ border: `1px dashed ${RED}`, borderRadius: 12, padding: 12 }}>
                  <b>Tripwire:</b> the credit bureau is replaced by a fake that explodes if anyone calls it.
                </div>
                <div className={`pill ${tripwire.data.lazy.status === 'PASS' ? 'ok' : 'bad'}`} style={{ justifySelf: 'start' }}>
                  New engine, only the rules that don’t need the score: {tripwire.data.lazy.status} (never called it)
                </div>
                <div className={`pill ${tripwire.data.prefetch.status === 'PASS' ? 'ok' : 'bad'}`} style={{ justifySelf: 'start' }}>
                  An engine that fetches everything up front: {tripwire.data.prefetch.status}
                </div>
                {engineer && <pre className="mono" style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>{tripwire.trace.join('\n')}</pre>}
              </motion.div>
            )}
            {beat === 3 && (
              <motion.div key={pickedRule.ruleId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>
                <div style={{ marginBottom: 6 }}>
                  {pickedRule.ruleId} came from old rule <span className="mono" style={{ color: AMBER }}>{pickedRule.legacyRule}</span>.{' '}
                  {touchesService(pickedRule) ? <span style={{ color: VIOLET }}>It needs the credit bureau.</span> : <span style={{ color: GREEN }}>It never calls the credit bureau.</span>}
                </div>
                <pre className="mono" style={{ fontSize: 11, whiteSpace: 'pre-wrap', margin: 0, color: 'var(--muted)' }}>{JSON.stringify(pickedRule.when, null, 2)}</pre>
              </motion.div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const shapeChapter: Chapter = {
  id: 'shape',
  title: 'Change the shape, keep the logic',
  subtitle: 'Same rule, new data flow',
  beats: [
    { caption: 'The old rule was code that read a field. In the new system it becomes a filled-in template: plain data, with the same number in it.', detail: 'Generated by the deterministic transformer from the bytecode facts. No AI wrote this.', ms: 8000 },
    { caption: 'Here are all the new rules. Each one says which pieces of data it needs.', detail: 'Purple data is no longer in the file: it comes from a service.', ms: 8000 },
    { caption: 'The new engine only asks the credit bureau when a rule needs the score. We prove it with a tripwire.', detail: 'An inert proxy: a stand-in that fails loudly if it is ever touched.', ms: 10000 },
    { caption: 'Your turn: click any rule to see the old rule it came from and the data it reads.', ms: 60000 },
  ],
  Scene,
};
