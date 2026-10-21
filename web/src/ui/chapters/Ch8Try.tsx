import { useState } from 'react';
import { motion } from 'motion/react';
import type { Chapter, SceneProps } from '../course/types';

interface Line {
  readonly cmd?: string;
  readonly out?: string;
  readonly tone?: 'ok' | 'bad' | 'muted';
}

const CLONE: readonly Line[] = [
  { cmd: 'git clone https://github.com/aniruddha-adhikary/learn-reflection.git' },
  { out: "Cloning into 'learn-reflection'… done.", tone: 'muted' },
  { cmd: 'cd learn-reflection/playground' },
  { cmd: 'java -version' },
  { out: 'openjdk version "17" (any JDK 17+ works)', tone: 'muted' },
];

const RUN: readonly Line[] = [
  { cmd: './gradlew :legacy:run' },
  { out: 'old system: read 12 applications from the nightly CSV, wrote 12 decisions', tone: 'muted' },
  { cmd: './gradlew :porter:run --args=all' },
  { out: 'facts      read the old code: fields, getters, rules', tone: 'muted' },
  { out: 'transform  10 old rules → 12 filled-in templates, 1 odd one out', tone: 'muted' },
  { out: 'gate       every AI-proposed link has evidence ✓', tone: 'ok' },
  { out: 'fuzz       old vs new agree on every generated case ✓', tone: 'ok' },
];

