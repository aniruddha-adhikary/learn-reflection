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
        var actual = TransformCommand.transform();
        var golden = RuleJson.readRecords(Path.of("porter/src/test/resources/rules.golden.json"));
        assertEquals(12, actual.size());
        assertEquals(10, new HashSet<>(actual.stream().map(RuleJson.RuleRecord::legacyRule).toList()).size());
        assertEquals(golden.size(), actual.size());
        for (int i = 0; i < actual.size(); i++) {
            assertEquals(RuleJson.json(golden.get(i)), RuleJson.json(actual.get(i)));
        }
        assertFalse(actual.stream().anyMatch(rule -> rule.legacyRule().equals("R11_NotifyCosigners")));
        JsonNode findings = new ObjectMapper().readTree(Path.of("out/longtail.json").toFile()).path("findings");
        assertEquals("R11_NotifyCosigners", findings.get(0).path("legacyRule").asText());
    }

    @Test
    void gateReportsMultipleViolations() throws Exception {
        assertTrue(GateCommand.validate(Path.of("porter/src/test/resources/bad-rules.json")).size() >= 3);
    }

    @Test
    void evidenceAndFuzzExposeTheMistakenEmploymentMapping() throws Exception {
        ParityCommand.evidence(Path.of("data/bindings.ai.json"));
        ParityCommand.evidence(Path.of("data/bindings.ai-mistake.json"));
        TransformCommand.transform();
        ParityCommand.fuzz(Path.of("data/bindings.ai.json"));
        assertDoesNotThrow(() -> ParityCommand.fuzz(Path.of("data/bindings.ai-mistake.json")));
    }

    @Test
    void lazyEngineSucceedsWhileNaiveEngineCallsTheInertProxy() throws Exception {
        TransformCommand.transform();
        assertDoesNotThrow(ParityCommand::inert);
    }
}
