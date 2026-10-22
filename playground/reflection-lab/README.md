# Java reflection lab

This lab uses the real compiled classes in `:legacy`. Start with the exercise
implementations in `src/main/java`; the reference implementations are in
`src/solution/java`. `lab.ClassIndex` and `lab.Main` are shared by both variants.

## Exercises

1. **Dump fields.** Implement `FieldDumper.dump` with
   `Class.getDeclaredFields()` and report each field's modifiers, Java type name,
   and name in declaration order.
2. **Find rule implementations.** Implement `RuleFinder.implementors` by loading
   each indexed binary name without initializing it, checking assignability and
   modifiers, then returning the concrete class names in sorted order.
3. **Record a proxy call.** Implement `RecordingProxy.record` with
   `java.lang.reflect.Proxy`. Log the method name and argument class names before
   delegating, and rethrow an invoked method's original cause.
4. **Inspect member references.** Implement `MemberRefs.of` with ASM's
   `ClassReader`, `ClassVisitor`, and `MethodVisitor`. Visit field and method
   instructions in method order and format their opcode, owner, name, and
   descriptor.
5. **Rewrite a score call.** Use a `ClassReader`, `ClassWriter`, and visitor to
   replace `getApplicant().getCredScr()` with the static
   `CreditScores.creditScore(LoanApplication)` bridge. The bridge requires an
   installed `CreditBureau`.
6. **Record a getter with Byte Buddy.** Implement `GetterRecorder.record` as a
   subclass that intercepts public `get*` methods, logs their names, and calls
   the original implementation.
7. **Instrument rule traffic.** Install a Byte Buddy `AgentBuilder` transformer
   with `Advice` on `RuleRunner.run`; write the returned decision's app ID,
   codes, and referrals to `TrafficLog`.

`ClassIndex.legacyClassNames()` walks the code-source directory or jar that
contains `legacy.engine.Rule`, so the class list comes from the compiled
playground rather than a hand-maintained list.

## Run it

From `playground/`, starters compile but deliberately fail the shared tests:

```sh
./gradlew :reflection-lab:compileJava
./gradlew :reflection-lab:test
```

The starter test run reports the exercise TODO exceptions. To run the reference
implementations and see the completed lab:

```sh
./gradlew :reflection-lab:test -Plab=solution
./gradlew :reflection-lab:run -Plab=solution
```

Try each exercise before looking in `src/solution/java`; use the reference
implementation to compare the reflection calls and error handling afterward.

## ASM and Byte Buddy exercises

For each task, open the named starter in VS Code, implement the TODO, and run
the solution test command after switching to the reference variant. The
solution sources are available under `src/solution/java` for a deliberate
comparison after the exercise.

### 4. Inspect bytecode member references
- **File:** `src/main/java/lab/MemberRefs.java`
- **Command:** `./gradlew :reflection-lab:test --tests lab.AsmLabTest.memberRefsListsOrderedFieldAndMethodInstructions`
- **VS Code:** Follow `visitMethod`, return a `MethodVisitor`, and collect only field and method instructions.
- **Agent prompt:** `Implement MemberRefs.of(byte[]) with ASM visitors. Return field and method references in method order as OPCODE owner.name descriptor. Do not inspect bytecode by searching text. Run the focused solution test.`

### 5. Rewrite the score call
- **File:** `src/main/java/lab/ScoreRewriter.java`
- **Command:** `./gradlew :reflection-lab:test --tests lab.AsmLabTest.scoreRewriterPreservesDecisionsAndCallsTheBridgeForEveryInboxRow`
- **VS Code:** Wrap each method visitor, recognize the adjacent getter pair, and emit one `INVOKESTATIC` bridge call.
- **Agent prompt:** `Implement ScoreRewriter with ClassReader, ClassWriter(COMPUTE_MAXS), and MethodVisitor. Replace only the adjacent LoanApplication.getApplicant / Applicant.getCredScr pair. Run every inbox row through original and rewritten R01 and assert equal codes plus a bridge call.`

### 6. Record getter calls
- **File:** `src/main/java/lab/GetterRecorder.java`
- **Command:** `./gradlew :reflection-lab:test --tests lab.AsmLabTest.getterRecorderDelegatesAndCapturesR01Getter`
- **VS Code:** Create a Byte Buddy subclass, intercept public `get*` methods, record the method name, then delegate to the superclass.
- **Agent prompt:** `Implement GetterRecorder.record with Byte Buddy. Populate the generated Applicant using setters, execute R01, and ensure the log is exactly [getCredScr]. Do not modify legacy classes.`

### 7. Record rule traffic
- **File:** `src/main/java/lab/TrafficAgent.java`
- **Command:** `./gradlew :reflection-lab:test --tests lab.AsmLabTest.trafficAgentRecordsEveryRuleRunnerDecision`
- **VS Code:** Install an AgentBuilder transformer with Advice on `RuleRunner.run`; use `TrafficLog` as the sink.
- **Agent prompt:** `Implement TrafficAgent.install(Instrumentation) using Byte Buddy AgentBuilder and Advice on legacy.engine.RuleRunner.run. Record app IDs, codes, and referrals, then compare the captured records with direct RuleSet executions for every inbox row.`
