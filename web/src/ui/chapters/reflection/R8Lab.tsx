import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { Chapter, SceneProps } from '../../course/types';
import { classView, getterRecorder, implementors, memberRefs, proxyLab, recordReplay, rewriteLab } from '../../../porter';
import { AMBER, CYAN, Code, GREEN, Note, Panel, RED, VIOLET, short, simpleName } from './kit';

interface Exercise {
  readonly title: string;
  readonly file: string;
  readonly goal: string;
  readonly human: string;
  readonly agent: string;
  readonly expected: readonly string[];
  readonly part: 'reflect' | 'bytes';
}

const TEST = (filter: string): string => `./gradlew :reflection-lab:test --tests "*${filter}*"`;

function exercises(): readonly Exercise[] {
  const fields = classView('legacy.model.Applicant').declaredFields.map((f) => `${f.modifiers.join(' ')} ${f.javaType} ${f.name}`);
  const rules = implementors('legacy.engine.Rule');
  const run = proxyLab('R01_MinimumScore', 'A-1002');
  const log = run.events.map((e) => `${e.method}(${e.args.map(simpleName).join(', ')})`);
  const r01Refs = memberRefs('legacy/rules/R01_MinimumScore').flatMap((m) => m.refs.map((r) => r.text));
  const r01 = rewriteLab().rewritten.find((r) => r.rule === 'R01_MinimumScore');
  const rewrittenCodes = r01?.applicants.find((a) => a.appId === 'A-1002')?.rewrittenCodes;
  if (!rewrittenCodes) throw new Error('rewriteLab has no R01 run for A-1002');
  const getters = getterRecorder().find((r) => r.rule === 'R01_MinimumScore');
  if (!getters) throw new Error('getterRecorder has no R01');
  const getterNames = getters.orderedGetters.filter((g) => g.owner === 'legacy/model/Applicant').map((g) => g.name);
  const traffic = recordReplay().applicants.map((a) => a.legacyThrown
    ? `${a.appId} ERROR ${short(a.legacyThrown.cls.replaceAll('/', '.'))}: …`
    : `${a.appId} [${a.codes.join(', ')}]`);
  return [
    {
      title: '1 · FieldDumper',
      file: 'playground/reflection-lab/src/main/java/lab/FieldDumper.java',
      goal: 'Print every declared field of a class: modifiers, type, name.',
      human: 'Open FieldDumper.java and implement dump(Class<?>) with getDeclaredFields(), Modifier.toString and getType().getTypeName(). Then run ./gradlew :reflection-lab:test --tests "*fieldDumper*" from playground/.',
      agent: 'In playground/reflection-lab, implement lab.FieldDumper.dump(Class<?>) using only java.lang.reflect. Run ./gradlew :reflection-lab:test --tests "*fieldDumper*" until it passes, and explain each reflection call you used. Do not edit the tests.',
      expected: fields,
      part: 'reflect',
    },
    {
      title: '2 · RuleFinder',
      file: 'playground/reflection-lab/src/main/java/lab/RuleFinder.java',
      goal: 'Find every concrete class that implements Rule, by type, not by name.',
      human: 'Implement implementors(Class<?>, List<String>) with Class.forName, isAssignableFrom, isInterface and Modifier.isAbstract. Run ./gradlew :reflection-lab:test --tests "*ruleFinder*".',
      agent: 'In playground/reflection-lab, implement lab.RuleFinder.implementors so it returns sorted binary names of concrete classes assignable to the interface. Run ./gradlew :reflection-lab:test --tests "*ruleFinder*" until it passes. Then rename one rule class and show it is still found.',
      expected: rules,
      part: 'reflect',
    },
    {
      title: '3 · RecordingProxy',
      file: 'playground/reflection-lab/src/main/java/lab/RecordingProxy.java',
      goal: 'Wrap any interface in a proxy that logs calls and passes them through.',
      human: 'Implement record(Class<T>, T, List<String>) with Proxy.newProxyInstance and an InvocationHandler that logs, then method.invoke(target, args). Unwrap InvocationTargetException. Run ./gradlew :reflection-lab:test --tests "*recordingProxy*".',
      agent: 'In playground/reflection-lab, implement lab.RecordingProxy.record using java.lang.reflect.Proxy. Log "name(ArgSimpleClass, ...)" per call and delegate to the target, rethrowing the real cause of InvocationTargetException. Run ./gradlew :reflection-lab:test --tests "*recordingProxy*" until it passes, then ./gradlew :reflection-lab:run.',
      expected: [...log, `codes ${run.codes.join(', ')}`],
      part: 'reflect',
    },
    {
      title: '4 · MemberRefs (ASM)',
      file: 'playground/reflection-lab/src/main/java/lab/MemberRefs.java',
      goal: 'List every field and method instruction in a class, in order.',
      human: `Implement of(byte[]) with new ClassReader(bytes).accept(classVisitor, 0). Return a MethodVisitor from visitMethod and record visitFieldInsn and visitMethodInsn as "OPCODE owner.name descriptor" (Printer.OPCODES gives the name). Run ${TEST('memberRefs')}.`,
      agent: `In playground/reflection-lab, implement lab.MemberRefs.of(byte[]) using ASM's ClassReader and visitor API only (no reflection, no javap). Output one line per field or method instruction: "OPCODE owner.name descriptor". Run ${TEST('memberRefs')} until it passes. Then explain which of R01's references reflection could not have told you.`,
      expected: r01Refs,
      part: 'bytes',
    },
    {
      title: '5 · ScoreRewriter (ASM)',
      file: 'playground/reflection-lab/src/main/java/lab/ScoreRewriter.java',
      goal: 'Rewrite R01 so its score comes from the bureau bridge.',
      human: `Implement rewrite(byte[]) with ClassReader → ClassWriter(COMPUTE_MAXS). In your MethodVisitor, hold back INVOKEVIRTUAL getApplicant; if the next call is getCredScr, emit INVOKESTATIC lab/bridge/CreditScores.creditScore(Llegacy/model/LoanApplication;)I instead of both. Otherwise replay what you held back. Run ${TEST('scoreRewriter')}.`,
      agent: `In playground/reflection-lab, implement lab.ScoreRewriter.rewrite(byte[]) with ASM ClassReader/ClassWriter so the adjacent pair LoanApplication.getApplicant() + Applicant.getCredScr() becomes one INVOKESTATIC lab/bridge/CreditScores.creditScore(LoanApplication). Leave every other instruction untouched and throw if the pair is not found. Run ${TEST('scoreRewriter')} until it passes, and show the before/after with javap -c.`,
      expected: rewrittenCodes,
      part: 'bytes',
    },
    {
      title: '6 · GetterRecorder (ByteBuddy)',
      file: 'playground/reflection-lab/src/main/java/lab/GetterRecorder.java',
      goal: 'Subclass a real class at run time and log every getter call.',
      human: `Implement record(Class<T>, List<String>) with new ByteBuddy().subclass(type).method(nameStartsWith("get")).intercept(MethodDelegation.to(...)). Log the method name, then call @SuperCall. Run ${TEST('getterRecorder')}.`,
      agent: `In playground/reflection-lab, implement lab.GetterRecorder.record using ByteBuddy to create a subclass of the given class whose getters log their name and delegate to super. Run ${TEST('getterRecorder')} until it passes. Then explain why java.lang.reflect.Proxy cannot do this for legacy.model.Applicant.`,
      expected: getterNames,
      part: 'bytes',
    },
    {
      title: '7 · TrafficAgent (ByteBuddy)',
      file: 'playground/reflection-lab/src/main/java/lab/TrafficAgent.java',
      goal: 'Attach to the running engine and record every decision.',
      human: `Implement install(Instrumentation) with AgentBuilder: disableClassFormatChanges(), RETRANSFORMATION, type(named("legacy.engine.RuleRunner")), and Advice with @OnMethodExit(onThrowable = Throwable.class) writing to TrafficLog. Run ${TEST('trafficAgent')}.`,
      agent: `In playground/reflection-lab, implement lab.TrafficAgent.install(Instrumentation) with ByteBuddy AgentBuilder and Advice on legacy.engine.RuleRunner.run, recording appId, codes, referrals and any thrown exception to lab.TrafficLog. Fail loudly if the transformation errors. Run ${TEST('trafficAgent')} until it passes, then ./gradlew :reflection-lab:run.`,
      expected: [...traffic, '(Java also prints each exception message after the colon)'],
      part: 'bytes',
    },
  ];
}

