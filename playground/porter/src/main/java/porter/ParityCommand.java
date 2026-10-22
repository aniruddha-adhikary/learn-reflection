package porter;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import modern.engine.ConditionRule;
import modern.engine.Engine;
import modern.engine.NaiveEngine;
import modern.foundation.expr.*;
import modern.model.Employment;
import modern.model.LoanEvent;
import modern.services.CreditBureau;
import modern.services.Services;

public final class ParityCommand {
    private static final ObjectMapper JSON = new ObjectMapper();
    private ParityCommand() {}

    public record EvidenceRow(String legacyField, String status, int matches, int total,
            String firstRecordId, String reason) {}
    public record EvidenceResult(Path bindings, List<EvidenceRow> bindingsResult) {}
    public record InertResult(boolean enginePassed, boolean naiveFailed, String message) {}

    public static EvidenceResult evidence(Path bindingPath) throws Exception {
        JsonNode root = JSON.readTree(bindingPath.toFile());
        JsonNode bindings = root.path("bindings");
        Map<String, LoanEvent> events = loadEvents();
        Map<String, Integer> scores = scores();
        List<EvidenceRow> result = new ArrayList<>();
        for (JsonNode binding : bindings) {
            String fieldName = binding.path("legacy").asText();
            int hash = fieldName.lastIndexOf('#');
            String ownerName = fieldName.substring(0, hash);
            String fieldPart = fieldName.substring(hash + 1);
            Field field = Class.forName(ownerName).getDeclaredField(fieldPart);
            field.setAccessible(true);
            int agree = 0;
            String firstId = "";
            String first = "";
            int count = 0;
            for (String[] row : readRows()) {
                var app = legacy.batch.CsvLoader.toApplication(header(), row);
                String id = app.getAppId();
                LoanEvent event = events.get(id);
                Services service = new Services(applicantId -> {
                    Integer score = scores.get(applicantId);
                    if (score == null) throw new IllegalArgumentException("Missing bureau score for " + applicantId);
                    return score;
                });
                Object legacyValue = field.get(ownerName.endsWith("Applicant") ? app.getApplicant() : app);
                Object expectedValue = legacyValue;
                Object modernValue;
                String metric = binding.path("modern").asText();
                if ("credit.score".equals(metric)) modernValue = MetricsValue("credit.score", event, service);
                else if ("income.annual".equals(metric)) modernValue = MetricsValue(metric, event, service);
                else if ("debt.monthly".equals(metric)) modernValue = MetricsValue(metric, event, service);
                else if ("employment".equals(metric)) {
                    JsonNode mapping = binding.path("values");
                    JsonNode mapped = mapping.get(String.valueOf(legacyValue));
                    modernValue = mapped == null ? null : Employment.valueOf(mapped.asText());
                    expectedValue = event.getApplicant().getEmployment();
                } else if (binding.has("via") && "size".equals(binding.path("via").asText()))
                    modernValue = event.getGuarantors().size();
                else modernValue = MetricsValue(metric, event, service);
                if (binding.has("via") && "size".equals(binding.path("via").asText()))
                    expectedValue = ((java.util.List<?>) legacyValue).size();
                if (java.util.Objects.equals(expectedValue, modernValue)) agree++;
                else if (firstId.isEmpty()) {
                    firstId = id;
                    first = legacyValue + " != " + modernValue;
                }
                count++;
            }
            boolean injective = true;
            if (bindings.size() > 0 && binding.has("values")) {
                List<String> mapped = new ArrayList<String>();
                binding.path("values").elements().forEachRemaining(v -> mapped.add(v.asText()));
                injective = mapped.stream().distinct().count() == mapped.size();
            }
            String status = agree == count && injective ? "CONFIRMED" : "REJECTED";
            String reason = first.isEmpty() ? "" : first;
            if (!injective) reason = reason.isEmpty() ? "value map is not injective"
                : reason + "; value map is not injective";
            result.add(new EvidenceRow(fieldName, status, agree, count, firstId, reason));
        }
        JSON.writerWithDefaultPrettyPrinter().writeValue(Path.of("out/evidence.json").toFile(), result);
        return new EvidenceResult(bindingPath, List.copyOf(result));
    }

    public static FuzzCommand.FuzzResult fuzz(Path bindingPath) throws Exception {
        return FuzzCommand.run(bindingPath);
    }

