import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { Chapter, SceneProps } from '../../course/types';
import { implementors, memberRefs, visitEvents, type VisitEvent } from '../../../porter';
import { instructionOperand } from '../../../porter/instruction-format';
import { AMBER, CYAN, Code, GREEN, Note, Panel, VIOLET, short } from './kit';

const START = 'legacy/rules/R01_MinimumScore';

function eventLine(event: VisitEvent): { call: string; args: string; color: string } {
  switch (event.type) {
    case 'visit':
      return { call: 'visit', args: `${event.name} extends ${event.superName ?? '-'} implements ${event.interfaces.join(', ')}`, color: CYAN };
    case 'visitSource':
      return { call: 'visitSource', args: event.source, color: 'var(--muted)' };
    case 'visitField':
      return { call: 'visitField', args: `${event.name} ${event.descriptor}`, color: AMBER };
    case 'visitMethod':
      return { call: 'visitMethod', args: `${event.name}${event.descriptor}`, color: CYAN };
    case 'visitCode':
      return { call: 'visitCode', args: '', color: 'var(--muted)' };
    case 'visitMaxs':
      return { call: 'visitMaxs', args: `stack=${event.maxStack} locals=${event.maxLocals}`, color: 'var(--muted)' };
    case 'visitEnd':
      return { call: 'visitEnd', args: '', color: 'var(--muted)' };
    default: {
      const ins = event.instruction;
      const fieldOrMethod = event.type === 'visitFieldInsn' || event.type === 'visitMethodInsn';
      return { call: event.type, args: `${ins.mnemonic.toUpperCase()} ${instructionOperand(ins.operands)}`, color: fieldOrMethod ? GREEN : VIOLET };
    }
  }
}

function Stream({ className }: { className: string }) {
  const events = useMemo(() => visitEvents(className).map(eventLine), [className]);
  return (
    <Panel title={`ClassReader.accept(visitor) · ${short(className.replaceAll('/', '.'))}`} color={CYAN}>
      <div style={{ display: 'grid', gap: 3, maxHeight: 360, overflow: 'auto' }}>
        {events.map((e, i) => (
          <motion.div key={`${className}-${String(i)}`} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.08 * i }} className="mono" style={{ display: 'grid', gridTemplateColumns: '150px minmax(0, 1fr)', fontSize: 12 }}>
            <span style={{ color: e.color }}>{e.call}</span>
            <span style={{ color: '#e8ecff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.args}</span>
          </motion.div>
        ))}
      </div>
    </Panel>
  );
}

function Refs({ className }: { className: string }) {
  const methods = useMemo(() => memberRefs(className).filter((m) => m.refs.length > 0), [className]);
  let n = 0;
  return (
    <Panel title="Your MethodVisitor keeps only field and method instructions" color={GREEN} delay={0.2}>
      {methods.map((m) => (
        <div key={m.method} style={{ display: 'grid', gap: 4 }}>
          <span className="kicker" style={{ fontSize: 10 }}>{m.method}</span>
          {m.refs.map((r) => {
            n += 1;
            return (
              <motion.div key={`${m.method}-${r.text}-${String(n)}`} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.25 * n }} className="mono" style={{ fontSize: 12, padding: '4px 8px', borderRadius: 8, background: r.owner.startsWith('legacy/model/') ? '#3a2c0c' : '#151b33' }}>
                <span style={{ color: VIOLET }}>{r.opcode}</span>{' '}
                <span style={{ color: r.owner.startsWith('legacy/') ? AMBER : 'var(--muted)' }}>{short(r.owner.replaceAll('/', '.'))}</span>.
                <span style={{ color: '#e8ecff' }}>{r.name}</span> <span style={{ color: 'var(--muted)' }}>{r.descriptor}</span>
              </motion.div>
            );
          })}
        </div>
      ))}
    </Panel>
  );
}

function Scene({ beat, engineer }: SceneProps) {
  const rules = useMemo(() => implementors('legacy.engine.Rule').map((name) => name.replaceAll('.', '/')), []);
  const [picked, setPicked] = useState(START);
  const className = beat >= 2 ? picked : START;
  return (
    <div style={{ height: '100%', display: 'grid', gap: 12, alignContent: 'safe center' }}>
      {beat >= 2 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {rules.map((r) => (
            <button key={r} className={`pill ${r === picked ? 'ok' : ''}`} style={{ cursor: 'pointer', fontSize: 12 }} aria-pressed={r === picked} onClick={() => setPicked(r)}>
              {short(r.replaceAll('/', '.'))}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: beat >= 1 ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)', gap: 14 }}>
        <Stream key={`stream-${className}`} className={className} />
        {beat >= 1 && <Refs key={`refs-${className}`} className={className} />}
      </div>
      {engineer && (
        <Code>{`new ClassReader(bytes).accept(new ClassVisitor(ASM9) {
  public MethodVisitor visitMethod(int acc, String name, String desc, String sig, String[] ex) {
    return new MethodVisitor(ASM9) {
      public void visitMethodInsn(int op, String owner, String n, String d, boolean itf) { refs.add(...); }
      public void visitFieldInsn(int op, String owner, String n, String d) { refs.add(...); }
    };
  }
}, 0);`}</Code>
      )}
      {beat >= 3 && (
        <Note>Two ways to hold the same bytes: the visitor API streams events like these once, fast and in order. The tree API (ClassNode, MethodNode) keeps them in memory so an Analyzer can walk every path and track where each stack value came from, which is how the porter found getIncome = annualIncome / 12.</Note>
      )}
    </div>
  );
}

export const asmReadChapter: Chapter = {
  id: 'asm-read',
  title: 'ASM: read what the code does',
  subtitle: 'ClassReader, visitors, and the instructions inside a method',
  beats: [
    { caption: 'ASM\u2019s ClassReader walks a .class file and calls your visitor once per piece: the class, each field, each method, then every instruction.', ms: 9000 },
    { caption: 'Keep only the field and method instructions and you get the rule\u2019s real inputs: which getters it calls, in order. Reflection can\u2019t see any of this.', ms: 9000 },
    { caption: 'Pick any rule. The stream and the inputs are read live from its bytecode.', ms: 60000 },
    { caption: 'Visitor for one fast pass, tree plus Analyzer when you need to follow values. Both read the same bytes.', ms: 60000 },
  ],
  Scene,
};
