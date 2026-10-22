import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { Chapter, SceneProps } from '../../course/types';
import { classView, implementors, proxyLab } from '../../../porter';
import { AMBER, CYAN, Code, GREEN, Note, Panel, VIOLET, simpleName } from './kit';

interface Exercise {
  readonly title: string;
  readonly file: string;
  readonly goal: string;
  readonly human: string;
  readonly agent: string;
  readonly expected: readonly string[];
}

function exercises(): readonly Exercise[] {
  const fields = classView('legacy.model.Applicant').declaredFields.map((f) => `${f.modifiers.join(' ')} ${f.javaType} ${f.name}`);
  const rules = implementors('legacy.engine.Rule');
  const run = proxyLab('R01_MinimumScore', 'A-1002');
  const log = run.events.map((e) => `${e.method}(${e.args.map(simpleName).join(', ')})`);
  return [
    {
      title: '1 · FieldDumper',
      file: 'playground/reflection-lab/src/main/java/lab/FieldDumper.java',
      goal: 'Print every declared field of a class: modifiers, type, name.',
      human: 'Open FieldDumper.java and implement dump(Class<?>) with getDeclaredFields(), Modifier.toString and getType().getTypeName(). Then run ./gradlew :reflection-lab:test --tests "*fieldDumper*" from playground/.',
      agent: 'In playground/reflection-lab, implement lab.FieldDumper.dump(Class<?>) using only java.lang.reflect. Run ./gradlew :reflection-lab:test --tests "*fieldDumper*" until it passes, and explain each reflection call you used. Do not edit the tests.',
      expected: fields,
    },
    {
      title: '2 · RuleFinder',
      file: 'playground/reflection-lab/src/main/java/lab/RuleFinder.java',
      goal: 'Find every concrete class that implements Rule, by type, not by name.',
      human: 'Implement implementors(Class<?>, List<String>) with Class.forName, isAssignableFrom, isInterface and Modifier.isAbstract. Run ./gradlew :reflection-lab:test --tests "*ruleFinder*".',
      agent: 'In playground/reflection-lab, implement lab.RuleFinder.implementors so it returns sorted binary names of concrete classes assignable to the interface. Run ./gradlew :reflection-lab:test --tests "*ruleFinder*" until it passes. Then rename one rule class and show it is still found.',
      expected: rules,
    },
    {
      title: '3 · RecordingProxy',
      file: 'playground/reflection-lab/src/main/java/lab/RecordingProxy.java',
      goal: 'Wrap any interface in a proxy that logs calls and passes them through.',
      human: 'Implement record(Class<T>, T, List<String>) with Proxy.newProxyInstance and an InvocationHandler that logs, then method.invoke(target, args). Unwrap InvocationTargetException. Run ./gradlew :reflection-lab:test --tests "*recordingProxy*".',
      agent: 'In playground/reflection-lab, implement lab.RecordingProxy.record using java.lang.reflect.Proxy. Log "name(ArgSimpleClass, ...)" per call and delegate to the target, rethrowing the real cause of InvocationTargetException. Run ./gradlew :reflection-lab:test --tests "*recordingProxy*" until it passes, then ./gradlew :reflection-lab:run.',
      expected: [...log, `codes ${run.codes.join(', ')}`],
    },
  ];
}

function Scene({ beat, engineer }: SceneProps) {
  const list = useMemo(() => exercises(), []);
  const [mode, setMode] = useState<'human' | 'agent'>('human');
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, id: string): void => {
    void navigator.clipboard.writeText(text).then(() => { setCopied(id); });
  };
  const setup = 'git clone https://github.com/aniruddha-adhikary/learn-reflection\ncd learn-reflection/playground\n./gradlew :reflection-lab:test            # fails: starters say TODO\n./gradlew :reflection-lab:test -Plab=solution   # the reference answers pass';

  return (
    <div style={{ height: '100%', display: 'grid', gap: 14, alignContent: 'safe center' }}>
      {beat === 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 18 }}>
          <Panel title="Get the lab" color={AMBER}>
            <Code>{setup}</Code>
            <button className="pill" style={{ cursor: 'pointer', justifySelf: 'start' }} onClick={() => copy(setup, 'setup')}>{copied === 'setup' ? 'Copied' : 'Copy commands'}</button>
          </Panel>
          <Panel title="What you'll write" color={CYAN} delay={0.3}>
            {list.map((e) => <div key={e.title}><b>{e.title}</b> <span style={{ color: 'var(--muted)' }}>{e.goal}</span></div>)}
            <Note>Needs Java 17. Each exercise has a test that tells you when you&apos;re done, and this page shows the output it expects, computed live from the same classes.</Note>
          </Panel>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['human', 'agent'] as const).map((m) => (
              <button key={m} className={`pill ${m === mode ? 'ok' : ''}`} style={{ cursor: 'pointer' }} aria-pressed={m === mode} onClick={() => setMode(m)}>
                {m === 'human' ? 'Do it in VS Code' : 'Ask an AI agent'}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {list.map((e, i) => (
              <Panel key={e.title} title={e.title} color={[AMBER, GREEN, VIOLET][i] ?? CYAN} delay={0.15 * i}>
                <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', wordBreak: 'break-all' }}>{e.file}</div>
                <motion.div key={mode} initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ fontSize: 13, lineHeight: 1.5 }}>{mode === 'human' ? e.human : e.agent}</motion.div>
                <button className="pill" style={{ cursor: 'pointer', justifySelf: 'start' }} onClick={() => copy(mode === 'human' ? e.human : e.agent, `${e.title}-${mode}`)}>
                  {copied === `${e.title}-${mode}` ? 'Copied' : mode === 'human' ? 'Copy steps' : 'Copy prompt'}
                </button>
                <div className="kicker" style={{ color: GREEN, fontSize: 10 }}>Expected output</div>
                <pre className="mono" style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', color: '#e8ecff' }}>{e.expected.join('\n')}</pre>
              </Panel>
            ))}
          </div>
          {engineer && <Note>Stretch: point FieldDumper at modern.model.Applicant and compare the shapes, or wrap modern.services.CreditBureau in your RecordingProxy.</Note>}
        </>
      )}
    </div>
  );
}

export const labChapter: Chapter = {
  id: 'lab',
  title: 'Lab',
  subtitle: 'Write your own reflection tools',
  beats: [
    { caption: 'Clone the playground. Three small classes are waiting for you, each with a test.', ms: 0 },
    { caption: 'Your turn: pick VS Code or an AI agent. The expected output is computed live from the real classes.', ms: 0 },
  ],
  Scene,
};