    private static void compare(legacy.model.LoanApplication app, LoanEvent event, Services services,
            List<ConditionRule> rules, String id, Map<String, List<String>> mismatches) {
        List<String> legacyCodes;
        List<String> modernCodes;
        String legacyError = "";
        String modernError = "";
        try { legacyCodes = legacy.engine.RuleRunner.run(app).getCodes(); }
        catch (RuntimeException e) { legacyCodes = List.of(); legacyError = e.getClass().getName(); }
        try { modernCodes = new Engine().evaluate(rules, event, services); }
        catch (RuntimeException e) { modernCodes = List.of(); modernError = e.getClass().getName(); }
        if (!legacyCodes.equals(modernCodes) || !legacyError.equals(modernError)) {
            mismatches.computeIfAbsent("differential", ignored -> new ArrayList<String>())
                .add(id + " legacy=" + legacyCodes + "/" + legacyError + " modern=" + modernCodes + "/" + modernError);
        }
    }

    public static InertResult inert() throws Exception {
        List<ConditionRule> rules = new ArrayList<ConditionRule>();
        for (RuleJson.RuleRecord record : RuleJson.readRecords(Path.of("out/rules.json"))) {
            if (!readsMetric(record.when(), "credit.score"))
                rules.add(record.conditionRule());
        }
        LoanEvent event = JSON.readValue(Path.of("data/s3/events/A-1001.json").toFile(), LoanEvent.class);
        Services inert = new Services((CreditBureau) applicantId -> {
            throw new IllegalStateException("inert: scoreFor called");
        });
        new Engine().evaluate(rules, event, inert);
        try {
            new NaiveEngine().evaluate(rules, event, inert);
            throw new IllegalStateException("NaiveEngine unexpectedly avoided credit.score");
        } catch (IllegalStateException expected) {
            if (!expected.getMessage().startsWith("inert:")) throw expected;
            return new InertResult(true, true, expected.getMessage());
        }
    }

    private static boolean readsMetric(Expr expression, String metricId) {
        if (expression instanceof Read value) return metricId.equals(value.metricId());
        if (expression instanceof Arith value)
            return readsMetric(value.left(), metricId) || readsMetric(value.right(), metricId);
        if (expression instanceof Compare value)
            return readsMetric(value.left(), metricId) || readsMetric(value.right(), metricId);
        if (expression instanceof Equals value)
            return readsMetric(value.left(), metricId) || readsMetric(value.right(), metricId);
        if (expression instanceof InSet value) return readsMetric(value.value(), metricId);
        if (expression instanceof Not value) return readsMetric(value.value(), metricId);
        if (expression instanceof IsTrue value) return readsMetric(value.value(), metricId);
        if (expression instanceof IsFalse value) return readsMetric(value.value(), metricId);
        if (expression instanceof And value)
            return value.values().stream().anyMatch(child -> readsMetric(child, metricId));
        if (expression instanceof Or value)
            return value.values().stream().anyMatch(child -> readsMetric(child, metricId));
        return false;
    }

    private static void mapEmployment(LoanEvent event, String legacyValue, JsonNode binding) {
        JsonNode value = binding.path("values").get(legacyValue);
        event.getApplicant().setEmployment(value == null ? null : Employment.valueOf(value.asText()));
    }
    private static Object MetricsValue(String id, LoanEvent event, Services services) {
        return modern.foundation.metrics.Metrics.byId(id).read(event, services);
    }
    private static Services bureau(Map<String, Integer> scores) {
        return new Services(applicantId -> {
            Integer value = scores.get(applicantId);
            if (value == null) throw new IllegalArgumentException("Missing bureau score for " + applicantId);
            return value;
        });
    }
    private static Map<String, Integer> scores() throws Exception {
        return JSON.readValue(Path.of("data/bureau/scores.json").toFile(), new TypeReference<Map<String, Integer>>() {});
    }
    private static Map<String, LoanEvent> loadEvents() throws Exception {
        Map<String, LoanEvent> events = new LinkedHashMap<String, LoanEvent>();
        try (var paths = Files.list(Path.of("data/s3/events"))) {
            for (Path path : paths.filter(p -> p.toString().endsWith(".json")).toList()) {
                LoanEvent event = JSON.readValue(path.toFile(), LoanEvent.class);
                events.put(event.getId(), event);
            }
        }
        return events;
    }
    private static List<String[]> readRows() throws Exception {
        try (var reader = Files.newBufferedReader(Path.of("data/sftp/inbox/applications_20041015.csv"))) {
            List<String[]> rows = legacy.batch.CsvReader.readAll(reader);
            return rows.subList(1, rows.size());
        }
    }
    private static String[] header() throws Exception {
        try (var reader = Files.newBufferedReader(Path.of("data/sftp/inbox/applications_20041015.csv"))) {
            return legacy.batch.CsvReader.readAll(reader).get(0);
        }
    }
}
