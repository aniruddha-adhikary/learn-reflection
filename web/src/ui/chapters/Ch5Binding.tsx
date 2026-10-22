import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { Chapter, SceneProps } from '../course/types';
import { evidence, type EvidenceResult, type EvidenceTrace } from '../../porter';
import { courseBindings, type CourseBindings } from '../../course-data';

const AMBER = '#f5a524';
const CYAN = '#22d3ee';
const GREEN = '#34d399';
const RED = '#f87171';
const VIOLET = '#a78bfa';

type Which = 'correct' | 'mistake';

const cache = new Map<Which, EvidenceResult>();
function evidenceFor(which: Which): EvidenceResult {
  const hit = cache.get(which);
  if (hit) return hit;
  const result = evidence(courseBindings[which]);
  cache.set(which, result);
  return result;
}

function fieldName(legacy: string): string {
  const hash = legacy.indexOf('#');
  if (hash < 0) throw new Error(`binding legacy key without '#': ${legacy}`);
  return legacy.slice(hash + 1);
}

function show(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(show).join(', ')}]`;
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new Error(`evidence: unexpected value ${JSON.stringify(value)}`);
}

function Proposal({ bindings, highlight }: { bindings: CourseBindings; highlight: boolean }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {bindings.bindings.map((b, i) => {
        const bad = highlight && b.values?.S === 'EMPLOYED';
        return (
          <motion.div key={b.legacy} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 * i }} style={{ display: 'grid', gridTemplateColumns: '170px 40px 190px 1fr', alignItems: 'center', gap: 6 }}>
            <span className="pill legacy mono">{fieldName(b.legacy)}</span>
            <motion.span initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.12 * i + 0.2 }} style={{ height: 2, background: bad ? RED : VIOLET, transformOrigin: 'left' }} />
            <span className="pill modern mono">{b.modern}{b.via ? ` (${b.via})` : ''}</span>
            {b.values && (
              <span className="mono" style={{ fontSize: 12, color: bad ? RED : 'var(--muted)' }}>
                {Object.entries(b.values).map(([k, v]) => `${k}→${v}`).join('  ')}
              </span>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

function Grid({ result, onPick, picked }: { result: EvidenceResult; onPick: (t: EvidenceTrace) => void; picked: EvidenceTrace | null }) {
  const records = useMemo(() => [...new Set(result.trace.map((t) => t.recordId))], [result]);
  const byKey = useMemo(() => new Map(result.trace.map((t) => [`${t.legacyField}|${t.recordId}`, t])), [result]);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `170px repeat(${String(records.length)}, 1fr) 150px`, gap: 4, alignItems: 'center' }}>
      <span />
      {records.map((r) => <span key={r} className="mono" style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>{r.slice(2)}</span>)}
      <span />
      {result.data.map((row, ri) => (
        <Row key={row.legacyField} ri={ri} row={row} records={records} byKey={byKey} onPick={onPick} picked={picked} />
      ))}
    </div>
  );
}

function Row({ ri, row, records, byKey, onPick, picked }: { ri: number; row: EvidenceResult['data'][number]; records: readonly string[]; byKey: ReadonlyMap<string, EvidenceTrace>; onPick: (t: EvidenceTrace) => void; picked: EvidenceTrace | null }) {
  const ok = row.status === 'CONFIRMED';
  return (
    <>
      <span className="mono" style={{ fontSize: 13, color: ok ? 'var(--text)' : RED }}>{fieldName(row.legacyField)}</span>
      {records.map((r, ci) => {
        const t = byKey.get(`${row.legacyField}|${r}`);
        if (!t) throw new Error(`evidence trace missing ${row.legacyField} for ${r}`);
        const sel = picked === t;
        return (
          <motion.button
            key={r}
            aria-label={`${fieldName(row.legacyField)} ${r}`}
            onClick={() => { onPick(t); }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.04 * ci + 0.08 * ri }}
            style={{ height: 24, borderRadius: 6, cursor: 'pointer', border: sel ? '2px solid #fff' : '1px solid transparent', background: t.agree ? '#34d39966' : '#f87171cc' }}
          />
        );
      })}
      <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.08 * ri + 0.6 }} className={`pill ${ok ? 'ok' : 'bad'}`} style={{ fontSize: 12 }}>
        {ok ? `✓ ${String(row.matches)}/${String(row.total)}` : `✗ ${String(row.matches)}/${String(row.total)}`}
      </motion.span>
    </>
  );
}

function Scene({ beat, engineer }: SceneProps) {
  const [choice, setChoice] = useState<Which>('mistake');
  const which: Which = beat < 3 ? 'correct' : beat === 3 ? 'mistake' : choice;
  const result = evidenceFor(which);
  const [picked, setPicked] = useState<EvidenceTrace | null>(null);
  const rejected = result.data.filter((r) => r.status === 'REJECTED');
  const selected = picked && result.trace.includes(picked) ? picked : result.trace.find((t) => !t.agree) ?? null;
  return (
    <div style={{ height: '100%', display: 'grid', alignContent: 'safe center', gap: 16 }}>
      {beat <= 1 ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 24, alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', gap: 120, marginBottom: 10 }}>
              <span className="kicker" style={{ color: AMBER }}>Old fields (from chapter 3)</span>
              <span className="kicker" style={{ color: CYAN }}>New fields</span>
            </div>
            {beat === 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: '170px 190px', columnGap: 46, rowGap: 6 }}>
                {courseBindings.correct.bindings.map((b) => (
                  <div key={b.legacy} style={{ display: 'contents' }}>
                    <span className="pill legacy mono">{fieldName(b.legacy)}</span>
                    <span className="pill modern mono" style={{ opacity: 0.7 }}>?</span>
                  </div>
                ))}
              </div>
            ) : (
              <Proposal bindings={courseBindings.correct} highlight={false} />
            )}
          </div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ border: `1px solid ${VIOLET}`, borderRadius: 14, padding: 16, background: '#a78bfa14' }}>
            <div className="kicker" style={{ color: VIOLET }}>{beat === 0 ? 'Who links them?' : 'The AI’s whole job'}</div>
            <p style={{ margin: '8px 0 0', lineHeight: 1.5 }}>
              {beat === 0
                ? 'Reflection tells us what the old fields really are. It cannot know that “empStat = S” means self-employed in the new system.'
                : `${String(courseBindings.correct.bindings.length)} small links and one value table. No rule logic, no code. That is all the AI writes.`}
            </p>
            {engineer && beat === 1 && <pre className="mono" style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>{'data/bindings.ai.json\nproposedBy: ' + courseBindings.correct.proposedBy}</pre>}
          </motion.div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {beat >= 3 && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {beat === 4 ? (
                (['correct', 'mistake'] as const).map((w) => (
                  <button key={w} className={`pill ${w === choice ? (w === 'mistake' ? 'bad' : 'ok') : ''}`} style={{ cursor: 'pointer' }} onClick={() => { setChoice(w); setPicked(null); }}>
                    {w === 'correct' ? 'AI proposal: correct' : 'AI proposal: with a mistake'}
                  </button>
                ))
              ) : (
                <span className="pill bad">AI proposal with a mistake: S → EMPLOYED</span>
              )}
            </div>
          )}
          {beat >= 3 && (
            <>
              <Proposal key={`proposal-${which}`} bindings={{ ...courseBindings[which], bindings: courseBindings[which].bindings.filter((b) => b.values !== undefined) }} highlight={which === 'mistake'} />
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                plus {String(courseBindings[which].bindings.filter((b) => b.values === undefined).length)} plain field links, same in both proposals
              </span>
            </>
          )}
          <div className="kicker" style={{ color: GREEN }}>Checked against all 12 applicants, old system vs new system</div>
          <Grid key={`grid-${which}`} result={result} onPick={setPicked} picked={selected} />
          <div style={{ minHeight: 48 }}>
            {selected && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="mono" style={{ color: 'var(--muted)' }}>{selected.recordId} · {fieldName(selected.legacyField)}</span>
                <span className="pill legacy mono">old: {show(selected.legacyValue)}</span>
                <span style={{ color: selected.agree ? GREEN : RED, fontWeight: 800 }}>{selected.agree ? '=' : '≠'}</span>
                <span className="pill modern mono">new: {show(selected.modernValue)}</span>
              </div>
            )}
            {rejected.map((r) => (
              <div key={r.legacyField} style={{ color: RED, marginTop: 6 }}>
                Rejected {fieldName(r.legacyField)}: first broken on {r.firstRecordId}{engineer ? ` (${r.reason})` : ''}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const bindingChapter: Chapter = {
  id: 'binding',
  title: 'Bind old to new',
  subtitle: 'The one job we give to AI',
  beats: [
    { caption: 'We now know what each old field really holds. The new system has its own fields. Something has to say which goes with which.', ms: 6000 },
    { caption: 'That is the one job we give AI: propose the links. It writes no rules and no code, just this short list.', detail: 'A small surface means few places for a mistake to hide.', ms: 7000 },
    { caption: 'We don’t trust the AI either. Every link is checked on all 12 applicants, old value against new value.', detail: 'Evidence: reflection reads the legacy object, the modern event is read by path, both run in this page.', ms: 8000 },
    { caption: 'Here the AI linked self-employed (S) to EMPLOYED. The check catches it on the first applicant it breaks.', detail: 'S and E would both become EMPLOYED. Values that differ in the old system must stay different, so the link is rejected.', ms: 9000 },
    { caption: 'Your turn: switch between the two AI proposals and click any square to see the two values.', ms: 60000 },
  ],
  Scene,
};
