package porter.intake;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import modern.engine.ConditionRule;
import modern.engine.Engine;
import modern.model.LoanEvent;
import modern.services.CreditBureau;
import modern.services.Services;
import porter.RuleJson;

public final class EventIntake {
    private EventIntake() {}
    public static void main(String[] args) throws Exception {
        boolean fast = List.of(args).contains("--fast");
        ObjectMapper json = new ObjectMapper();
        Map<String, Integer> scores = json.readValue(Path.of("data/bureau/scores.json").toFile(),
            new TypeReference<Map<String, Integer>>() {});
        List<ConditionRule> rules = RuleJson.read(Path.of("out/rules.json"));
        CreditBureau bureau = applicantId -> {
            Integer score = scores.get(applicantId);
            if (score == null) throw new IllegalArgumentException("Missing bureau score for " + applicantId);
            return score;
        };
        Services services = new Services(bureau);
        List<Path> files;
        try (var stream = Files.list(Path.of("data/s3/events"))) {
            files = stream.filter(path -> path.getFileName().toString().endsWith(".json"))
                .sorted(Comparator.naturalOrder()).toList();
        }
        Engine engine = new Engine();
        for (int index = 0; index < files.size(); index++) {
            LoanEvent event = json.readValue(files.get(index).toFile(), LoanEvent.class);
            System.out.println(event.getId() + " -> " + engine.evaluate(rules, event, services));
            if (!fast && index + 1 < files.size()) Thread.sleep(300);
        }
    }
}
