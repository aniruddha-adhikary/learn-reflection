package lab;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.InputStream;
import java.lang.instrument.Instrumentation;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import legacy.batch.CsvLoader;
import legacy.batch.CsvReader;
import legacy.engine.Rule;
import legacy.engine.RuleRunner;
import legacy.engine.RuleSet;
import legacy.model.Applicant;
import legacy.model.Decision;
import legacy.model.LoanApplication;
import legacy.rules.R01_MinimumScore;
import lab.bridge.CreditScores;
import net.bytebuddy.agent.ByteBuddyAgent;
import org.junit.jupiter.api.Test;

class AsmLabTest {
    @Test
    void memberRefsListsOrderedFieldAndMethodInstructions() throws Exception {
        List<String> refs = MemberRefs.of(classBytes(R01_MinimumScore.class));
        assertTrue(refs.contains("INVOKEVIRTUAL legacy/model/LoanApplication.getApplicant ()Llegacy/model/Applicant;"));
        assertTrue(refs.contains("INVOKEVIRTUAL legacy/model/Applicant.getCredScr ()I"));
    }

    @Test
    void scoreRewriterPreservesDecisionsAndCallsTheBridgeForEveryInboxRow() throws Exception {
        byte[] rewrittenBytes = ScoreRewriter.rewrite(classBytes(R01_MinimumScore.class));
        Rule rewritten = (Rule) new SingleRuleLoader(rewrittenBytes).load().getDeclaredConstructor().newInstance();
        AtomicInteger bridgeCalls = new AtomicInteger();
        List<String[]> rows = inboxRows();
        String[] header = rows.get(0);
        Map<String, Integer> legacyScores = new HashMap<>();
        for (String[] row : rows.subList(1, rows.size())) {
            LoanApplication app = CsvLoader.toApplication(header, row);
            legacyScores.put(app.getAppId(), app.getApplicant().getCredScr());
        }
        CreditScores.install(appId -> {
            bridgeCalls.incrementAndGet();
            Integer score = legacyScores.get(appId);
            if (score == null) throw new IllegalArgumentException("Unknown application ID: " + appId);
            return score;
        });
        for (String[] row : rows.subList(1, rows.size())) {
            LoanApplication app = CsvLoader.toApplication(header, row);
            Decision expected = new Decision();
            new R01_MinimumScore().execute(app, expected);
            Decision actual = new Decision();
            rewritten.execute(app, actual);
            assertEquals(expected.getCodes(), actual.getCodes(), app.getAppId());
        }
        assertEquals(rows.size() - 1, bridgeCalls.get());
    }

    @Test
    void getterRecorderDelegatesAndCapturesR01Getter() {
        List<String> log = new ArrayList<>();
        Applicant applicant = GetterRecorder.record(Applicant.class, log);
        applicant.setCredScr(575);
        LoanApplication application = new LoanApplication();
        application.setApplicant(applicant);
        Decision decision = new Decision();
        new R01_MinimumScore().execute(application, decision);
        assertEquals(List.of("getCredScr"), log);
        assertTrue(decision.getCodes().contains("DECLINE_LOW_SCORE"));
    }

    @Test
    void trafficAgentRecordsEveryRuleRunnerDecision() throws Exception {
        Instrumentation instrumentation = ByteBuddyAgent.install();
        TrafficAgent.install(instrumentation);
        try {
            TrafficLog.clear();
            List<String[]> rows = inboxRows();
            String[] header = rows.get(0);
            List<TrafficLog.Entry> expected = new ArrayList<>();
            for (String[] row : rows.subList(1, rows.size())) {
                LoanApplication app = CsvLoader.toApplication(header, row);
                try {
                    Decision decision = new Decision();
                    for (Rule rule : RuleSet.all()) rule.execute(app, decision);
                    expected.add(new TrafficLog.Entry(app.getAppId(), decision.getCodes(), decision.getReferrals(), null));
                } catch (RuntimeException error) {
                    expected.add(new TrafficLog.Entry(
                        app.getAppId(), List.of(), List.of(), error.getClass().getSimpleName() + ": " + error.getMessage()
                    ));
                }
                try {
                    RuleRunner.run(app);
                } catch (RuntimeException ignored) {}
            }
            assertEquals(expected, TrafficLog.snapshot());
        } finally {
            TrafficAgent.uninstall(instrumentation);
            TrafficLog.clear();
        }
    }

    private static List<String[]> inboxRows() throws Exception {
        try (var reader = Files.newBufferedReader(Path.of("../data/sftp/inbox/applications_20041015.csv"))) {
            return CsvReader.readAll(reader);
        }
    }

    private static byte[] classBytes(Class<?> type) throws Exception {
        String resource = type.getSimpleName() + ".class";
        try (InputStream input = type.getResourceAsStream(resource)) {
            if (input == null) throw new IllegalStateException("Missing class bytes for " + type.getName());
            return input.readAllBytes();
        }
    }

    private static final class SingleRuleLoader extends ClassLoader {
        private final byte[] bytes;

        private SingleRuleLoader(byte[] bytes) {
            super(AsmLabTest.class.getClassLoader());
            this.bytes = bytes;
        }

        private Class<?> load() {
            return defineClass(R01_MinimumScore.class.getName(), bytes, 0, bytes.length);
        }
    }
}