function Scene({ beat, engineer }: SceneProps) {
  const list = useMemo(() => exercises(), []);
  const [mode, setMode] = useState<'human' | 'agent'>('human');
  const [part, setPart] = useState<'reflect' | 'bytes'>('reflect');
  const visible = list.filter((e) => e.part === part);
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(['reflect', 'bytes'] as const).map((p) => (
              <button key={p} className={`pill ${p === part ? 'ok' : ''}`} style={{ cursor: 'pointer' }} aria-pressed={p === part} onClick={() => setPart(p)}>
                {p === 'reflect' ? 'Reflection (1–3)' : 'ASM & ByteBuddy (4–7)'}
              </button>
            ))}
            <span style={{ width: 16 }} />
            {(['human', 'agent'] as const).map((m) => (
              <button key={m} className={`pill ${m === mode ? 'ok' : ''}`} style={{ cursor: 'pointer' }} aria-pressed={m === mode} onClick={() => setMode(m)}>
                {m === 'human' ? 'Do it in VS Code' : 'Ask an AI agent'}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${String(visible.length)}, minmax(0, 1fr))`, gap: 14 }}>
            {visible.map((e, i) => (
              <Panel key={e.title} title={e.title} color={[AMBER, GREEN, VIOLET, RED][i] ?? CYAN} delay={0.15 * i}>
                <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', wordBreak: 'break-all' }}>{e.file}</div>
                <motion.div key={mode} initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ fontSize: 13, lineHeight: 1.5 }}>{mode === 'human' ? e.human : e.agent}</motion.div>
                <button className="pill" style={{ cursor: 'pointer', justifySelf: 'start' }} onClick={() => copy(mode === 'human' ? e.human : e.agent, `${e.title}-${mode}`)}>
                  {copied === `${e.title}-${mode}` ? 'Copied' : mode === 'human' ? 'Copy steps' : 'Copy prompt'}
                </button>
                <div className="kicker" style={{ color: GREEN, fontSize: 10 }}>Expected output</div>
                <pre className="mono" style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#e8ecff', maxHeight: 220, overflow: 'auto' }}>{e.expected.join('\n')}</pre>
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
  subtitle: 'Write your own reflection, ASM and ByteBuddy tools',
  beats: [
    { caption: 'Clone the playground. Seven small classes are waiting for you, each with a test.', ms: 60000 },
    { caption: 'Your turn: pick VS Code or an AI agent. The expected output is computed live from the real classes.', ms: 60000 },
  ],
  Scene,
};
