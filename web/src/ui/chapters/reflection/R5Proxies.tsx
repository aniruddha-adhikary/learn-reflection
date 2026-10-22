import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { Chapter, SceneProps } from '../../course/types';
import { classView, implementors, inert, proxyLab } from '../../../porter';
import { legacyCell, legacyRows } from '../../data/sample';
import { AMBER, CYAN, Code, GREEN, Note, Panel, RED, VIOLET, fmt, short } from './kit';

const RULE = 'legacy.engine.Rule';
const APP = 'A-1002';

const HANDLER = `Rule recorded = (Rule) Proxy.newProxyInstance(
    loader, new Class<?>[] { Rule.class },
    (proxy, method, args) -> {
      log.add(method.getName() + Arrays.toString(args));
      return method.invoke(realRule, args);   // pass through
    });`;

function CallPath({ rule }: { rule: string }) {
  const run = useMemo(() => proxyLab(rule, APP), [rule]);
  const event = run.events[0];
  if (!event) throw new Error(`proxyLab recorded no call for ${rule}`);
  const stops: readonly (readonly [string, string, string])[] = [
    ['RuleRunner', 'calls rule.execute(app, decision)', AMBER],
    ['Proxy', 'every interface call lands here', VIOLET],
    ['InvocationHandler', `logs ${event.method}(${event.args.map(fmt).join(', ')})`, VIOLET],
    [short(rule), 'the real rule, via method.invoke', AMBER],
    ['Decision', run.codes.length === 0 ? 'no codes' : run.codes.join(', '), GREEN],
  ];
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${String(stops.length)}, 1fr)`, gap: 12 }}>
        {stops.map(([title, text, color], i) => (
          <motion.div key={title} initial={{ opacity: 0.25 }} animate={{ opacity: 1, borderColor: color }} transition={{ delay: 0.7 * i }} style={{ border: '1px solid', borderRadius: 12, padding: 10, minHeight: 92, background: `${color}10` }}>
            <div className="mono" style={{ color, fontWeight: 600 }}>{title}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{text}</div>
          </motion.div>
        ))}
        <motion.div
          aria-hidden
          initial={{ left: '4%' }}
          animate={{ left: '92%' }}
          transition={{ duration: 0.7 * stops.length, ease: 'linear', repeat: Infinity, repeatDelay: 1 }}
          style={{ position: 'absolute', top: -10, width: 16, height: 16, borderRadius: 8, background: CYAN, boxShadow: `0 0 14px ${CYAN}` }}
        />
      </div>
      <Note>
        Same codes with and without the proxy: <span className="mono">{run.codes.join(', ') || '[]'}</span> ={' '}
        <span className="mono">{run.directCodes.join(', ') || '[]'}</span>. The rule never knew it was being watched.
      </Note>
    </div>
  );
}

function AllRules() {
  const [app, setApp] = useState(APP);
  const rules = useMemo(() => implementors(RULE), []);
  const runs = useMemo(() => rules.map((r) => proxyLab(short(r), app)), [rules, app]);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span className="kicker">Wrap all {String(rules.length)} rules, run applicant</span>
        <select value={app} onChange={(e) => setApp(e.target.value)} aria-label="Applicant" className="mono" style={{ padding: 4, background: '#0b1022', color: '#e8ecff', border: '1px solid #2a3358', borderRadius: 8 }}>
          {legacyRows.map((r) => <option key={legacyCell(r, 'APP_ID')} value={legacyCell(r, 'APP_ID')}>{legacyCell(r, 'APP_ID')}</option>)}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 1fr 60px', gap: '6px 10px', fontSize: 13 }}>
        {['rule', 'proxy log', 'codes through proxy', 'same?'].map((h) => <span key={h} className="kicker" style={{ fontSize: 10 }}>{h}</span>)}
        {runs.map((r, i) => {
          const same = r.codes.join() === r.directCodes.join();
          return (
            <motion.div key={`${app}-${r.rule}`} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.06 * i }} style={{ display: 'contents' }}>
              <span className="mono" style={{ color: AMBER }}>{r.rule}</span>
              <span className="mono" style={{ color: VIOLET }}>{r.events.map((e) => e.method).join(', ')}</span>
              <span className="mono">{r.codes.join(', ') || '—'}</span>
              <span style={{ color: same ? GREEN : RED }}>{same ? '✓' : '✗'}</span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function Tripwire({ engineer }: { engineer: boolean }) {
  const result = useMemo(() => inert(), []);
  const { lazy, prefetch } = result.data;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
      <Panel title="Lazy engine, tripwire on credit.score" color={lazy.status === 'PASS' ? GREEN : RED}>
        <div className={`pill ${lazy.status === 'PASS' ? 'ok' : 'bad'}`} style={{ justifySelf: 'start' }}>{lazy.status}</div>
        <Note>Only reads a metric when a rule needs it. Rules that don&apos;t need the bureau never touch it.</Note>
      </Panel>
      <Panel title="Prefetch engine, same tripwire" color={prefetch.status === 'PASS' ? GREEN : RED} delay={0.3}>
        <div className={`pill ${prefetch.status === 'PASS' ? 'ok' : 'bad'}`} style={{ justifySelf: 'start' }}>{prefetch.status}</div>
        <Note>{prefetch.message}</Note>
      </Panel>
      <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 6 }}>
        <Note>The same trick as a recorder, turned around: the proxy stands in for a <i>service</i> and throws if anyone calls it. That proves which calls happen without a real credit bureau.</Note>
        {engineer && <Code dim>{result.trace.join('\n')}</Code>}
      </div>
    </div>
  );
}

function Scene({ beat, engineer }: SceneProps) {
  const rule = useMemo(() => classView(RULE), []);
  return (
    <div style={{ height: '100%', display: 'grid', gap: 16, alignContent: 'safe center' }}>
      {beat === 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 18 }}>
          <Panel title={`interface ${short(RULE)}`} color={AMBER}>
            {rule.declaredMethods.map((m) => (
              <div key={m.name} className="mono" style={{ fontSize: 14 }}>{short(m.returnType)} {m.name}({m.parameterTypes.map(short).join(', ')})</div>
            ))}
            <Note>One method. Anything that implements it can stand in for a rule.</Note>
          </Panel>
          <Panel title="A recording stand-in, written once" color={VIOLET} delay={0.3}>
            <Code>{HANDLER}</Code>
          </Panel>
        </div>
      )}
      {beat === 1 && <CallPath rule="R01_MinimumScore" />}
      {beat === 2 && <AllRules />}
      {beat >= 3 && <Tripwire engineer={engineer} />}
    </div>
  );
}

export const proxiesChapter: Chapter = {
  id: 'proxies',
  title: 'Dynamic proxies',
  subtitle: 'Stand in for any interface',
  beats: [
    { caption: 'Proxy.newProxyInstance makes an object that implements an interface at run time. Every call goes to one handler.', ms: 7000 },
    { caption: 'Follow one call: the runner calls the proxy, the handler logs it, then passes it on to the real rule.', ms: 8000 },
    { caption: 'Your turn: wrap all 11 rules at once and run any applicant. Same answers, now with a log.', ms: 0 },
    { caption: 'Turn it around: a proxy for a service that trips if called. It proves the lazy engine leaves the credit bureau alone.', ms: 0 },
  ],
  Scene,
};
