import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { Chapter, SceneProps } from '../../course/types';
import { classView, courseClassNames, type MemberView, type MethodView, type PropertyView } from '../../../porter';
import { AMBER, CYAN, Code, GREEN, Note, Panel, RED, VIOLET, short } from './kit';

const START = 'legacy.model.Applicant';

function FieldRow({ f, i, locked }: { f: MemberView; i: number; locked: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 * i }} className="mono" style={{ display: 'grid', gridTemplateColumns: '22px 80px 140px 1fr', gap: 6, fontSize: 13 }}>
      <span aria-hidden>{locked ? '🔒' : '·'}</span>
      <span style={{ color: VIOLET }}>{f.modifiers.join(' ') || 'package'}</span>
      <span style={{ color: 'var(--muted)' }}>{short(f.javaType)}</span>
      <span style={{ color: AMBER }}>{f.name}</span>
    </motion.div>
  );
}

function MethodRow({ m, i }: { m: MethodView; i: number }) {
  const role = m.name.startsWith('get') || m.name.startsWith('is') ? 'getter' : m.name.startsWith('set') ? 'setter' : 'other';
  const color = role === 'getter' ? CYAN : role === 'setter' ? GREEN : '#e8ecff';
  return (
    <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.06 * i }} className="mono" style={{ fontSize: 13 }}>
      <span style={{ color: VIOLET }}>{m.modifiers.join(' ')} </span>
      <span style={{ color: 'var(--muted)' }}>{short(m.returnType)} </span>
      <span style={{ color }}>{m.name}</span>
      <span style={{ color: 'var(--muted)' }}>({m.parameterTypes.map(short).join(', ')})</span>
    </motion.div>
  );
}

function PropertyRow({ p, i }: { p: PropertyView; i: number }) {
  const half = p.getter === null || p.setter === null;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 * i }} className="mono" style={{ display: 'grid', gridTemplateColumns: '130px 140px 30px 140px', alignItems: 'center', gap: 6, fontSize: 13, color: half ? RED : '#e8ecff' }}>
      <span style={{ color: half ? RED : AMBER }}>{p.name}</span>
      <span className="pill" style={{ opacity: p.getter ? 1 : 0.35, borderColor: CYAN }}>{p.getter ?? 'no getter'}</span>
      <span style={{ textAlign: 'center' }}>{half ? '✗' : '⇄'}</span>
      <span className="pill" style={{ opacity: p.setter ? 1 : 0.35, borderColor: GREEN }}>{p.setter ?? 'no setter'}</span>
    </motion.div>
  );
}

function Scene({ beat, engineer }: SceneProps) {
  const names = useMemo(() => courseClassNames().filter((n) => n.startsWith('legacy.model.') || n.startsWith('modern.model.')), []);
  const [picked, setPicked] = useState(START);
  const name = beat >= 4 ? picked : START;
  const view = classView(name);
  const halves = view.properties.filter((p) => p.getter === null || p.setter === null);

  return (
    <div style={{ height: '100%', display: 'grid', gap: 14, alignContent: 'safe center' }}>
      {beat >= 4 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {names.map((n) => (
            <button key={n} className={`pill mono ${n === name ? 'ok' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setPicked(n)} aria-pressed={n === name}>{n}</button>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 18 }}>
        <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <Code>{beat === 1 ? `c.getFields()          // public only, inherited too\n→ ${String(view.fields.length)} fields` : `Field[] fs = c.getDeclaredFields();   // all, even private\n→ ${String(view.declaredFields.length)} fields`}</Code>
          <Panel key={`${name}-${String(beat === 1)}`} title={beat === 1 ? 'getFields()' : 'getDeclaredFields()'} color={AMBER}>
            {beat === 1 && view.fields.length === 0 && <Note>Nothing. Every field is private, so the public view is empty.</Note>}
            {(beat === 1 ? view.fields : view.declaredFields).map((f, i) => <FieldRow key={f.name} f={f} i={i} locked={f.modifiers.includes('private')} />)}
          </Panel>
        </div>
        <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          {beat === 2 && (
            <>
              <Code>{`Method[] ms = c.getDeclaredMethods();\n→ ${String(view.declaredMethods.length)} methods`}</Code>
              <Panel title="getDeclaredMethods()" color={CYAN}>
                {view.declaredMethods.map((m, i) => <MethodRow key={`${m.name}${m.parameterTypes.join(',')}`} m={m} i={i} />)}
              </Panel>
            </>
          )}
          {beat >= 3 && (
            <>
              <Code>{'PropertyDescriptor[] ps =\n  Introspector.getBeanInfo(c).getPropertyDescriptors();'}</Code>
              <Panel key={name} title="Properties: getter + setter pairs" color={GREEN}>
                {view.properties.map((p, i) => <PropertyRow key={p.name} p={p} i={i} />)}
              </Panel>
              {halves.length > 0 && (
                <Note>
                  <b style={{ color: RED }}>{halves.map((p) => p.name).join(' and ')}</b> {halves.length === 1 ? 'is' : 'are'} only half a property. Reflection pairs methods by name, and here the names
                  don&apos;t line up. Is <span className="mono">getIncome</span> reading <span className="mono">annualIncome</span>? Reflection can&apos;t say. Chapter 4 finds out.
                </Note>
              )}
            </>
          )}
          {engineer && beat <= 1 && <Code dim>{'Modifier.isPrivate(f.getModifiers())\nf.getType()            // int.class, String.class\nf.getGenericType()     // List<String> survives as a Signature'}</Code>}
        </div>
      </div>
    </div>
  );
}

export const membersChapter: Chapter = {
  id: 'members',
  title: 'Fields and methods',
  subtitle: 'List everything it has',
  beats: [
    { caption: 'getDeclaredFields lists every field the class declares, private ones included, with its type.', ms: 6000 },
    { caption: 'getFields only shows public fields. On a well-encapsulated class that list is empty.', ms: 5000 },
    { caption: 'getDeclaredMethods lists the methods: getters, setters and anything else, each with its exact signature.', ms: 6000 },
    { caption: 'The JavaBeans Introspector pairs getters with setters by name. Some don’t pair, which is a clue.', ms: 8000 },
    { caption: 'Your turn: pick any model class, old or new, and see what reflection finds.', ms: 60000 },
  ],
  Scene,
};
