package porter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import modern.engine.ConditionRule;
import modern.engine.Engine;
import modern.foundation.expr.*;
import modern.model.*;
import modern.services.Services;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.*;

public final class FuzzCommand {
    private static final ObjectMapper JSON = new ObjectMapper();
    private FuzzCommand() {}

    private record Binding(String legacy, String metric, String via, Map<String, String> values) {}
    private record Domain(Map<String, List<Object>> values, List<Integer> integers, List<String> strings) {}
    private record Outcome(List<String> codes, String error) {}

    public static void run(Path bindingFile) throws Exception {
        Map<String, Binding> bindings = readBindings(bindingFile);
        Map<String, Binding> correct = readBindings(Path.of("data/bindings.ai.json"));
        List<RuleJson.RuleRecord> transformed = RuleJson.readRecords(Path.of("out/rules.json"));
        Map<String, List<RuleJson.RuleRecord>> grouped = new LinkedHashMap<>();
        for (RuleJson.RuleRecord record : transformed) {
            grouped.computeIfAbsent(record.legacyRule(), ignored -> new ArrayList<>()).add(record);
        }
        Map<String, legacy.engine.Rule> legacyRules = new LinkedHashMap<>();
        for (legacy.engine.Rule rule : legacy.engine.RuleSet.all()) {
            legacyRules.put(rule.getClass().getSimpleName(), rule);
        }
        Map<String, Object> report = new LinkedHashMap<>();
        Map<String, Object> domainReport = new LinkedHashMap<>();
        ArrayNode mismatches = JSON.createArrayNode();
        int total = 0;
        for (Map.Entry<String, List<RuleJson.RuleRecord>> group : grouped.entrySet()) {
            legacy.engine.Rule legacyRule = legacyRules.get(group.getKey());
            if (legacyRule == null) throw new IllegalStateException("No legacy source rule for " + group.getKey());
            Domain domain = domain(legacyRule.getClass(), correct);
            domainReport.put(group.getKey(), Map.of("fields", domain.values(),
                "integerLiterals", domain.integers(), "stringLiterals", domain.strings()));
            System.out.println("domain " + group.getKey() + " integers=" + domain.integers()
                + " strings=" + domain.strings() + " fields=" + domain.values());
            List<Map<String, Object>> cases = cartesian(domain.values(), 12000);
            addSeededCases(cases, domain.values(), 24, 731L + group.getKey().hashCode());
            int disagreements = 0;
            for (Map<String, Object> assignment : cases) {
                total++;
                legacy.model.LoanApplication app = legacyApplication(assignment);
                LoanEvent event = pushForward(app, bindings, correct, total);
                Outcome expected = legacyOutcome(legacyRule, app);
                Outcome actual = modernOutcome(group.getValue(), event);
                if (!expected.equals(actual)) {
                    disagreements++;
                    var mismatch = mismatches.addObject();
                    mismatch.put("rule", group.getKey());
                    mismatch.set("input", JSON.valueToTree(assignment));
                    mismatch.set("legacy", JSON.valueToTree(expected));
                    mismatch.set("modern", JSON.valueToTree(actual));
                    System.out.println("DISAGREEMENT " + group.getKey() + " input=" + assignment
                        + " legacy=" + expected + " modern=" + actual);
                }
            }
            System.out.println(group.getKey() + " cases=" + cases.size() + " disagreements=" + disagreements);
        }
        report.put("bindings", bindingFile.toString());
        report.put("domains", domainReport);
        report.put("cases", total);
        report.put("disagreements", mismatches);
        Files.createDirectories(Path.of("out"));
        JSON.writerWithDefaultPrettyPrinter().writeValue(Path.of("out/fuzz.json").toFile(), report);
        int count = mismatches.size();
        if (bindingFile.getFileName().toString().contains("mistake")) {
            boolean r08 = false;
            boolean r06 = false;
            for (JsonNode mismatch : mismatches) {
                r08 |= mismatch.path("rule").asText().startsWith("R08");
                r06 |= mismatch.path("rule").asText().startsWith("R06");
            }
            if (!r08 || !r06) throw new IllegalStateException("Mistake fuzz must expose R08 and R06; got " + mismatches);
        } else if (count != 0) {
            throw new IllegalStateException("Correct bindings have " + count + " differential disagreements");
        }
        System.out.println("fuzz total=" + total + " disagreements=" + count);
    }

