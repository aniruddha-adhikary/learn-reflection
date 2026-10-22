package lab;

import java.io.IOException;
import java.io.InputStream;
import java.lang.instrument.Instrumentation;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.nio.file.Files;
import java.nio.file.Path;

import legacy.engine.Rule;
import legacy.engine.RuleRunner;
import legacy.model.Applicant;
import legacy.model.Decision;
import legacy.model.LoanApplication;
import legacy.rules.R01_MinimumScore;
import lab.bridge.CreditScores;
import net.bytebuddy.agent.ByteBuddyAgent;

public final class Main {
    private Main() {}

    public static void main(String[] args) {
        boolean completed = true;
        completed &= runExercise("TODO: exercise 1 - see README", () -> {
            System.out.println("Applicant fields:");
            FieldDumper.dump(Applicant.class).forEach(System.out::println);
        });
        completed &= runExercise("TODO: exercise 2 - see README", () -> {
            System.out.println("Rule implementors:");
            RuleFinder.implementors(Rule.class, ClassIndex.legacyClassNames()).forEach(System.out::println);
        });
        completed &= runExercise("TODO: exercise 3 - see README", () -> {
            Applicant applicant = new Applicant();
            applicant.setName("Ada Lovelace");
            applicant.setAnnualIncome(36000);
            applicant.setCredScr(575);
            applicant.setEmpStat("E");
            applicant.setDebt(100);
            applicant.setCountry("XA");

            LoanApplication application = new LoanApplication();
            application.setAppId("A-1002");
            application.setApplicant(applicant);
            application.setAmount(120000);
            application.setTermMonths(240);
            application.setCollateral(true);

            Decision decision = new Decision();
            List<String> log = new ArrayList<>();
            Rule proxy = RecordingProxy.record(Rule.class, new R01_MinimumScore(), log);
            proxy.execute(application, decision);

            System.out.println("Proxy log:");
            log.forEach(System.out::println);
            System.out.println("Decision codes:");
            decision.getCodes().forEach(System.out::println);
        });
        completed &= runExercise("TODO: exercise 4 - see README", () -> {
            System.out.println("Member references:");
            MemberRefs.of(classBytes(R01_MinimumScore.class)).forEach(System.out::println);
        });
        completed &= runExercise("TODO: exercise 5 - see README", () -> {
            Map<String, Integer> legacyScores = legacyScoresByAppId();
            CreditScores.install(appId -> {
                Integer score = legacyScores.get(appId);
                if (score == null) throw new IllegalArgumentException("Unknown application ID: " + appId);
                return score;
            });
            byte[] rewritten = ScoreRewriter.rewrite(classBytes(R01_MinimumScore.class));
            Class<?> rewrittenType = new RewrittenRuleLoader(rewritten).load();
            Rule rule = (Rule) rewrittenType.getDeclaredConstructor().newInstance();
            LoanApplication application = sampleApplication();
            Decision decision = new Decision();
            rule.execute(application, decision);
            System.out.println("Rewritten score decision:");
            decision.getCodes().forEach(System.out::println);
        });
        completed &= runExercise("TODO: exercise 6 - see README", () -> {
            List<String> log = new ArrayList<>();
            Applicant applicant = GetterRecorder.record(Applicant.class, log);
            applicant.setCredScr(575);
            LoanApplication application = new LoanApplication();
            application.setApplicant(applicant);
            Decision decision = new Decision();
            new R01_MinimumScore().execute(application, decision);
            System.out.println("Recorded getters:");
            log.forEach(System.out::println);
        });
        completed &= runExercise("TODO: exercise 7 - see README", () -> {
            Instrumentation instrumentation = ByteBuddyAgent.install();
            TrafficAgent.install(instrumentation);
            TrafficLog.clear();
            String[] header;
            try (var reader = Files.newBufferedReader(Path.of("../data/sftp/inbox/applications_20041015.csv"))) {
                List<String[]> rows = legacy.batch.CsvReader.readAll(reader);
                header = rows.get(0);
                for (String[] row : rows.subList(1, rows.size())) {
                    LoanApplication application = legacy.batch.CsvLoader.toApplication(header, row);
                    try {
                        RuleRunner.run(application);
                    } catch (RuntimeException ignored) {}
                }
            }
            System.out.println("RuleRunner traffic:");
            TrafficLog.snapshot().forEach(entry -> System.out.println(
                entry.appId() + " " + (entry.error() == null ? entry.codes() : "ERROR " + entry.error())
            ));
        });
        if (!completed) System.exit(1);
    }

    private static byte[] classBytes(Class<?> type) throws IOException {
        String resource = type.getSimpleName() + ".class";
        try (InputStream input = type.getResourceAsStream(resource)) {
            if (input == null) throw new IOException("Missing class bytes: " + type.getName());
            return input.readAllBytes();
        }
    }

    private static Map<String, Integer> legacyScoresByAppId() throws IOException {
        try (var reader = Files.newBufferedReader(Path.of("../data/sftp/inbox/applications_20041015.csv"))) {
            List<String[]> rows = legacy.batch.CsvReader.readAll(reader);
            String[] header = rows.get(0);
            Map<String, Integer> scores = new HashMap<>();
            for (String[] row : rows.subList(1, rows.size())) {
                LoanApplication application = legacy.batch.CsvLoader.toApplication(header, row);
                scores.put(application.getAppId(), application.getApplicant().getCredScr());
            }
            return scores;
        }
    }

    private static LoanApplication sampleApplication() {
        Applicant applicant = new Applicant();
        applicant.setCredScr(575);
        LoanApplication application = new LoanApplication();
        application.setAppId("A-1002");
        application.setApplicant(applicant);
        return application;
    }

    private static final class RewrittenRuleLoader extends ClassLoader {
        private final byte[] bytes;

        private RewrittenRuleLoader(byte[] bytes) {
            super(Main.class.getClassLoader());
            this.bytes = bytes;
        }

        private Class<?> load() {
            return defineClass(R01_MinimumScore.class.getName(), bytes, 0, bytes.length);
        }
    }

    private static boolean runExercise(String fallback, Exercise exercise) {
        try {
            exercise.run();
            return true;
        } catch (UnsupportedOperationException todo) {
            System.err.println(todo.getMessage() == null ? fallback : todo.getMessage());
        } catch (Exception error) {
            System.err.println("Reflection lab failed: " + error.getMessage());
        }
        return false;
    }

    @FunctionalInterface
    private interface Exercise {
        void run() throws Exception;
    }
}
