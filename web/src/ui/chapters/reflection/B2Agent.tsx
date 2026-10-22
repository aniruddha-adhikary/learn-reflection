import { useMemo } from 'react';
import { motion } from 'motion/react';
import type { Chapter, SceneProps } from '../../course/types';
import { recordReplay, type RecordedApplicant } from '../../../porter';
import { AMBER, CYAN, Code, GREEN, Note, Panel, RED, VIOLET, short } from './kit';

function legacyText(a: RecordedApplicant): string {
  if (a.legacyThrown) return `crash: ${short(a.legacyThrown.cls.replaceAll('/', '.'))}`;
  return `[${a.codes.join(', ')}]`;
}

function modernText(a: RecordedApplicant): string {
  return a.modernError ? `error: ${a.modernError}` : `[${a.modernCodes.join(', ')}]`;
}

function Tap({ applicants }: { applicants: readonly RecordedApplicant[] }) {
  const stops = ['nightly CSV', 'BatchRunner', 'RuleRunner.run', 'results CSV'];
  return (
    <Panel title="The running LoanDesk batch, unchanged, with an agent attached" color={AMBER}>
      <div style={{ position: 'relative', height: 220 }}>
        {stops.map((s, i) => (
          <div key={s} className="mono" style={{ position: 'absolute', left: `${String(4 + i * 24)}%`, top: 30, width: '18%', padding: 10, borderRadius: 10, textAlign: 'center', fontSize: 12, border: `1px solid ${i === 2 ? VIOLET : '#2a3358'}` }}>{s}</div>
        ))}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }} className="mono" style={{ position: 'absolute', left: '52%', top: 110, width: '18%', padding: 8, borderRadius: 10, textAlign: 'center', fontSize: 12, border: `1px dashed ${VIOLET}`, color: VIOLET }}>@Advice.OnMethodExit</motion.div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} className="mono" style={{ position: 'absolute', left: '52%', top: 170, width: '42%', padding: 8, borderRadius: 10, fontSize: 12, border: `1px solid ${CYAN}`, color: CYAN }}>traffic log: {String(applicants.length)} real decisions</motion.div>
        {applicants.map((a, i) => (
          <motion.div key={a.appId} initial={{ left: '4%', opacity: 0 }} animate={{ left: ['4%', '28%', '52%', '76%'], opacity: [0, 1, 1, 0] }} transition={{ delay: 1.5 + 0.45 * i, duration: 2.4 }} className="mono" style={{ position: 'absolute', top: 0, fontSize: 11, color: a.legacyThrown ? RED : AMBER }}>{a.appId}</motion.div>
        ))}
      </div>
    </Panel>
  );
}

function Rows({ applicants, replay }: { applicants: readonly RecordedApplicant[]; replay: boolean }) {
  return (
    <Panel title={replay ? 'Replay the recorded traffic through LoanFlow' : 'What the agent captured'} color={replay ? CYAN : AMBER}>
      <div style={{ display: 'grid', gridTemplateColumns: replay ? '70px minmax(0, 1fr) minmax(0, 1fr) 60px' : '70px minmax(0, 1fr)', gap: '4px 10px', fontSize: 12 }} className="mono">
        <span className="kicker">app</span><span className="kicker" style={{ color: AMBER }}>LoanDesk (recorded)</span>
        {replay && <><span className="kicker" style={{ color: CYAN }}>LoanFlow (replayed)</span><span className="kicker">same?</span></>}
        {applicants.map((a, i) => (
          <motion.div key={a.appId} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.12 * i }} style={{ display: 'contents' }}>
            <span>{a.appId}</span>
            <span style={{ color: a.legacyThrown ? RED : '#e8ecff' }}>{legacyText(a)}</span>
            {replay && <><span style={{ color: '#e8ecff' }}>{modernText(a)}</span><span style={{ color: a.agree ? GREEN : RED }}>{a.agree ? 'yes' : 'no'}</span></>}
          </motion.div>
        ))}
      </div>
    </Panel>
  );
}

function Scene({ beat, engineer }: SceneProps) {
  const result = useMemo(() => recordReplay(), []);
  const crashes = result.applicants.filter((a) => a.legacyThrown);
  return (
    <div style={{ height: '100%', display: 'grid', gap: 12, alignContent: 'safe center' }}>
      {beat === 0 && <Tap applicants={result.applicants} />}
      {beat >= 1 && <Rows applicants={result.applicants} replay={beat >= 2} />}
      {beat >= 3 && (
        <Note>
          {String(result.agreeCount)} of {String(result.applicants.length)} agree.{' '}
          {crashes.length > 0 && (
            <>
              Real traffic includes applications the old system crashes on:{' '}
              {crashes.map((a) => `${a.appId} (${short(a.legacyThrown?.cls.replaceAll('/', '.') ?? '')}: ${a.legacyThrown?.message ?? ''})`).join(', ')}.{' '}
              {crashes.every((a) => a.agree)
                ? 'LoanFlow fails the same way, so the port is faithful, bugs included. Fixing them is a business decision for a person, now with the exact inputs in hand.'
                : 'LoanFlow does not fail the same way on all of them. Each difference goes to a person with the recorded input attached.'}{' '}
            </>
          )}
          The fuzzer only tests inputs it can think of; recorded traffic adds the ones production actually sent.
        </Note>
      )}
      {engineer && (
        <Code>{`new AgentBuilder.Default()
  .disableClassFormatChanges()
  .with(RedefinitionStrategy.RETRANSFORMATION)        // RuleRunner is already loaded
  .type(named("legacy.engine.RuleRunner"))
  .transform((b, type, loader, module, pd) ->
      b.visit(Advice.to(RuleRunnerAdvice.class).on(named("run").and(isStatic()))))
  .installOn(instrumentation);                        // -javaagent: or ByteBuddyAgent.install()`}</Code>
      )}
    </div>
  );
}

export const bbAgentChapter: Chapter = {
  id: 'bb-agent',
  title: 'ByteBuddy agent: record real traffic',
  subtitle: 'Watch the live legacy system without changing it, then replay',
  beats: [
    { caption: 'A Java agent attaches to the running batch and adds a few lines of advice to RuleRunner.run. No source change, no redeploy of the old code.', ms: 10000 },
    { caption: 'Every application and the decision the old system made is captured.', ms: 9000 },
    { caption: 'Replay the same applications through LoanFlow and compare, one by one.', ms: 60000 },
    { caption: 'Same answers, including the crashes. Anything that differs, or any crash worth fixing, goes to a person.', ms: 60000 },
  ],
  Scene,
};