    private static Domain domain(Class<?> ruleClass, Map<String, Binding> bindings) throws Exception {
        ClassNode rule = readClass(ruleClass);
        MethodNode execute = rule.methods.stream().filter(method -> method.name.equals("execute")).findFirst()
            .orElseThrow(() -> new IllegalStateException("Missing execute bytecode: " + ruleClass.getName()));
        LinkedHashSet<String> fieldKeys = new LinkedHashSet<>();
        LinkedHashSet<Integer> ints = new LinkedHashSet<>();
        LinkedHashSet<String> strings = new LinkedHashSet<>();
        LinkedHashSet<Double> doubles = new LinkedHashSet<>();
        Set<String> visitedGetters = new LinkedHashSet<>();
        scan(execute, ruleClass.getClassLoader(), bindings, fieldKeys, ints, strings, doubles, visitedGetters);
        MethodNode initializer = rule.methods.stream().filter(method -> method.name.equals("<clinit>"))
            .findFirst().orElse(null);
        if (initializer != null) scan(initializer, ruleClass.getClassLoader(), bindings, fieldKeys,
            ints, strings, doubles, visitedGetters);
        Map<String, List<Object>> values = new LinkedHashMap<>();
        List<Object> intDomain = integerDomain(ints);
        List<Object> doubleDomain = doubleDomain(doubles);
        for (String key : fieldKeys) {
            Binding binding = bindings.get(key);
            if (binding == null) continue;
            int delimiter = key.lastIndexOf('#');
            Class<?> owner = Class.forName(key.substring(0, delimiter));
            Field field = owner.getDeclaredField(key.substring(delimiter + 1));
            Class<?> fieldType = field.getType();
            List<Object> fieldDomain = new ArrayList<>();
            if (binding.via() != null && binding.via().equals("size")) {
                fieldDomain.add(List.of());
                fieldDomain.add(List.of("A"));
                fieldDomain.add(List.of("A", ""));
            } else if (fieldType == int.class || fieldType == Integer.class) {
                fieldDomain.addAll(intDomain);
            } else if (fieldType == double.class || fieldType == Double.class) {
                fieldDomain.addAll(doubleDomain);
            } else if (fieldType == boolean.class || fieldType == Boolean.class) {
                fieldDomain.add(false); fieldDomain.add(true);
            } else if (fieldType == String.class) {
                fieldDomain.addAll(strings);
                fieldDomain.addAll(binding.values().keySet());
                fieldDomain.add("");
                fieldDomain.add(null);
            } else {
                throw new IllegalArgumentException("No fuzz domain for " + key + " of type " + fieldType.getName());
            }
            values.put(key, new ArrayList<>(new LinkedHashSet<>(fieldDomain)));
        }
        return new Domain(values, new ArrayList<>(ints), new ArrayList<>(strings));
    }

    private static void scan(MethodNode method, ClassLoader loader, Map<String, Binding> bindings,
            Set<String> fields, Set<Integer> ints, Set<String> strings, Set<Double> doubles,
            Set<String> visited) throws Exception {
        for (AbstractInsnNode instruction : method.instructions) {
            int opcode = instruction.getOpcode();
            if (opcode >= Opcodes.ICONST_M1 && opcode <= Opcodes.ICONST_5) ints.add(opcode - Opcodes.ICONST_0);
            if (instruction instanceof IntInsnNode integer) ints.add(integer.operand);
            if (instruction instanceof LdcInsnNode constant) {
                if (constant.cst instanceof Integer value) ints.add(value);
                else if (constant.cst instanceof String value) strings.add(value);
                else if (constant.cst instanceof Double value) doubles.add(value);
                else if (constant.cst instanceof Float value) doubles.add((double) value.floatValue());
            }
            if (instruction instanceof FieldInsnNode field && opcode == Opcodes.GETFIELD) {
                String key = field.owner.replace('/', '.') + "#" + field.name;
                if (bindings.containsKey(key)) fields.add(key);
            }
            if (instruction instanceof MethodInsnNode call && call.owner.startsWith("legacy/model/")
                    && (call.name.startsWith("get") || call.name.startsWith("is"))) {
                String key = call.owner + "." + call.name + call.desc;
                if (!visited.add(key)) continue;
                Class<?> type = Class.forName(call.owner.replace('/', '.'), false, loader);
                ClassNode bytecode = readClass(type);
                MethodNode getter = bytecode.methods.stream().filter(candidate ->
                    candidate.name.equals(call.name) && candidate.desc.equals(call.desc)).findFirst()
                    .orElseThrow(() -> new IllegalStateException("Unresolved getter " + key));
                scan(getter, loader, bindings, fields, ints, strings, doubles, visited);
            }
        }
    }

