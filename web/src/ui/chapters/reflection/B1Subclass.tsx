import { useMemo } from 'react';
import { motion } from 'motion/react';
import type { Chapter, SceneProps } from '../../course/types';
import { classView, getterRecorder, type MemberRef } from '../../../porter';
import { AMBER, CYAN, Code, GREEN, Note, Panel, RED, VIOLET, short } from './kit';

function label(ref: MemberRef): string {
  return `${short(ref.owner.replaceAll('/', '.'))}.${ref.name}`;
}

function key(ref: MemberRef): string {
  return `${ref.owner}.${ref.name}${ref.descriptor}`;
}

function Subclass() {
  const view = useMemo(() => classView('legacy.model.Applicant'), []);
  if (view.kind !== 'class') throw new Error(`legacy.model.Applicant is a ${view.kind}, expected a class`);
  const getters = useMemo(() => view.declaredMethods.map((m) => m.name).filter((n) => n.startsWith('get') || n.startsWith('is')), [view]);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
      <Panel title="java.lang.reflect.Proxy" color={RED}>
        <Code>{'Proxy.newProxyInstance(loader,\n  new Class<?>[] { Applicant.class }, h)'}</Code>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} className="mono" style={{ color: RED, fontSize: 13 }}>IllegalArgumentException: legacy.model.Applicant is not an interface</motion.div>
        <Note>Proxy only works for interfaces. Applicant is a plain class, like most legacy models.</Note>
      </Panel>
      <Panel title="ByteBuddy subclass" color={GREEN} delay={0.5}>
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="mono" style={{ padding: 8, borderRadius: 8, border: `1px solid ${AMBER}`, fontSize: 12 }}>legacy.model.Applicant</div>
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="mono" style={{ marginLeft: 24, padding: 8, borderRadius: 8, border: `1px dashed ${GREEN}`, fontSize: 12, display: 'grid', gap: 3 }}>
            <span style={{ color: GREEN }}>Applicant$ByteBuddy (generated subclass)</span>
            {getters.map((g, i) => (
              <motion.span key={g} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 + 0.15 * i }}>override {g}() {'{'} log; return super.{g}(); {'}'}</motion.span>
            ))}
          </motion.div>
        </div>
      </Panel>
    </div>
  );
}

function Matrix({ compare }: { compare: boolean }) {
  const records = useMemo(() => getterRecorder(), []);
  const columns = useMemo(() => {
    const seen = new Map<string, MemberRef>();
    for (const r of records) for (const g of [...r.orderedGetters, ...r.staticGetters]) seen.set(key(g), g);
    return [...seen.values()];
  }, [records]);
  return (
    <Panel title={compare ? 'Recorded at run time vs read from bytecode' : 'Which getters each rule actually called'} color={CYAN}>
      <div style={{ overflow: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `170px repeat(${String(columns.length)}, 64px)${compare ? ' 140px' : ''}`, gap: 4, alignItems: 'center', fontSize: 11 }}>
          <span />
          {columns.map((c) => <span key={key(c)} className="mono" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: 130, color: 'var(--muted)' }}>{label(c)}</span>)}
          {compare && <span className="kicker">ASM = ByteBuddy?</span>}
          {records.map((r, ri) => {
            const dynamic = new Set(r.orderedGetters.map(key));
            const staticSet = new Set(r.staticGetters.map(key));
            const same = r.staticOnly.length === 0 && r.dynamicOnly.length === 0;
            return (
              <div key={r.rule} style={{ display: 'contents' }}>
                <span className="mono" style={{ fontSize: 12 }}>{r.rule}</span>
                {columns.map((c, ci) => {
                  const d = dynamic.has(key(c));
                  const s = staticSet.has(key(c));
                  const color = compare && d !== s ? RED : d ? GREEN : 'transparent';
                  return (
                    <span key={key(c)} style={{ display: 'grid', placeItems: 'center' }}>
                      <motion.span initial={{ scale: 0 }} animate={{ scale: d || s ? 1 : 0.3 }} transition={{ delay: 0.08 * ri + 0.03 * ci }} style={{ width: 18, height: 18, borderRadius: 9, background: color, border: '1px solid #2a3358', display: 'inline-block' }} />
                    </span>
                  );
                })}
                {compare && <span style={{ color: same ? GREEN : RED, fontSize: 12 }}>{same ? 'same' : `static-only ${String(r.staticOnly.length)}, run-only ${String(r.dynamicOnly.length)}`}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

function Scene({ beat, engineer }: SceneProps) {
  return (
    <div style={{ height: '100%', display: 'grid', gap: 12, alignContent: 'safe center' }}>
      {beat === 0 ? <Subclass /> : <Matrix compare={beat >= 2} />}
      {beat >= 2 && <Note>Two independent ways to answer &ldquo;what does this rule read?&rdquo;: ASM reads the instructions, the recorder watches real runs. When they agree, the binding list for the new system is complete. A gap would mean a path the test data never reached, or code the reader missed.</Note>}
      {engineer && (
        <Code>{`new ByteBuddy().subclass(Applicant.class)
  .method(nameStartsWith("get").or(nameStartsWith("is")))
  .intercept(MethodDelegation.to(new Recorder(log)))   // @SuperCall Callable<?> zuper
  .make().load(Applicant.class.getClassLoader()).getLoaded()`}</Code>
      )}
      {beat === 1 && <Note>Each rule ran on all 12 applicants with every legacy-model getter wrapped. A dot means the rule called it at least once.<span style={{ color: VIOLET }}> (In the browser the teaching JVM provides the same hook; real ByteBuddy runs in the lab.)</span></Note>}
    </div>
  );
}

export const bbSubclassChapter: Chapter = {
  id: 'bb-subclass',
  title: 'ByteBuddy: proxies for real classes',
  subtitle: 'Generate a subclass at run time to watch what a rule reads',
  beats: [
    { caption: 'A reflection Proxy needs an interface. Legacy models are plain classes. ByteBuddy writes a subclass on the fly that overrides every getter.', ms: 9000 },
    { caption: 'Wrap the applicant, run each rule, and record every getter it touches.', ms: 60000 },
    { caption: 'Line the recording up against what ASM read from the bytecode. Every rule matches.', ms: 60000 },
  ],
  Scene,
};
