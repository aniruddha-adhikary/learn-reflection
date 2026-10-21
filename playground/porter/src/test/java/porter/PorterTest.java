package porter;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Path;
import java.util.HashSet;
import org.junit.jupiter.api.Test;

class PorterTest {
    @Test
    void transformHasTenSourceRulesTwelveConditionPathsAndR11Finding() throws Exception {
        var result = TransformCommand.transformResult();
        var actual = result.rules();
        var golden = RuleJson.readRecords(Path.of("porter/src/test/resources/rules.golden.json"));
        assertEquals(12, actual.size());
        assertEquals(10, new HashSet<>(actual.stream().map(RuleJson.RuleRecord::legacyRule).toList()).size());
        assertEquals(golden.size(), actual.size());
        for (int i = 0; i < actual.size(); i++) {
            assertEquals(RuleJson.json(golden.get(i)), RuleJson.json(actual.get(i)));
        }
        assertFalse(actual.stream().anyMatch(rule -> rule.legacyRule().equals("R11_NotifyCosigners")));
        assertEquals(1, result.findings().size());
        JsonNode findings = new ObjectMapper().readTree(Path.of("out/longtail.json").toFile()).path("findings");
        assertEquals("R11_NotifyCosigners", findings.get(0).path("legacyRule").asText());
        assertTrue(result.findings().get(0).reason().contains("iterator"));
    }

    @Test
    void gateReportsMultipleViolations() throws Exception {
        assertTrue(GateCommand.validate(Path.of("porter/src/test/resources/bad-rules.json")).size() >= 3);
    }

    @Test
    void evidenceAndFuzzExposeTheMistakenEmploymentMapping() throws Exception {
        var correctEvidence = ParityCommand.evidence(Path.of("data/bindings.ai.json"));
        assertEquals(9, correctEvidence.bindingsResult().size());
        assertTrue(correctEvidence.bindingsResult().stream().allMatch(row -> row.status().equals("CONFIRMED")));
        var mistakeEvidence = ParityCommand.evidence(Path.of("data/bindings.ai-mistake.json"));
        var employment = mistakeEvidence.bindingsResult().stream()
            .filter(row -> row.legacyField().endsWith("#empStat")).findFirst().orElseThrow();
        assertEquals("REJECTED", employment.status());
        assertEquals("A-1003", employment.firstRecordId());
        assertTrue(employment.reason().contains("S != EMPLOYED"));
        assertEquals(8, mistakeEvidence.bindingsResult().stream()
            .filter(row -> !row.legacyField().endsWith("#empStat"))
            .filter(row -> row.status().equals("CONFIRMED")).count());
        TransformCommand.transform();
        var correctFuzz = ParityCommand.fuzz(Path.of("data/bindings.ai.json"));
        assertEquals(0, correctFuzz.disagreements().size());
        var mistakeFuzz = ParityCommand.fuzz(Path.of("data/bindings.ai-mistake.json"));
        assertFalse(mistakeFuzz.disagreements().isEmpty());
        assertTrue(mistakeFuzz.disagreements().stream().anyMatch(row -> row.path("rule").asText().startsWith("R06")));
        assertTrue(mistakeFuzz.disagreements().stream().anyMatch(row -> row.path("rule").asText().startsWith("R08")));
    }

    @Test
    void lazyEngineSucceedsWhileNaiveEngineCallsTheInertProxy() throws Exception {
        TransformCommand.transform();
        var result = ParityCommand.inert();
        assertTrue(result.enginePassed());
        assertTrue(result.naiveFailed());
        assertTrue(result.message().contains("inert: scoreFor called"));
    }

    @Test
    void reflectionDataflowEvidenceAndFuzzMatchTheirGoldens() throws Exception {
        FactsCommand.run();
        assertGolden("out/facts.json", "facts.golden.json");
        DataflowCommand.run();
        assertGolden("out/dataflow.json", "dataflow.golden.json");
        ParityCommand.evidence(Path.of("data/bindings.ai.json"));
        assertGolden("out/evidence.json", "evidence.ai.golden.json");
        ParityCommand.evidence(Path.of("data/bindings.ai-mistake.json"));
        assertGolden("out/evidence.json", "evidence.mistake.golden.json");
        TransformCommand.transform();
        ParityCommand.fuzz(Path.of("data/bindings.ai.json"));
        assertGolden("out/fuzz.json", "fuzz.ai.golden.json");
        ParityCommand.fuzz(Path.of("data/bindings.ai-mistake.json"));
        assertGolden("out/fuzz.json", "fuzz.mistake.golden.json");
    }

    private static void assertGolden(String actual, String golden) throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        JsonNode expected = mapper.readTree(Path.of("porter/src/test/resources", golden).toFile());
        JsonNode value = mapper.readTree(Path.of(actual).toFile());
        assertEquals(expected, value, golden);
    }
}