    private static List<Object> integerDomain(Set<Integer> constants) {
        LinkedHashSet<Integer> values = new LinkedHashSet<>();
        values.add(0);
        for (int constant : constants) {
            if (constant != Integer.MIN_VALUE) values.add(constant - 1);
            values.add(constant);
            if (constant != Integer.MAX_VALUE) values.add(constant + 1);
        }
        return new ArrayList<>(values);
    }
    private static List<Object> doubleDomain(Set<Double> constants) {
        LinkedHashSet<Double> values = new LinkedHashSet<>();
        values.add(0.0);
        for (double constant : constants) {
            values.add(Math.nextDown(constant)); values.add(constant); values.add(Math.nextUp(constant));
        }
        return new ArrayList<>(values);
    }
    private static List<Map<String, Object>> cartesian(Map<String, List<Object>> domains, int limit) {
        List<Map<String, Object>> output = new ArrayList<>();
        expand(new ArrayList<>(domains.entrySet()), 0, new LinkedHashMap<>(), output, limit);
        return output;
    }
    private static void expand(List<Map.Entry<String, List<Object>>> fields, int at, Map<String, Object> current,
            List<Map<String, Object>> output, int limit) {
        if (output.size() >= limit) return;
        if (at == fields.size()) { output.add(new LinkedHashMap<>(current)); return; }
        Map.Entry<String, List<Object>> field = fields.get(at);
        for (Object value : field.getValue()) {
            current.put(field.getKey(), value);
            expand(fields, at + 1, current, output, limit);
        }
        current.remove(field.getKey());
    }
    private static void addSeededCases(List<Map<String, Object>> output, Map<String, List<Object>> domains,
            int count, long seed) {
        if (domains.isEmpty()) return;
        Random random = new Random(seed);
        List<String> keys = new ArrayList<>(domains.keySet());
        for (int i = 0; i < count; i++) {
            Map<String, Object> input = new LinkedHashMap<>();
            for (String key : keys) {
                List<Object> values = domains.get(key);
                input.put(key, values.get(random.nextInt(values.size())));
            }
            output.add(input);
        }
    }

    private static legacy.model.LoanApplication legacyApplication(Map<String, Object> assignment) throws Exception {
        legacy.model.Applicant applicant = new legacy.model.Applicant();
        applicant.setName("Fuzz Applicant");
        applicant.setAnnualIncome(120000);
        applicant.setCredScr(700);
        applicant.setEmpStat("E");
        applicant.setDebt(1000);
        applicant.setCountry("US");
        legacy.model.LoanApplication app = new legacy.model.LoanApplication();
        app.setAppId("F-1"); app.setApplicant(applicant); app.setAmount(40000);
        app.setTermMonths(180); app.setCollateral(false);
        for (Map.Entry<String, Object> entry : assignment.entrySet()) {
            int delimiter = entry.getKey().lastIndexOf('#');
            String owner = entry.getKey().substring(0, delimiter);
            Field field = Class.forName(owner).getDeclaredField(entry.getKey().substring(delimiter + 1));
            if (Modifier.isFinal(field.getModifiers())) throw new IllegalArgumentException("Cannot fuzz final field " + field);
            field.setAccessible(true);
            field.set(owner.endsWith("Applicant") ? applicant : app, entry.getValue());
        }
        return app;
    }

