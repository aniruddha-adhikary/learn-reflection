import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { Chapter, SceneProps } from '../../course/types';
import { buildFromRow, invokeLab, type LabCall } from '../../../porter';
import { legacyCell, legacyRows } from '../../data/sample';
import { AMBER, CYAN, Code, GREEN, Note, Panel, RED, VIOLET, fmt } from './kit';

const APP = 'A-1002';
const CALLS_BY_BEAT: readonly number[] = [1, 2, 3, 4, 5, 7];

function Call({ call, i, latest }: { call: LabCall; i: number; latest: boolean }) {
  const ok = call.outcome.ok;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: latest ? 1 : 0.55, y: 0 }} transition={{ delay: latest ? 0.15 : 0 }} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }} data-call={i}>
      <pre className="mono" style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap', color: '#e8ecff' }}>{call.java}</pre>
      <motion.span
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: latest ? 0.6 : 0, type: 'spring' }}
        className={`pill mono ${ok ? 'ok' : 'bad'}`}
        style={{ whiteSpace: 'nowrap' }}
      >
        {call.outcome.ok ? `→ ${fmt(call.outcome.value)}` : `✗ ${call.outcome.exception.replace('java.lang.', '')}`}
      </motion.span>
    </motion.div>
  );
}

function ObjectBox({ calls, shown }: { calls: readonly LabCall[]; shown: number }) {
  const value = (i: number): string => {
    const c = calls[i];
    if (!c?.outcome.ok) throw new Error(`invokeLab call ${String(i)} did not succeed`);
    return fmt(c.outcome.value);
  };
  const opened = shown >= 4;
  const score = shown >= 5 ? value(4) : opened ? value(3) : '?';
  const annual = shown >= 7 ? value(6) : '?';
  const fields: readonly (readonly [string, string, boolean])[] = [
    ['creditScore', score, opened],
    ['annualIncome', annual, shown >= 7],
  ];
  return (
    <Panel title={`applicant ${APP} (in memory)`} color={AMBER}>
      {fields.map(([name, v, open]) => (
        <div key={name} className="mono" style={{ display: 'grid', gridTemplateColumns: '24px 130px 1fr', gap: 6, fontSize: 14, alignItems: 'center' }}>
          <motion.span key={String(open)} initial={{ rotate: -30 }} animate={{ rotate: 0 }} aria-hidden>{open ? '🔓' : '🔒'}</motion.span>
          <span style={{ color: VIOLET }}>private int {name}</span>
          <motion.span key={v} initial={{ scale: 1.6, color: GREEN }} animate={{ scale: 1, color: '#e8ecff' }} style={{ justifySelf: 'start' }}>{v}</motion.span>
        </div>
      ))}
      {shown >= 3 && shown < 4 && <Note><span style={{ color: RED }}>The field is private.</span> Reflection still respects access rules until you opt out.</Note>}
    </Panel>
  );
}

function RowBuilder({ engineer }: { engineer: boolean }) {
  const [app, setApp] = useState(APP);
  const build = useMemo(() => buildFromRow(app), [app]);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span className="kicker" style={{ color: AMBER }}>CSV row from the nightly file</span>
        <select value={app} onChange={(e) => setApp(e.target.value)} aria-label="Applicant" className="mono" style={{ padding: 4, background: '#0b1022', color: '#e8ecff', border: '1px solid #2a3358', borderRadius: 8 }}>
          {legacyRows.map((r) => <option key={legacyCell(r, 'APP_ID')} value={legacyCell(r, 'APP_ID')}>{legacyCell(r, 'APP_ID')}</option>)}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '120px 170px 40px 200px 40px 1fr', rowGap: 6, columnGap: 6, alignItems: 'center' }}>
        {['column', 'raw text', '', 'setter found by reflection', '', 'typed value'].map((h, i) => <span key={i} className="kicker" style={{ fontSize: 10 }}>{h}</span>)}
        {build.bindings.map((b, i) => (
          <div key={`${app}-${b.column}`} style={{ display: 'contents' }}>
            <span className="pill legacy mono">{b.column}</span>
            <span className="mono" style={{ fontSize: 13 }}>{JSON.stringify(b.raw)}</span>
            <motion.span initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.25 * i }} style={{ color: VIOLET }}>→</motion.span>
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 * i + 0.1 }} className="pill mono" style={{ borderColor: GREEN }}>{b.setter}({b.javaType.replace('java.lang.', '')})</motion.span>
            <motion.span initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.25 * i + 0.2 }} style={{ color: VIOLET }}>→</motion.span>
            <motion.span initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.25 * i + 0.3 }} className="mono" style={{ color: CYAN }}>{fmt(b.value)}</motion.span>
          </div>
        ))}
      </div>
      <Note>
        Read back through every getter:{' '}
        <span className="mono" style={{ color: '#e8ecff' }}>{Object.entries(build.readBack).map(([k, v]) => `${k}=${fmt(v)}`).join('  ')}</span>
      </Note>
      {engineer && (
        <Code dim>{'for (var e : columns.entrySet()) {\n  PropertyDescriptor p = props.get(e.getValue());\n  Object v = convert(row.get(e.getKey()), p.getWriteMethod().getParameterTypes()[0]);\n  p.getWriteMethod().invoke(applicant, v);\n}'}</Code>
      )}
    </div>
  );
}

function Scene({ beat, engineer }: SceneProps) {
  const calls = useMemo(() => invokeLab(APP), []);
  if (beat >= CALLS_BY_BEAT.length) {
    return <div style={{ height: '100%', display: 'grid', alignContent: 'safe center' }}><RowBuilder engineer={engineer} /></div>;
  }
  const shown = CALLS_BY_BEAT[beat] ?? 0;
  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 20, alignContent: 'safe center' }}>
      <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
        {calls.slice(0, shown).map((c, i) => <Call key={i} call={c} i={i} latest={i >= (CALLS_BY_BEAT[beat - 1] ?? 0)} />)}
      </div>
      <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
        <ObjectBox calls={calls} shown={shown} />
        {shown >= 7 && (
          <Note>
            <span className="mono">getIncome()</span> returned <b>{calls[5]?.outcome.ok ? fmt(calls[5].outcome.value) : '?'}</b>, but the field holds{' '}
            <b>{calls[6]?.outcome.ok ? fmt(calls[6].outcome.value) : '?'}</b>. Reflection can call the getter, but it can&apos;t tell you why they differ.
          </Note>
        )}
        {engineer && <Code dim>{'Method.invoke boxes ints to Integer\nInvocationTargetException wraps whatever the method throws'}</Code>}
      </div>
    </div>
  );
}

export const invokeChapter: Chapter = {
  id: 'invoke',
  title: 'Invoke and set',
  subtitle: 'Call it without naming it in code',
  beats: [
    { caption: 'Start from a name in a string. Class.forName gives you the class.', ms: 4000 },
    { caption: 'getMethod finds a method by name; invoke calls it on a real applicant. No compiled call to getCredScr anywhere.', ms: 6000 },
    { caption: 'Read the private field directly and Java says no: IllegalAccessException.', ms: 6000 },
    { caption: 'setAccessible(true) opts out of the check. Now the private value comes out.', ms: 5000 },
    { caption: 'Field.set writes into the object; the getter sees the new value straight away.', ms: 6000 },
    { caption: 'Call getIncome and read annualIncome. They disagree, and reflection alone can’t say why.', ms: 7000 },
    { caption: 'Put it together: build an applicant from a CSV row using only setters reflection found. Pick any row.', ms: 60000 },
  ],
  Scene,
};
