import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { Chapter, SceneProps } from '../../course/types';
import { classView, courseClassNames, implementors } from '../../../porter';
import { Code, GREEN, Note, Panel, VIOLET, pkg, short, worldColor } from './kit';

const RULE = 'legacy.engine.Rule';
const START = 'legacy.model.Applicant';

function ClassCard({ name, isRule }: { name: string; isRule: boolean }) {
  const view = classView(name);
  const color = worldColor(name);
  const rows: readonly (readonly [string, string])[] = [
    ['getName()', view.name],
    ['kind', view.kind],
    ['getModifiers()', view.modifiers.join(' ') || '(none)'],
    ['getSuperclass()', view.kind === 'interface' ? 'null (interfaces have none)' : (view.superclass ?? 'java.lang.Object')],
    ['getInterfaces()', view.interfaces.length === 0 ? '[]' : `[${view.interfaces.map(short).join(', ')}]`],
    ['declared fields', String(view.declaredFields.length)],
    ['declared methods', String(view.declaredMethods.length)],
    ['implements Rule?', isRule ? 'yes' : 'no'],
  ];
  return (
    <Panel key={name} title={`Class<?> ${short(name)}`} color={color}>
      {rows.map(([k, v], i) => (
        <motion.div key={k} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.08 * i }} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 8, fontSize: 13 }}>
          <span className="mono" style={{ color: 'var(--muted)' }}>{k}</span>
          <span className="mono" style={{ color: k === 'implements Rule?' && isRule ? GREEN : '#e8ecff', wordBreak: 'break-all' }}>{v}</span>
        </motion.div>
      ))}
    </Panel>
  );
}

function Scene({ beat, engineer }: SceneProps) {
  const names = useMemo(() => courseClassNames(), []);
  const rules = useMemo(() => new Set(implementors(RULE)), []);
  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const n of names) map.set(pkg(n), [...(map.get(pkg(n)) ?? []), n]);
    return [...map.entries()];
  }, [names]);
  const [picked, setPicked] = useState(START);
  const focus = beat >= 3 ? picked : START;
  const scanning = beat >= 2;

  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateColumns: beat >= 1 ? 'minmax(0, 1fr) 340px' : 'minmax(0, 1fr)', gap: 20, alignContent: 'safe center' }}>
      <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
        {beat === 0 && <Code>{'// every loaded class has exactly one Class object\nClass<?> c = applicant.getClass();   // or Applicant.class'}</Code>}
        {beat === 1 && <Code>{`Class<?> c = Class.forName("${START}");`}</Code>}
        {beat >= 2 && (
          <Code>{`Class<?> rule = Class.forName("${RULE}");\nfor (Class<?> c : allClasses)\n  if (rule.isAssignableFrom(c) && !c.isInterface()) found.add(c);`}</Code>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {groups.map(([p, members], gi) => (
            <motion.div key={p} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: beat === 0 ? 0.08 * gi : 0 }} style={{ border: '1px solid #232b4a', borderRadius: 10, padding: '6px 8px', display: 'grid', gap: 4, alignContent: 'start' }}>
              <div className="mono" style={{ fontSize: 10, color: worldColor(members[0] ?? p) }}>{p}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 330 }}>
                {members.map((n, i) => {
                  const hit = rules.has(n);
                  const isFocus = beat >= 1 && n === focus;
                  return (
                    <motion.button
                      key={n}
                      className="mono"
                      onClick={() => { if (beat >= 3) setPicked(n); }}
                      animate={{
                        opacity: scanning && !hit && !isFocus ? 0.3 : 1,
                        scale: isFocus ? 1.08 : 1,
                        borderColor: isFocus ? VIOLET : scanning && hit ? GREEN : '#2a3358',
                        backgroundColor: scanning && hit ? '#34d39922' : '#0b1022',
                      }}
                      transition={{ delay: scanning && beat === 2 ? 0.03 * names.indexOf(n) : 0 }}
                      style={{ fontSize: 11, padding: '2px 6px', borderRadius: 6, border: '1px solid', color: '#e8ecff', cursor: beat >= 3 ? 'pointer' : 'default' }}
                      aria-label={n}
                      aria-pressed={isFocus}
                      data-index={i}
                    >
                      {short(n)}
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          ))}
        </div>
        {beat === 0 && <Note>{String(names.length)} compiled classes from both systems, loaded straight from their .class files. Amber is the old LoanDesk, cyan is the new LoanFlow.</Note>}
        {beat >= 2 && (
          <Note>
            <b style={{ color: GREEN }}>{String(rules.size)}</b> of {String(names.length)} classes implement <span className="mono">Rule</span>. Found by type, not by
            name: rename every rule tomorrow and this still finds them all.
          </Note>
        )}
      </div>
      {beat >= 1 && (
        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          {beat >= 3 && (
            <select value={picked} onChange={(e) => setPicked(e.target.value)} className="mono" aria-label="Class" style={{ width: '100%', padding: 6, background: '#0b1022', color: '#e8ecff', border: '1px solid #2a3358', borderRadius: 8 }}>
              {names.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
          <ClassCard key={focus} name={focus} isRule={rules.has(focus)} />
          {engineer && (
            <Code dim>{'c.getName()          c.getModifiers()\nc.getSuperclass()    c.getInterfaces()\nModifier.toString(c.getModifiers())'}</Code>
          )}
        </div>
      )}
    </div>
  );
}

export const classesChapter: Chapter = {
  id: 'classes',
  title: 'Class objects',
  subtitle: 'What is this thing?',
  beats: [
    { caption: 'Every class the JVM loads is described by one Class object. Here are all of them from both systems.', ms: 6000 },
    { caption: 'Class.forName turns a name into that object. Ask it what kind of thing it is, what it extends, what it implements.', ms: 7000 },
    { caption: 'Now ask every class one question: do you implement Rule? Only the real rules light up.', ms: 7000 },
    { caption: 'Your turn: click any class, or pick one from the list, and read its Class object.', ms: 0 },
  ],
  Scene,
};
