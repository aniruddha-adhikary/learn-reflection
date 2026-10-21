package porter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import modern.foundation.metrics.Metrics;
import modern.model.Employment;

public final class GateCommand {
    private GateCommand() {}
    public static List<String> validate(Path path) throws IOException {
        JsonNode root = new ObjectMapper().readTree(path.toFile());
        List<String> errors = new ArrayList<String>();
        if (!root.isArray()) { errors.add("rules root must be an array"); return errors; }
        int index = 0;
        for (JsonNode rule : root) {
            String emit = rule.path("emit").asText("");
            if (emit.isEmpty() || !uppercaseCode(emit)) errors.add("rule[" + index + "] has invalid emit: " + emit);
            validateExpr(rule.get("when"), "rule[" + index + "].when", errors);
            index++;
        }
        return errors;
    }
    private static boolean uppercaseCode(String code) {
        for (int i = 0; i < code.length(); i++) {
            char c = code.charAt(i);
            if (!(c >= 'A' && c <= 'Z') && c != '_') return false;
        }
        return true;
    }
    private static void validateExpr(JsonNode node, String path, List<String> errors) {
        if (node == null || !node.isObject()) { errors.add(path + " is not an expression object"); return; }
        boolean compound = node.has("arith") || node.has("cmp") || node.has("in");
        if ((!compound && node.size() != 1) || (node.has("in") && node.size() != 2)
                || ((node.has("arith") || node.has("cmp")) && node.size() != 3)) {
            errors.add(path + " has multiple or unexpected node fields");
        }
        if (node.has("read")) {
            String id = node.get("read").asText();
            try { Metrics.byId(id); } catch (IllegalArgumentException e) { errors.add(path + " unknown metric " + id); }
        } else if (node.has("int") || node.has("str")) {
            return;
        } else if (node.has("enum")) {
            try { Employment.valueOf(node.get("enum").asText()); } catch (IllegalArgumentException e) {
                errors.add(path + " unknown enum " + node.get("enum").asText());
            }
        } else if (node.has("arith") || node.has("cmp")) {
            String key = node.has("arith") ? "arith" : "cmp";
            String op = node.get(key).asText();
            String allowed = key.equals("arith") ? "+-*/" : "<><=>===!=";
            if (!("+".equals(op) || "-".equals(op) || "*".equals(op) || "/".equals(op)
                    || "<".equals(op) || "<=".equals(op) || ">".equals(op) || ">=".equals(op)
                    || "==".equals(op) || "!=".equals(op))) errors.add(path + " unknown operator " + op);
            validateExpr(node.get("l"), path + ".l", errors); validateExpr(node.get("r"), path + ".r", errors);
        } else if (node.has("eq") || node.has("and") || node.has("or")) {
            JsonNode values = node.elements().next();
            if (!values.isArray()) errors.add(path + " children must be an array");
            else for (int i = 0; i < values.size(); i++) validateExpr(values.get(i), path + "[" + i + "]", errors);
        } else if (node.has("in")) {
            validateExpr(node.get("in"), path + ".in", errors);
            if (!node.path("members").isArray()) errors.add(path + ".members must be an array");
        } else if (node.has("not") || node.has("isTrue") || node.has("isFalse")) {
            String key = node.has("not") ? "not" : node.has("isTrue") ? "isTrue" : "isFalse";
            validateExpr(node.get(key), path + "." + key, errors);
        } else errors.add(path + " unknown expression kind");
    }
}
