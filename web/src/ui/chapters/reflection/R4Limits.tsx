import { useMemo } from 'react';
import { motion } from 'motion/react';
import type { Chapter, SceneProps } from '../../course/types';
import { classView, getterFlows, invokeLab, type GetterFlow } from '../../../porter';
import { AMBER, CYAN, Code, GREEN, Note, Panel, RED, VIOLET, fmt, short } from './kit';

const OWNER = 'legacy.model.Applicant';

function ownerName(flow: GetterFlow): string {
  return flow.owner.replaceAll('/', '.');
}

function Instructions({ flow }: { flow: GetterFlow }) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {flow.instructions.map((ins, i) => (
        <motion.div key={ins.offset} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.35 * i }} className="mono" style={{ display: 'grid', gridTemplateColumns: '34px 110px 1fr', fontSize: 14 }}>
          <span style={{ color: 'var(--muted)' }}>{String(ins.offset)}</span>
          <span style={{ color: ins.mnemonic === 'IDIV' ? RED : VIOLET }}>{ins.mnemonic}</span>
          <span style={{ color: ins.mnemonic === 'GETFIELD' ? AMBER : '#e8ecff' }}>{ins.operand}</span>
        </motion.div>
      ))}
    </div>
  );
}

function Scene({ beat, engineer }: SceneProps) {
  const view = useMemo(() => classView(OWNER), []);
  const flows = useMemo(() => getterFlows().filter((f) => ownerName(f) === OWNER), []);
  const calls = useMemo(() => invokeLab('A-1002'), []);
  const income = flows.find((f) => f.method === 'getIncome');
  if (!income) throw new Error('getterFlows has no Applicant.getIncome');
  const signature = view.declaredMethods.find((m) => m.name === 'getIncome');
  if (!signature) throw new Error('Applicant has no getIncome');
  const monthly = calls[5]?.outcome.ok ? fmt(calls[5].outcome.value) : '?';
  const annual = calls[6]?.outcome.ok ? fmt(calls[6].outcome.value) : '?';

  if (beat >= 3) {
    return (
      <div style={{ height: '100%', display: 'grid', gap: 10, alignContent: 'safe center' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 1fr', gap: 10 }}>
          <span className="kicker">getter</span>
          <span className="kicker" style={{ color: CYAN }}>Reflection: what&apos;s there</span>
          <span className="kicker" style={{ color: GREEN }}>Bytecode: what it does</span>
          {flows.map((f, i) => {
            const m = view.declaredMethods.find((d) => d.name === f.method);
            if (!m) throw new Error(`No reflected method ${f.method}`);
            const divides = f.instructions.some((ins) => ins.mnemonic === 'IDIV');
            return (
              <motion.div key={f.method} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 * i }} style={{ display: 'contents' }}>
                <span className="mono" style={{ color: divides ? RED : '#e8ecff' }}>{f.method}()</span>
                <span className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>{m.modifiers.join(' ')} {short(m.returnType)} {m.name}()</span>
                <span className="mono" style={{ fontSize: 13 }}>
                  reads <b style={{ color: AMBER }}>{f.fieldsRead.join(', ')}</b>
                  {divides ? <b style={{ color: RED }}> then divides</b> : ''}
                  {engineer ? <span style={{ color: 'var(--muted)' }}> · {f.instructions.map((ins) => ins.mnemonic).join(' ')}</span> : ''}
                </span>
              </motion.div>
            );
          })}
        </div>
        <Note>You need both. Reflection gives you the inventory; bytecode gives you the behaviour. The course&apos;s porter uses reflection to find things and ASM-style bytecode reading to understand them.</Note>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignContent: 'safe center' }}>
      <Panel title="What reflection sees" color={CYAN}>
        <Code>{`Method m = c.getMethod("getIncome");\n${signature.modifiers.join(' ')} ${short(signature.returnType)} getIncome()`}</Code>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mono" style={{ border: '2px dashed #2a3358', borderRadius: 10, padding: 18, textAlign: 'center', color: 'var(--muted)', fontSize: 22 }}>
          {'{ ? }'}
        </motion.div>
        <Note>Name, modifiers, return type, parameters. The body is a closed box.</Note>
        {beat >= 1 && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ display: 'grid', gap: 6 }}>
            <Code>{`m.invoke(applicant)          → ${monthly}\nannualIncome (private field) → ${annual}`}</Code>
            <Note>You could guess &quot;divide by 12&quot; from one sample. That&apos;s a guess, and guesses are what we&apos;re trying to remove.</Note>
          </motion.div>
        )}
      </Panel>
      {beat >= 2 ? (
        <Panel title="What the bytecode says" color={GREEN} delay={0.2}>
          <Code dim>{'ClassReader → MethodNode getIncome()I'}</Code>
          <Instructions flow={income} />
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 * income.instructions.length + 0.2 }} className="mono" style={{ fontSize: 18, color: '#e8ecff' }}>
            = <span style={{ color: AMBER }}>{income.fieldsRead.join(', ')}</span> <span style={{ color: RED }}>/ 12</span>
          </motion.div>
        </Panel>
      ) : (
        <div style={{ display: 'grid', placeItems: 'center', color: 'var(--muted)', border: '1px dashed #2a3358', borderRadius: 14 }}>
          <span style={{ color: VIOLET }}>reflection stops here</span>
        </div>
      )}
    </div>
  );
}

export const limitsChapter: Chapter = {
  id: 'limits',
  title: 'Where reflection stops',
  subtitle: 'Names and signatures, not behaviour',
  beats: [
    { caption: 'Reflection tells you getIncome exists and returns an int. What it does inside is invisible.', ms: 6000 },
    { caption: 'Calling it gives a number, not a reason. One sample can’t prove a rule.', ms: 6000 },
    { caption: 'Read the bytecode instead: load the field, push 12, divide. Now it’s a fact, not a guess.', ms: 8000 },
    { caption: 'Every getter, both views side by side. Reflection finds, bytecode explains.', ms: 0 },
  ],
  Scene,
};
