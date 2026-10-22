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
