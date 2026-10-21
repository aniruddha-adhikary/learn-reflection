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
            case "evidence" -> ParityCommand.evidence(bindings);
            case "fuzz" -> ParityCommand.fuzz(bindings);
            case "inert" -> ParityCommand.inert();
            case "intake" -> EventIntake.main(args);
            case "all" -> {
                FactsCommand.run();
                DataflowCommand.run();
                runTransform();
                runGate();
                ParityCommand.evidence(bindings);
                ParityCommand.fuzz(bindings);
                ParityCommand.inert();
            }
            default -> throw new IllegalArgumentException("Unknown command: " + command);
        }
    }
    private static void runTransform() throws Exception {
        List<RuleJson.RuleRecord> rules = TransformCommand.transform();
        System.out.println("source rules=10 condition rules=" + rules.size() + " findings=1");
        rules.forEach(rule -> System.out.println(rule.ruleId() + " -> " + rule.emit() + " [" + rule.family() + "]"));
    }
    private static void runGate() throws Exception {
        List<String> errors = GateCommand.validate(Path.of("out/rules.json"));
        if (!errors.isEmpty()) {
            errors.forEach(System.err::println);
            throw new IllegalStateException("Gate rejected " + errors.size() + " violation(s)");
        }
        System.out.println("gate: PASS");
    }
}
