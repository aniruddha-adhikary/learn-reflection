package porter;

import java.nio.file.Path;
import java.util.List;
import porter.intake.EventIntake;

public final class Main {
    private Main() {}
    public static void main(String[] args) throws Exception {
        String command = args.length == 0 ? "all" : args[0];
        Path bindings = Path.of("data/bindings.ai.json");
        for (int i = 1; i + 1 < args.length; i++) if ("--bindings".equals(args[i])) bindings = Path.of(args[i + 1]);
        java.nio.file.Files.createDirectories(Path.of("out"));
        switch (command) {
            case "facts" -> FactsCommand.run();
            case "dataflow" -> DataflowCommand.run();
            case "transform" -> runTransform();
            case "gate" -> runGate();
            case "evidence" -> printEvidence(ParityCommand.evidence(bindings));
            case "fuzz" -> {
                TransformCommand.transform();
                printFuzz(ParityCommand.fuzz(bindings));
            }
            case "inert" -> printInert(ParityCommand.inert());
            case "intake" -> EventIntake.main(args);
            case "all" -> {
                FactsCommand.run();
                DataflowCommand.run();
                runTransform();
                runGate();
                printEvidence(ParityCommand.evidence(bindings));
                printFuzz(ParityCommand.fuzz(bindings));
                printInert(ParityCommand.inert());
            }
            default -> throw new IllegalArgumentException("Unknown command: " + command);
        }
    }
    private static void runTransform() throws Exception {
        TransformCommand.TransformResult result = TransformCommand.transformResult();
        List<RuleJson.RuleRecord> rules = result.rules();
        long sourceCount = rules.stream().map(RuleJson.RuleRecord::legacyRule).distinct().count();
        System.out.println("source rules=" + sourceCount + " condition rules=" + rules.size()
            + " findings=" + result.findings().size());
        rules.forEach(rule -> System.out.println(rule.ruleId() + " -> " + rule.emit() + " [" + rule.family() + "]"));
        result.findings().forEach(finding -> System.out.println("FINDING " + finding.rule() + ": " + finding.reason()));
    }
    private static void runGate() throws Exception {
        List<String> errors = GateCommand.validate(Path.of("out/rules.json"));
        if (!errors.isEmpty()) {
            errors.forEach(System.err::println);
            throw new IllegalStateException("Gate rejected " + errors.size() + " violation(s)");
        }
        System.out.println("gate: PASS");
    }
    private static void printEvidence(ParityCommand.EvidenceResult result) {
        result.bindingsResult().forEach(row -> System.out.println(row.legacyField() + " " + row.status()
            + " " + row.matches() + "/" + row.total()
            + (row.reason().isEmpty() ? "" : " — " + row.reason())
            + (row.firstRecordId().isEmpty() ? "" : " first=" + row.firstRecordId())));
    }
    private static void printFuzz(FuzzCommand.FuzzResult result) {
        result.domains().forEach((rule, domain) -> System.out.println("domain " + rule + " " + domain));
        result.disagreements().forEach(mismatch -> System.out.println("DISAGREEMENT " + mismatch));
        System.out.println("fuzz total=" + result.cases() + " disagreements=" + result.disagreements().size());
    }
    private static void printInert(ParityCommand.InertResult result) {
        System.out.println("Engine (lazy): " + (result.enginePassed()
            ? "PASS — metrics read only when reached" : "FAIL"));
        System.out.println("NaiveEngine (prefetch): " + (result.naiveFailed()
            ? "FAIL — touched scoreFor on an inert proxy" : "PASS unexpectedly"));
    }
}
