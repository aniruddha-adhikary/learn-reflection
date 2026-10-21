package porter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import modern.engine.ConditionRule;
import modern.foundation.expr.*;
import modern.model.Employment;

public final class RuleJson {
    private static final ObjectMapper JSON = new ObjectMapper();
    private RuleJson() {}

    public record RuleRecord(String ruleId, String legacyRule, String family, String emit, Expr when) {
        public ConditionRule conditionRule() { return new ConditionRule(ruleId, when, emit); }
    }

    public static ObjectNode expression(Expr expr) {
        ObjectNode node = JSON.createObjectNode();
        if (expr instanceof Read value) node.put("read", value.metricId());
        else if (expr instanceof IntConst value) node.put("int", value.value());
        else if (expr instanceof StrConst value) node.put("str", value.value());
        else if (expr instanceof EnumConst value) node.put("enum", value.value().name());
        else if (expr instanceof Arith value) { node.put("arith", value.op()); node.set("l", expression(value.left())); node.set("r", expression(value.right())); }
        else if (expr instanceof Compare value) { node.put("cmp", value.op()); node.set("l", expression(value.left())); node.set("r", expression(value.right())); }
        else if (expr instanceof Equals value) {
            ArrayNode args = node.putArray("eq"); args.add(expression(value.left())); args.add(expression(value.right()));
        } else if (expr instanceof InSet value) {
            node.set("in", expression(value.value())); ArrayNode members = node.putArray("members");
            for (String member : value.values()) members.add(member);
        } else if (expr instanceof Not value) node.set("not", expression(value.value()));
        else if (expr instanceof IsTrue value) node.set("isTrue", expression(value.value()));
        else if (expr instanceof IsFalse value) node.set("isFalse", expression(value.value()));
        else if (expr instanceof And value) writeList(node.putArray("and"), value.values());
        else if (expr instanceof Or value) writeList(node.putArray("or"), value.values());
        else throw new IllegalArgumentException("Unsupported expression type: " + expr.getClass().getName());
        return node;
    }

    private static void writeList(ArrayNode array, List<Expr> values) {
        for (Expr value : values) array.add(expression(value));
    }

    public static Expr expression(JsonNode node) {
        boolean compound = node != null && (node.has("arith") || node.has("cmp") || node.has("in"));
        if (node == null || !node.isObject() || (!compound && node.size() != 1)
                || (node.has("in") && node.size() != 2)
                || ((node.has("arith") || node.has("cmp")) && node.size() != 3))
            throw new IllegalArgumentException("Malformed expression node: " + node);
        if (node.has("read")) return new Read(node.get("read").asText());
        if (node.has("int")) return new IntConst(node.get("int").intValue());
        if (node.has("str")) return new StrConst(node.get("str").textValue());
        if (node.has("enum")) return new EnumConst(Employment.valueOf(node.get("enum").asText()));
        if (node.has("arith")) return new Arith(node.get("arith").asText(), expression(node.get("l")), expression(node.get("r")));
        if (node.has("cmp")) return new Compare(node.get("cmp").asText(), expression(node.get("l")), expression(node.get("r")));
        if (node.has("eq")) return new Equals(expression(node.get("eq").get(0)), expression(node.get("eq").get(1)));
        if (node.has("in")) {
            List<String> members = new ArrayList<String>(); node.get("members").forEach(item -> members.add(item.asText()));
            return new InSet(expression(node.get("in")), members);
        }
        if (node.has("not")) return new Not(expression(node.get("not")));
        if (node.has("isTrue")) return new IsTrue(expression(node.get("isTrue")));
        if (node.has("isFalse")) return new IsFalse(expression(node.get("isFalse")));
        if (node.has("and") || node.has("or")) {
            List<Expr> values = new ArrayList<Expr>(); node.elements().next().forEach(item -> values.add(expression(item)));
            return node.has("and") ? new And(values) : new Or(values);
        }
        throw new IllegalArgumentException("Unknown expression node: " + node);
    }

    public static ObjectNode json(RuleRecord record) {
        ObjectNode node = JSON.createObjectNode();
        node.put("ruleId", record.ruleId()); node.put("legacyRule", record.legacyRule());
        node.put("family", record.family()); node.put("emit", record.emit());
        node.set("when", expression(record.when()));
        return node;
    }

    public static void write(Path path, List<RuleRecord> records) throws IOException {
        Files.createDirectories(path.getParent());
        ArrayNode array = JSON.createArrayNode();
        for (RuleRecord record : records) array.add(json(record));
        JSON.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), array);
    }

    public static List<RuleRecord> readRecords(Path path) throws IOException {
        JsonNode root = JSON.readTree(path.toFile());
        if (!root.isArray()) throw new IllegalArgumentException("Rules JSON must be an array: " + path);
        List<RuleRecord> records = new ArrayList<RuleRecord>();
        for (JsonNode node : root) {
            records.add(new RuleRecord(required(node, "ruleId"), required(node, "legacyRule"),
                required(node, "family"), required(node, "emit"), expression(node.get("when"))));
        }
        return records;
    }

    public static List<ConditionRule> read(Path path) throws IOException {
        List<ConditionRule> result = new ArrayList<ConditionRule>();
        for (RuleRecord record : readRecords(path)) result.add(record.conditionRule());
        return result;
    }

    private static String required(JsonNode node, String name) {
        JsonNode value = node.get(name);
        if (value == null || !value.isTextual()) throw new IllegalArgumentException("Missing text field " + name);
        return value.asText();
    }
}
