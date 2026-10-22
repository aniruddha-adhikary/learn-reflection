import { motion } from 'motion/react';
import type { Chapter, SceneProps } from '../../course/types';
import { AMBER, CYAN, GREEN, Note, RED, VIOLET } from './kit';

interface Row {
  readonly tool: string;
  readonly color: string;
  readonly sees: string;
  readonly changes: string;
  readonly when: string;
  readonly here: string;
  readonly guard: string;
}

const ROWS: readonly Row[] = [
  { tool: 'Reflection', color: AMBER, sees: 'Classes, fields, methods, types, modifiers', changes: 'Values: invoke, get, set; interface proxies', when: 'Run time, inside the JVM', here: 'Find every Rule, list fields, build applicants from CSV', guard: 'Names can lie: getIncome is monthly' },
  { tool: 'ASM: read', color: CYAN, sees: 'Every instruction in every method', changes: 'Nothing', when: 'Any time, from .class files', here: 'Rule inputs, thresholds, getIncome = annualIncome / 12, fuzz values', guard: 'Unknown instructions fail loudly' },
  { tool: 'ASM: write', color: VIOLET, sees: 'The same bytes', changes: 'Bytecode: swap where data comes from', when: 'Build or load time', here: 'Score from the bureau instead of the record', guard: 'Exact pattern only, stack effect checked, original vs rewritten compared' },
  { tool: 'ByteBuddy subclass', color: GREEN, sees: 'Calls on real objects', changes: 'Behaviour of a generated subclass', when: 'Run time', here: 'Record which getters each rule calls', guard: 'Cross-checked against what ASM read' },
  { tool: 'ByteBuddy agent', color: RED, sees: 'Live calls in a running system', changes: 'Adds advice to loaded classes', when: 'Run time, attached to the old system', here: 'Record production traffic, replay through LoanFlow', guard: 'Read-only advice; differences go to a person' },
  { tool: 'AI', color: '#e8ecff', sees: 'Facts the tools above produced', changes: 'Proposes old \u2192 new field bindings only', when: 'Once, offline', here: 'Map employment codes and fields', guard: 'Every binding checked against records and fuzz' },
];

const COLUMNS: readonly (keyof Omit<Row, 'tool' | 'color'>)[] = ['sees', 'changes', 'when', 'here', 'guard'];
const HEAD: Readonly<Record<(typeof COLUMNS)[number], string>> = { sees: 'Sees', changes: 'Can change', when: 'When', here: 'Used here for', guard: 'What keeps it honest' };

function Scene({ beat }: SceneProps) {
  const shown = beat === 0 ? 3 : ROWS.length;
  return (
    <div style={{ height: '100%', display: 'grid', gap: 12, alignContent: 'safe center' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '150px repeat(5, minmax(0, 1fr))', gap: 6, fontSize: 12 }}>
        <span />
        {COLUMNS.map((c) => <span key={c} className="kicker">{HEAD[c]}</span>)}
        {ROWS.slice(0, shown).map((r, i) => (
          <motion.div key={r.tool} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 * i }} style={{ display: 'contents' }}>
            <span style={{ color: r.color, fontWeight: 700, padding: 8, borderLeft: `3px solid ${r.color}` }}>{r.tool}</span>
            {COLUMNS.map((c) => <span key={c} style={{ padding: 8, background: '#121831', borderRadius: 6, lineHeight: 1.4 }}>{r[c]}</span>)}
          </motion.div>
        ))}
      </div>
      {beat >= 2 && <Note>Each tool hands the next one facts, and every step has a check that fails loudly. AI only does what none of the tools can derive, and even that is tested. That is how its surface for mistakes stays small.</Note>}
    </div>
  );
}

export const whichToolChapter: Chapter = {
  id: 'which-tool',
  title: 'Which tool when',
  subtitle: 'Reflection, ASM, ByteBuddy and AI, each in its lane',
  beats: [
    { caption: 'Reading: reflection lists what a class has, ASM reads what its methods do, and ASM can also rewrite them.', ms: 9000 },
    { caption: 'Watching: ByteBuddy wraps real objects and live systems. AI only proposes the bindings nothing else can derive.', ms: 9000 },
    { caption: 'Every row has a check. That is the whole method.', ms: 60000 },
  ],
  Scene,
};
