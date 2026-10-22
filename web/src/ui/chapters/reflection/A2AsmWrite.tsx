import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { Chapter, SceneProps } from '../../course/types';
import { badTargetDescriptorMessage, memberRefs, rewriteLab, type RewriteApplicantResult } from '../../../porter';
import { AMBER, CYAN, Code, GREEN, Note, Panel, RED, VIOLET } from './kit';

const SHOWN = 'R01_MinimumScore';

function Patch({ before, after }: { before: readonly string[]; after: readonly string[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 60px minmax(0, 1fr)', gap: 10, alignItems: 'center' }}>
      <Panel title="Before: the rule reads the old field" color={AMBER}>
        {before.map((line, i) => (
          <motion.div key={line} initial={{ opacity: 1 }} animate={{ opacity: 0.45, textDecoration: 'line-through' }} transition={{ delay: 1.2 + 0.3 * i }} className="mono" style={{ fontSize: 12, color: RED }}>{line}</motion.div>
        ))}
      </Panel>
      <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.8 }} style={{ fontSize: 30, color: VIOLET, textAlign: 'center' }}>{'\u2192'}</motion.div>
      <Panel title="After: it asks the credit bureau" color={GREEN} delay={2}>
        {after.map((line, i) => (
          <motion.div key={`${line}-${String(i)}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.2 + 0.25 * i }} className="mono" style={{ fontSize: 12, color: line === 'NOP' ? 'var(--muted)' : GREEN }}>{line}</motion.div>
        ))}
      </Panel>
    </div>
  );
}

function CallPath({ runs }: { runs: readonly RewriteApplicantResult[] }) {
  const calls = runs.flatMap((r) => r.bridgeCalls);
  const stops = ['R01 (rewritten)', 'CreditScores.creditScore(app)', 'CreditBureau.scoreFor(id)', 'score'];
  return (
    <Panel title="Every score now comes through the bridge" color={CYAN}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
        {stops.map((s, i) => <motion.div key={s} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 * i }} className="mono" style={{ fontSize: 12, padding: 8, borderRadius: 8, border: `1px solid ${[AMBER, VIOLET, CYAN, GREEN][i] ?? CYAN}`, textAlign: 'center' }}>{s}</motion.div>)}
      </div>
      <div style={{ display: 'grid', gap: 3, maxHeight: 260, overflow: 'auto' }}>
        {calls.map((c, i) => (
          <motion.div key={c.appId} initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.2 + 0.18 * i }} className="mono" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, fontSize: 12 }}>
            <span style={{ color: AMBER }}>{c.appId}</span>
            <span style={{ color: 'var(--muted)' }}>getAppId() = {c.appId}</span>
            <span style={{ color: CYAN }}>{c.applicantId}</span>
            <span style={{ color: GREEN }}>{String(c.score)}</span>
          </motion.div>
        ))}
      </div>
    </Panel>
  );
}

function Scene({ beat, engineer }: SceneProps) {
  const lab = useMemo(() => rewriteLab(), []);
  const rejection = useMemo(() => badTargetDescriptorMessage(), []);
  const shown = lab.rewritten.find((r) => r.rule === SHOWN);
  if (!shown) throw new Error(`rewriteLab did not rewrite ${SHOWN}`);
  const patch = shown.patches[0];
  if (!patch) throw new Error(`${SHOWN} has no patch`);
  const [cell, setCell] = useState<{ rule: string; run: RewriteApplicantResult } | null>(null);
  const readsScore = useMemo(() => new Set(lab.untouched.filter((rule) =>
    memberRefs(`legacy/rules/${rule}`).some((m) => m.refs.some((r) => r.owner === 'legacy/model/Applicant' && r.name === 'getCredScr')),
  )), [lab]);
  const runs = lab.rewritten.flatMap((r) => r.applicants);
  const agree = runs.filter((r) => r.agree).length;

  return (
    <div style={{ height: '100%', display: 'grid', gap: 12, alignContent: 'safe center' }}>
      {beat === 0 && <Patch before={patch.before} after={patch.after} />}
      {beat === 1 && <CallPath runs={shown.applicants} />}
      {beat === 2 && (
        <Panel title={`Original vs rewritten class: ${String(agree)} of ${String(runs.length)} runs give the same decision`} color={agree === runs.length ? GREEN : RED}>
          {lab.rewritten.map((r, ri) => (
            <div key={r.rule} style={{ display: 'grid', gridTemplateColumns: '170px repeat(12, 34px)', gap: 4, alignItems: 'center' }}>
              <span className="mono" style={{ fontSize: 12 }}>{r.rule}</span>
              {r.applicants.map((run, i) => (
                <motion.button key={run.appId} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3 * ri + 0.05 * i }} aria-label={`${r.rule} ${run.appId}`} onClick={() => setCell({ rule: r.rule, run })} style={{ width: 30, height: 30, borderRadius: 6, border: 'none', cursor: 'pointer', background: run.agree ? GREEN : RED }} />
              ))}
            </div>
          ))}
          {cell && (
            <div className="mono" style={{ fontSize: 12, display: 'grid', gap: 2 }}>
              <span>{cell.rule} · {cell.run.appId}</span>
              <span style={{ color: AMBER }}>original:  [{cell.run.originalCodes.join(', ')}]</span>
              <span style={{ color: GREEN }}>rewritten: [{cell.run.rewrittenCodes.join(', ')}]</span>
            </div>
          )}
          <Note>Same rule, same inputs, a different place the score comes from. Click a square to see both decisions.</Note>
        </Panel>
      )}
      {beat === 3 && (
        <Panel title="Rules the rewriter left alone, and why" color={VIOLET}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
            {lab.untouched.map((rule, i) => (
              <motion.div key={rule} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 * i }} style={{ padding: 8, borderRadius: 8, border: `1px solid ${readsScore.has(rule) ? AMBER : '#2a3358'}` }}>
                <div className="mono" style={{ fontSize: 12 }}>{rule}</div>
                <div style={{ fontSize: 12, color: readsScore.has(rule) ? AMBER : 'var(--muted)' }}>
                  {readsScore.has(rule) ? 'Reads the score, but not as the exact pattern. Reported for a person, not guessed.' : 'Never reads the score.'}
                </div>
              </motion.div>
            ))}
          </div>
        </Panel>
      )}
      {beat >= 4 && (
        <Panel title="A wrong rewrite is refused before anything runs" color={RED}>
          <Code>{`target: CreditScores.creditScore(LoanApplication) returns long (J)`}</Code>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.8 }} className="mono" style={{ fontSize: 13, color: RED, padding: 10, borderRadius: 8, background: '#3a1414' }}>{rejection}</motion.div>
          <Note>The old call left an int on the stack; a long would break every instruction after it. The rewriter checks the stack effect and stops.</Note>
        </Panel>
      )}
      {engineer && (
        <Code>{`// playground: ScoreRewriter (ASM)
public void visitMethodInsn(int op, String owner, String name, String desc, boolean itf) {
  if (pendingGetApplicant && owner.equals("legacy/model/Applicant") && name.equals("getCredScr")) {
    super.visitMethodInsn(INVOKESTATIC, "lab/bridge/CreditScores", "creditScore",
        "(Llegacy/model/LoanApplication;)I", false);   // ClassWriter recomputes offsets and max stack
    pendingGetApplicant = false; return;
  }
  ...
}
// browser: same swap in place, padded with NOPs so no offsets move`}</Code>
      )}
    </div>
  );
}

export const asmWriteChapter: Chapter = {
  id: 'asm-write',
  title: 'ASM: rewrite without the source',
  subtitle: 'ClassWriter changes where data comes from, not the rule',
  beats: [
    { caption: 'The old rule asks the applicant record for a credit score. Swap those two instructions for one call to the credit bureau. No source code needed.', ms: 9000 },
    { caption: 'Run it: every score now goes through the bridge to the bureau, the way LoanFlow gets it.', ms: 9000 },
    { caption: 'Run the original and rewritten classes on every applicant. The decisions must match exactly.', ms: 60000 },
    { caption: 'The rewriter only touches the exact pattern it knows. Anything else is reported for a person to look at.', ms: 60000 },
    { caption: 'Ask for an impossible rewrite and it refuses up front, with the reason.', ms: 60000 },
  ],
  Scene,
};