function Terminal({ lines }: { lines: readonly Line[] }) {
  return (
    <div className="panel mono" style={{ fontSize: 13, lineHeight: 1.7, minHeight: 230, background: '#060a1c' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {['#f87171', '#f5a524', '#34d399'].map((c) => (
          <span key={c} style={{ width: 10, height: 10, borderRadius: 5, background: c }} />
        ))}
      </div>
      {lines.map((l, i) => (
        <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.7 }}>
          {l.cmd !== undefined ? (
            <span>
              <span style={{ color: 'var(--modern)' }}>$ </span>
              <motion.span
                style={{ display: 'inline-block', overflow: 'hidden', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}
                initial={{ maxWidth: 0 }}
                animate={{ maxWidth: 900 }}
                transition={{ delay: i * 0.7, duration: 0.6, ease: 'linear' }}
              >
                {l.cmd}
              </motion.span>
            </span>
          ) : (
            <span style={{ color: l.tone === 'ok' ? 'var(--ok)' : l.tone === 'bad' ? 'var(--bad)' : 'var(--muted)' }}>{l.out}</span>
          )}
        </motion.div>
      ))}
    </div>
  );
}

interface Exercise {
  readonly title: string;
  readonly what: string;
  readonly human: string;
  readonly agent: string;
}

const EXERCISES: readonly Exercise[] = [
  {
    title: 'Catch the AI making a mistake',
    what: 'Swap in a set of AI suggestions that contains one wrong link, and watch the checks stop it.',
    human: 'Open playground/data/bindings.ai-mistake.json next to bindings.ai.json and spot the difference. Copy the mistake file over bindings.ai.json, then run ./gradlew :porter:run --args=gate and --args=fuzz.',
    agent: 'In playground/, replace data/bindings.ai.json with data/bindings.ai-mistake.json. Run ./gradlew :porter:run --args=gate and ./gradlew :porter:run --args=fuzz. Explain in plain words which link was wrong and how each check caught it. Then restore the original file with git checkout.',
  },
  {
    title: 'Rename something in the old system',
    what: 'Change a field name in the old code. Nothing that reads the compiled code needs updating.',
    human: 'Rename a field in playground/legacy (for example the credit score field) using your editor’s rename. Run ./gradlew :porter:run --args=facts and compare the output with the run before the rename.',
    agent: 'In playground/legacy, rename the credit score field and its getter consistently. Run ./gradlew :porter:run --args=facts before and after, and show me which facts changed and which links had to be re-confirmed.',
  },
  {
    title: 'Add a new rule that fits a template',
    what: 'Write one more “score below X → decline” style rule and see it drop into an existing template.',
    human: 'Copy one of the legacy rule classes, change its threshold, register it in the rule set, then run ./gradlew :porter:run --args=transform.',
    agent: 'Add a legacy rule R12 that behaves like R01 with a threshold of 600, register it in the rule set, then run ./gradlew :porter:run --args=all. Show me the template it was filled into and the fuzz result.',
  },
  {
    title: 'Write an odd one out',
    what: 'Write a rule that fits no template and watch it get reported for a human, not guessed.',
    human: 'Add a rule that does something unusual, like looking at the day of the week. Run --args=transform and read the finding it reports.',
    agent: 'Add a legacy rule that does not fit any existing template. Run ./gradlew :porter:run --args=transform and explain the finding. Do not change the porter to make it pass.',
  },
];

function Exercises({ engineer }: { engineer: boolean }) {
  const [sel, setSel] = useState(0);
  const [mode, setMode] = useState<'human' | 'agent'>('human');
  const [copied, setCopied] = useState(false);
  const ex = EXERCISES[sel];
  if (ex === undefined) throw new Error('No exercise selected');
  const text = mode === 'human' ? ex.human : ex.agent;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20, height: '100%' }}>
      <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
        {EXERCISES.map((e, i) => (
          <button key={e.title} className="panel" aria-pressed={i === sel} onClick={() => setSel(i)} style={{ textAlign: 'left', cursor: 'pointer', borderColor: i === sel ? 'var(--modern)' : undefined }}>
            <div style={{ fontWeight: 650 }}>
              {i + 1}. {e.title}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{e.what}</div>
          </button>
        ))}
      </div>
      <div className="panel" style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
        <div className="mode-toggle" role="group" aria-label="How you will play">
          <button aria-pressed={mode === 'human'} onClick={() => setMode('human')}>
            I’ll do it in VS Code
          </button>
          <button aria-pressed={mode === 'agent'} onClick={() => setMode('agent')}>
            Ask an AI agent
          </button>
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.6 }}>{ex.what}</div>
        <motion.pre key={`${String(sel)}-${mode}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mono" style={{ whiteSpace: 'pre-wrap', background: '#060a1c', padding: 14, borderRadius: 10, fontSize: 13, lineHeight: 1.6, margin: 0 }}>
          {text}
        </motion.pre>
        <div>
          <button
            className="chip-btn"
            onClick={() => {
              void navigator.clipboard.writeText(text).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? 'Copied ✓' : mode === 'agent' ? 'Copy prompt' : 'Copy steps'}
          </button>
        </div>
        {engineer && mode === 'agent' && (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            The prompts keep the agent’s job small and checkable: it edits code and runs the deterministic checks. It never gets to decide if the result is correct.
          </div>
        )}
      </div>
    </motion.div>
  );
}

function Scene({ beat, engineer }: SceneProps) {
  if (beat >= 2) return <Exercises engineer={engineer} />;
  return (
    <div style={{ display: 'grid', alignContent: 'center', height: '100%', maxWidth: 900 }}>
      <Terminal key={beat} lines={beat === 0 ? CLONE : RUN} />
    </div>
  );
}

export const tryChapter: Chapter = {
  id: 'try',
  title: 'Try it yourself',
  subtitle: 'Run both systems on your laptop',
  beats: [
    { caption: 'Everything in this course is real code. Copy it to your machine: you only need git and Java 17.', detail: 'The same playground/ folder that built the data in this course.', ms: 6000 },
    { caption: 'Run the old system, then the full check: read the old code, fill in the templates, and compare old and new.', detail: 'porter uses the real java.lang.reflect, ASM and ArchUnit on the JVM.', ms: 8000 },
    { caption: 'Pick an exercise. Do it yourself in VS Code, or copy the prompt and give it to an AI agent.', detail: 'Works with Claude Code, Codex, Devin or any agent that can run a shell.', ms: 60000 },
  ],
  Scene,
};