    private static LoanEvent pushForward(legacy.model.LoanApplication legacy, Map<String, Binding> active,
            Map<String, Binding> correct, int sequence) throws Exception {
        LoanEvent event = new LoanEvent();
        event.setId(legacy.getAppId());
        Applicant applicant = new Applicant();
        applicant.setApplicantId("P-FUZZ-" + sequence);
        applicant.setFullName(legacy.getApplicant().getName());
        Income income = new Income(); income.setCurrency("USD"); applicant.setIncome(income);
        Debts debts = new Debts(); applicant.setDebts(debts);
        Residence residence = new Residence(); applicant.setResidence(residence);
        event.setApplicant(applicant);
        LoanRequest request = new LoanRequest(); event.setRequest(request);
        Map<String, Integer> scores = SCORE_MAP.get();
        for (Binding binding : active.values()) {
            Object raw = readField(legacy, binding.legacy());
            switch (binding.metric()) {
                case "credit.score" -> scores.put(applicant.getApplicantId(), (Integer) raw);
                case "income.annual" -> income.setAnnual((Integer) raw);
                case "debt.monthly" -> debts.setMonthlyTotal((Integer) raw);
                case "employment" -> {
                    String mapped = binding.values().get(String.valueOf(raw));
                    applicant.setEmployment(mapped == null ? null : Employment.valueOf(mapped));
                }
                case "residence.country" -> residence.setCountryCode((String) raw);
                case "loan.principal" -> request.setPrincipal((Integer) raw);
                case "loan.term" -> request.setTermMonths((Integer) raw);
                case "loan.secured" -> request.setSecured((Boolean) raw);
                case "guarantors.count" -> {
                    int count = ((List<?>) raw).size();
                    for (int i = 0; i < count; i++) {
                        Guarantor guarantor = new Guarantor(); guarantor.setName("G" + i);
                        event.getGuarantors().add(guarantor);
                    }
                }
                default -> throw new IllegalArgumentException("Unresolved binding metric " + binding.metric());
            }
        }
        return event;
    }

    private static final ThreadLocal<Map<String, Integer>> SCORE_MAP = ThreadLocal.withInitial(LinkedHashMap::new);
    private static Object readField(legacy.model.LoanApplication app, String key) throws Exception {
        int delimiter = key.lastIndexOf('#');
        String owner = key.substring(0, delimiter);
        Field field = Class.forName(owner).getDeclaredField(key.substring(delimiter + 1));
        field.setAccessible(true);
        return field.get(owner.endsWith("Applicant") ? app.getApplicant() : app);
    }
    private static Outcome legacyOutcome(legacy.engine.Rule rule, legacy.model.LoanApplication app) {
        legacy.model.Decision decision = new legacy.model.Decision();
        try {
            rule.execute(app, decision);
            return new Outcome(decision.getCodes(), "");
        } catch (RuntimeException error) {
            return new Outcome(List.of(), error.getClass().getName());
        }
    }
    private static Outcome modernOutcome(List<RuleJson.RuleRecord> records, LoanEvent event) {
        List<ConditionRule> rules = records.stream().map(RuleJson.RuleRecord::conditionRule).toList();
        Services services = new Services(applicantId -> {
            Integer score = SCORE_MAP.get().get(applicantId);
            if (score == null) throw new IllegalArgumentException("Missing bureau score for " + applicantId);
            return score;
        });
        try {
            return new Outcome(Engine.evaluate(rules, event, services), "");
        } catch (RuntimeException error) {
            return new Outcome(List.of(), error.getClass().getName());
        }
    }
    private static Map<String, Binding> readBindings(Path path) throws Exception {
        JsonNode root = JSON.readTree(path.toFile());
        Map<String, Binding> result = new LinkedHashMap<>();
        for (JsonNode node : root.path("bindings")) {
            Map<String, String> values = new LinkedHashMap<>();
            node.path("values").fields().forEachRemaining(field -> values.put(field.getKey(), field.getValue().asText()));
            result.put(node.path("legacy").asText(), new Binding(node.path("legacy").asText(),
                node.path("modern").asText(), node.path("via").isMissingNode() ? null : node.path("via").asText(), values));
        }
        return result;
    }
    private static ClassNode readClass(Class<?> type) throws Exception {
        ClassNode node = new ClassNode();
        try (InputStream input = type.getClassLoader().getResourceAsStream(type.getName().replace('.', '/') + ".class")) {
            if (input == null) throw new IllegalStateException("Missing bytecode: " + type.getName());
            new ClassReader(input).accept(node, 0);
        }
        return node;
    }
}
