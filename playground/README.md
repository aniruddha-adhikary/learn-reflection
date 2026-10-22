# A small loan system, opened up

This playground shows how a loan decision can be moved from an old batch program into a newer event-based service. You can run both versions on the same fictional applications and see where they agree, where a business rule lives, and what happens when a field name tells the wrong story. Nothing here needs a server or a cloud account.

## Quick start

Install JDK 17, then from this directory run:

```sh
./gradlew build
./gradlew :porter:run --args=all
./gradlew :legacy:run
./gradlew :porter:run --args="transform"
./gradlew :porter:run --args="intake --fast"
```

Commands that accept a binding file use `--bindings <file>`; no files need to
be copied or renamed. For example:

```sh
./gradlew :porter:run --args="evidence --bindings data/bindings.ai-mistake.json"
./gradlew :porter:run --args="fuzz --bindings data/bindings.ai-mistake.json"
```

`facts` lists what the compiled classes really contain, including getters and setters. `dataflow` follows values through methods. `transform` turns the old rule conditions into a JSON file that the new engine can run. `gate` checks that file for unsupported or unsafe pieces. `evidence` compares each proposed field mapping with the paired application data. `fuzz` tries boundary values and reports any difference between the two implementations. `inert` demonstrates why looking up only the values a rule needs is safer than reading everything in advance. `all` runs the inspection sequence and writes JSON results under `out/`.

The legacy command reads `data/sftp/inbox/` and writes one result CSV per input to `data/sftp/outbox/`. The intake command reads the matching event files, loads the transformed rules and bureau scores, and prints decisions as events arrive. Add `--fast` to remove the short pause between events.

## Play with it

For a human exercise, open the named file in VS Code and make the change. For an AI exercise, paste the prompt into Claude Code, Codex, Devin, or another coding agent. In both cases, run the listed command and compare the result.

### Java reflection lab

The separate [Java reflection lab](reflection-lab/README.md) walks through
declared fields, runtime rule discovery, and recording calls with a dynamic
proxy, then adds ASM bytecode inspection/rewriting and Byte Buddy getter and
traffic instrumentation. The starter implementation compiles; use
`-Plab=solution` to run the reference solutions.

### 1. Catch a mistaken AI binding
- **Goal:** Find an employment code mapped to the wrong modern value.
- **File:** `data/bindings.ai-mistake.json`
- **Commands:** `./gradlew :porter:run --args="evidence --bindings data/bindings.ai-mistake.json"` and `./gradlew :porter:run --args="fuzz --bindings data/bindings.ai-mistake.json"`
- **Expected:** Evidence rejects the `S` mapping with the first disagreeing record; fuzz reports the R06 and R08 differences.
- **Human:** Compare the `S` mapping with `data/bindings.ai.json`, then run both commands.
- **Agent prompt:** `Inspect the two binding files. Do not repair the mistake file; run evidence and fuzz with data/bindings.ai-mistake.json and report the rule and records that expose the wrong S mapping.`

### 2. Rename a getter
- **Goal:** See why method names are not proof of what a value means.
- **File:** `legacy/src/main/java/legacy/model/Applicant.java`
- **Command:** `./gradlew :porter:run --args=facts`
- **Expected:** `getCredScr` becomes `getRiskIndex`; the stored field and decision results do not change.
- **Human:** Rename the getter and its callers in VS Code, then run the command.
- **Agent prompt:** `In legacy/src/main/java/legacy/model/Applicant.java rename getCredScr to getRiskIndex and update callers only. Run ./gradlew :porter:run --args=facts and explain why the field-based mapping is unchanged.`

### 3. Add a twelfth legacy rule
- **Goal:** Add an affordability referral and see whether the transformer can express it.
- **File:** Add `legacy/src/main/java/legacy/rules/R12_Affordability.java` and add it to `RuleSet`.
- **Command:** `./gradlew :porter:run --args=transform` then `./gradlew :porter:run --args=fuzz`
- **Expected:** The new rule refers when principal exceeds 20 times monthly income; unsupported bytecode is reported rather than ignored.
- **Human:** Implement the rule using the existing rule style, add it to `RuleSet`, then run the commands.
- **Agent prompt:** `Add R12_Affordability to legacy using principal > 20 * monthly income and emit REFER_AFFORDABILITY. Register it in RuleSet, run transform and fuzz, and report any explicit unsupported finding rather than hiding it.`

### 4. Compare batch and live intake
- **Goal:** See the same applications arrive as rows and as events.
- **File:** `data/sftp/inbox/applications_20041015.csv` and `data/s3/events/`
- **Command:** `./gradlew :legacy:run` then `./gradlew :porter:run --args="intake --fast"`
- **Expected:** Matching application IDs can be compared across the batch result CSV and live decision lines.
- **Human:** Run both commands and compare a few IDs, including A-1006 and A-1007.
- **Agent prompt:** `Run the legacy batch and fast event intake. Compare decisions for A-1001 through A-1012, noting expected row errors and any mismatch. Do not change the data.`

### 5. Change a decision threshold
- **Goal:** Make a controlled business change after parity is established.
- **File:** `out/rules.json`
- **Command:** `./gradlew :porter:run --args=gate` followed by `./gradlew :porter:run --args="intake --fast"`
- **Expected:** The gate accepts valid JSON and only the affected score-band decisions change.
- **Human:** Change the score constant for one band, run the gate, then intake.
- **Agent prompt:** `Change only the BAND_A threshold in out/rules.json, run gate and fast intake, and list which decisions changed. Preserve the JSON schema.`

### 6. Propose a binding for a new field
- **Goal:** Ask an agent to suggest a mapping, then validate it against paired records.
- **File:** A proposed copy of `data/bindings.ai.json`
- **Command:** `./gradlew :porter:run --args="evidence --bindings data/my-bindings.json"`
- **Expected:** Each binding is confirmed only when every paired row agrees; non-injective value maps are rejected.
- **Human:** Add a candidate field mapping to a copy of the bindings and run evidence.
- **Agent prompt:** `Propose one new legacy-to-modern binding based on the Java classes. Add it to data/my-bindings.json and run evidence. Do not label it confirmed unless the measured records support it; report mismatches and non-injective value maps.`
