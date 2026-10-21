package porter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Comparator;
import modern.foundation.expr.*;
import modern.model.Employment;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;
import org.objectweb.asm.tree.*;
import org.objectweb.asm.util.Printer;

public final class TransformCommand {
    private static final ObjectMapper JSON = new ObjectMapper();
    private TransformCommand() {}

    private record Binding(String modern, String via, Map<String, String> values) {}
    private record Value(Expr expr, String reference, List<String> members) {
        static Value expr(Expr expression) { return new Value(expression, null, null); }
        static Value ref(String reference) { return new Value(null, reference, null); }
        static Value set(List<String> members) { return new Value(null, "set", members); }
    }
    private record Emission(int pc, String code, List<Expr> conditions) {}
    private record State(int pc, List<Value> stack, Map<Integer, Value> locals, List<Expr> conditions) {}
    private static final class Finding {
        final String rule;
        final String reason;
        Finding(String rule, String reason) { this.rule = rule; this.reason = reason; }
    }

    public static List<RuleJson.RuleRecord> transform() throws Exception {
        Map<String, Binding> bindings = readBindings(Path.of("data/bindings.ai.json"));
        List<RuleJson.RuleRecord> result = new ArrayList<>();
        List<Finding> findings = new ArrayList<>();
        Map<String, List<String>> staticSets = new HashMap<>();
        for (legacy.engine.Rule rule : legacy.engine.RuleSet.all()) {
            String ruleName = rule.getClass().getSimpleName();
            ClassNode type = readClass(rule.getClass());
            MethodNode execute = type.methods.stream().filter(method -> method.name.equals("execute"))
                .findFirst().orElseThrow(() -> new IllegalStateException("Missing execute bytecode in " + ruleName));
            if (type.methods.stream().anyMatch(method -> method.name.equals("<clinit>")))
                staticSets.putAll(resolveStaticSets(type));
            List<Emission> emissions = new ArrayList<>();
            String misfit = execute(type, execute, ruleName, bindings, staticSets, emissions);
            if (misfit != null) {
                findings.add(new Finding(ruleName, misfit));
                continue;
            }
            emissions.sort(Comparator.comparingInt(Emission::pc));
            for (int i = 0; i < emissions.size(); i++) {
                Emission emission = emissions.get(i);
                Expr condition = conjunction(emission.conditions());
                String id = emissions.size() == 1 ? ruleName : ruleName + "#" + (i + 1);
                result.add(new RuleJson.RuleRecord(id, ruleName, family(condition), emission.code(), condition));
            }
        }
        if (result.size() != 12) throw new IllegalStateException("Expected 12 emitting paths; found " + result.size());
        RuleJson.write(Path.of("out", "rules.json"), result);
        var findingArray = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.arrayNode();
        for (Finding finding : findings) {
            findingArray.addObject().put("legacyRule", finding.rule).put("kind", "MISFIT").put("reason", finding.reason);
        }
        var root = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
        root.set("findings", findingArray);
        JSON.writerWithDefaultPrettyPrinter().writeValue(Path.of("out", "longtail.json").toFile(), root);
        return result;
    }

    private static String execute(ClassNode owner, MethodNode method, String rule,
            Map<String, Binding> bindings, Map<String, List<String>> staticSets, List<Emission> output) throws Exception {
        Map<LabelNode, Integer> labels = new HashMap<>();
        AbstractInsnNode[] instructions = method.instructions.toArray();
        for (int i = 0; i < instructions.length; i++) if (instructions[i] instanceof LabelNode label) labels.put(label, i);
        Map<Integer, Value> initialLocals = new HashMap<>();
        initialLocals.put(0, Value.ref("rule"));
        initialLocals.put(1, Value.ref("legacy.model.LoanApplication"));
        initialLocals.put(2, Value.ref("legacy.model.Decision"));
        ArrayDeque<State> pending = new ArrayDeque<>();
        pending.add(new State(0, new ArrayList<>(), initialLocals, new ArrayList<>()));
        int explored = 0;
        while (!pending.isEmpty()) {
            State state = pending.removeFirst();
            List<Value> stack = new ArrayList<>(state.stack());
            Map<Integer, Value> locals = new HashMap<>(state.locals());
            List<Expr> path = new ArrayList<>(state.conditions());
            for (int pc = state.pc(); pc < instructions.length; pc++) {
                if (++explored > 10000) return "symbolic execution exceeded 10000 instruction states";
                AbstractInsnNode insn = instructions[pc];
                int op = insn.getOpcode();
                if (op < 0) continue;
                if (insn instanceof VarInsnNode variable) {
                    int slot = variable.var;
                    switch (op) {
                        case Opcodes.ALOAD, Opcodes.ILOAD, Opcodes.LLOAD, Opcodes.FLOAD, Opcodes.DLOAD ->
                            stack.add(locals.getOrDefault(slot, Value.ref("uninitialized local " + slot)));
                        case Opcodes.ASTORE, Opcodes.ISTORE, Opcodes.LSTORE, Opcodes.FSTORE, Opcodes.DSTORE ->
                            locals.put(slot, pop(stack));
                        case Opcodes.RET -> { return "unsupported RET opcode in loop"; }
                        default -> { return "unsupported local opcode " + op; }
                    }
                    continue;
                }
                if (op >= Opcodes.ICONST_M1 && op <= Opcodes.ICONST_5) {
                    stack.add(Value.expr(new IntConst(op - Opcodes.ICONST_0))); continue;
                }
                if (insn instanceof IntInsnNode integer) { stack.add(Value.expr(new IntConst(integer.operand))); continue; }
                if (insn instanceof LdcInsnNode constant) {
                    if (constant.cst instanceof Integer integer) stack.add(Value.expr(new IntConst(integer)));
                    else if (constant.cst instanceof String text) stack.add(Value.expr(new StrConst(text)));
                    else return "unsupported LDC constant type " + constant.cst.getClass().getName();
                    continue;
                }
                if (op == Opcodes.ACONST_NULL) { stack.add(Value.expr(new StrConst(null))); continue; }
                if (insn instanceof FieldInsnNode field) {
                    if (op == Opcodes.GETSTATIC) {
                        List<String> members = staticSets.get(field.owner + "#" + field.name);
                        if (members == null) return "unresolved static field " + field.owner + "#" + field.name;
                        stack.add(Value.set(members));
                    } else if (op == Opcodes.GETFIELD) {
                        pop(stack);
                        String key = field.owner.replace('/', '.') + "#" + field.name;
                        Binding binding = bindings.get(key);
                        if (binding == null && field.owner.equals("legacy/model/LoanApplication")
                                && field.name.equals("applicant")) {
                            stack.add(Value.ref("legacy.model.Applicant"));
                            continue;
                        }
                        if (binding == null) return "unbound field read " + key;
                        if (binding.via() != null) stack.add(Value.ref("binding:" + binding.modern()));
                        else stack.add(Value.expr(new Read(binding.modern())));
                    } else return "unsupported field opcode " + op + " for " + field.owner + "." + field.name;
                    continue;
                }
                if (op == Opcodes.IADD || op == Opcodes.ISUB || op == Opcodes.IMUL || op == Opcodes.IDIV) {
                    Expr right = expression(pop(stack), rule, op);
                    Expr left = expression(pop(stack), rule, op);
                    String symbol = op == Opcodes.IADD ? "+" : op == Opcodes.ISUB ? "-" : op == Opcodes.IMUL ? "*" : "/";
                    stack.add(Value.expr(new Arith(symbol, left, right))); continue;
                }
                if (op == Opcodes.INEG) { return "unsupported INEG opcode"; }
                if (insn instanceof MethodInsnNode call) {
                    String error = invoke(call, stack, locals, path, output, owner, rule, bindings, staticSets, pc);
                    if (error != null) return error;
                    continue;
                }
                if (op == Opcodes.GOTO) {
                    JumpInsnNode jump = (JumpInsnNode) insn;
                    int target = labels.get(jump.label);
                    if (target <= pc) return "back-edge GOTO opcode indicates a loop";
                    pending.add(new State(target, stack, locals, path));
                    break;
                }
                if (insn instanceof JumpInsnNode jump) {
                    Expr condition;
                    boolean branchWhenTrue;
                    if (op >= Opcodes.IF_ICMPEQ && op <= Opcodes.IF_ICMPLE) {
                        Expr right = expression(pop(stack), rule, op);
                        Expr left = expression(pop(stack), rule, op);
                        condition = new Compare(compareOperator(op), left, right);
                        branchWhenTrue = true;
                    } else if (op >= Opcodes.IFEQ && op <= Opcodes.IFLE) {
                        Expr value = expression(pop(stack), rule, op);
                        if (op == Opcodes.IFEQ || op == Opcodes.IFNE) {
                            if (isBoolean(value)) {
                                condition = value;
                                branchWhenTrue = op == Opcodes.IFNE;
                            } else {
                                condition = new Compare(op == Opcodes.IFEQ ? "==" : "!=", value, new IntConst(0));
                                branchWhenTrue = true;
                            }
                        } else {
                            condition = new Compare(compareOperator(op), value, new IntConst(0));
                            branchWhenTrue = true;
                        }
                    } else return "unsupported branch opcode " + op;
                    int target = labels.get(jump.label);
                    if (target <= pc) return "back-edge " + opcodeName(op) + " opcode indicates a loop";
                    Expr taken = branchWhenTrue ? condition : negate(condition);
                    Expr fallthrough = branchWhenTrue ? negate(condition) : condition;
                    List<Expr> branchPath = new ArrayList<>(path); branchPath.add(taken);
                    List<Expr> nextPath = new ArrayList<>(path); nextPath.add(fallthrough);
                    pending.add(new State(target, new ArrayList<>(stack), new HashMap<>(locals), branchPath));
                    pending.add(new State(pc + 1, stack, locals, nextPath));
                    break;
                }
                if (op == Opcodes.RETURN || op == Opcodes.ATHROW) break;
                return "unsupported instruction opcode " + opcodeName(op);
            }
        }
        return null;
    }

    private static String invoke(MethodInsnNode call, List<Value> stack, Map<Integer, Value> locals,
            List<Expr> path, List<Emission> output, ClassNode owner, String rule,
            Map<String, Binding> bindings, Map<String, List<String>> staticSets, int pc) throws Exception {
        Type[] args = Type.getArgumentTypes(call.desc);
        Value[] values = new Value[args.length];
        for (int i = args.length - 1; i >= 0; i--) values[i] = pop(stack);
        Value receiver = call.getOpcode() == Opcodes.INVOKESTATIC ? null : pop(stack);
        if (call.owner.equals("legacy/model/Decision") && call.name.equals("addCode")) {
            Expr code = expression(values[0], rule, call.getOpcode());
            if (!(code instanceof StrConst text) || text.value() == null) return "Decision.addCode argument is not a string constant";
            output.add(new Emission(pc, text.value(), new ArrayList<>(path)));
            return null;
        }
        if (call.owner.startsWith("legacy/model/") && (call.name.startsWith("get") || call.name.startsWith("is"))) {
            Value result = inlineGetter(call.owner, call.name, call.desc, receiver, bindings);
            if (Type.getReturnType(call.desc).getSort() == Type.BOOLEAN && result.expr() != null)
                result = Value.expr(new IsTrue(result.expr()));
            if (Type.getReturnType(call.desc).getSort() != Type.VOID) stack.add(result);
            return null;
        }
        if (call.owner.equals("java/lang/String") && call.name.equals("equals")) {
            Expr left = expression(values[0], rule, call.getOpcode());
            Expr right = expression(receiver, rule, call.getOpcode());
            if (right instanceof StrConst text && left instanceof Read read && "employment".equals(read.metricId())) {
                Employment employment = mappedEmployment(text.value(), bindings);
                if (employment == null) return "unresolved employment value " + text.value();
                right = new EnumConst(employment);
            }
            stack.add(Value.expr(new Equals(left, right)));
            return null;
        }
        if (call.owner.equals("java/util/Set") && call.name.equals("contains")) {
            if (receiver.members() == null) return "Set.contains receiver has no resolved static Set.of values";
            stack.add(Value.expr(new InSet(expression(values[0], rule, call.getOpcode()), receiver.members())));
            return null;
        }
        if ((call.owner.equals("java/util/List") || call.owner.equals("java/util/Collection"))
                && call.name.equals("size")) {
            if (receiver.reference() == null || !receiver.reference().startsWith("binding:"))
                return "Collection.size receiver is unresolved";
            stack.add(Value.expr(new Read(receiver.reference().substring("binding:".length()))));
            return null;
        }
        if (call.name.equals("add") && (call.owner.equals("java/util/List") || call.owner.equals("java/util/Collection")))
            return "Collection.add outside Decision.addCode is an unsupported long-tail write";
        return "unsupported call " + call.owner + "." + call.name + call.desc;
    }

    private static Value inlineGetter(String owner, String name, String descriptor, Value receiver,
            Map<String, Binding> bindings) throws Exception {
        String resource = owner + ".class";
        ClassNode type = new ClassNode();
        try (InputStream input = TransformCommand.class.getClassLoader().getResourceAsStream(resource)) {
            if (input == null) throw new IllegalStateException("Missing getter bytecode " + resource);
            new ClassReader(input).accept(type, 0);
        }
        MethodNode method = type.methods.stream().filter(candidate -> candidate.name.equals(name)
            && candidate.desc.equals(descriptor)).findFirst()
            .orElseThrow(() -> new IllegalStateException("Missing getter bytecode " + owner + "." + name + descriptor));
        List<Value> stack = new ArrayList<>();
        for (AbstractInsnNode insn : method.instructions) {
            int op = insn.getOpcode();
            if (op < 0) continue;
            if (insn instanceof VarInsnNode variable && variable.var == 0 && op == Opcodes.ALOAD) {
                stack.add(receiver); continue;
            }
            if (insn instanceof FieldInsnNode field && op == Opcodes.GETFIELD) {
                pop(stack);
                String key = field.owner.replace('/', '.') + "#" + field.name;
                Binding binding = bindings.get(key);
                if (binding == null && field.owner.equals("legacy/model/LoanApplication")
                        && field.name.equals("applicant")) {
                    stack.add(Value.ref("legacy.model.Applicant"));
                    continue;
                }
                if (binding == null) throw new IllegalArgumentException("Unbound field in getter: " + key);
                stack.add(binding.via() == null ? Value.expr(new Read(binding.modern()))
                    : Value.ref("binding:" + binding.modern()));
                continue;
            }
            if (op >= Opcodes.ICONST_M1 && op <= Opcodes.ICONST_5) {
                stack.add(Value.expr(new IntConst(op - Opcodes.ICONST_0))); continue;
            }
            if (insn instanceof IntInsnNode integer) { stack.add(Value.expr(new IntConst(integer.operand))); continue; }
            if (op == Opcodes.IDIV || op == Opcodes.IMUL || op == Opcodes.IADD || op == Opcodes.ISUB) {
                Expr right = expression(pop(stack), name, op);
                Expr left = expression(pop(stack), name, op);
                stack.add(Value.expr(new Arith(op == Opcodes.IDIV ? "/" : op == Opcodes.IMUL ? "*" : op == Opcodes.IADD ? "+" : "-", left, right)));
                continue;
            }
            if (op == Opcodes.IRETURN || op == Opcodes.ARETURN) return stack.isEmpty()
                ? Value.ref("empty getter result") : stack.get(stack.size() - 1);
            if (op == Opcodes.I2B || op == Opcodes.I2C || op == Opcodes.I2S || op == Opcodes.CHECKCAST) continue;
            throw new IllegalArgumentException("Unsupported getter instruction " + opcodeName(op)
                + " in " + owner + "." + name);
        }
        throw new IllegalArgumentException("Getter did not return: " + owner + "." + name);
    }

    private static Map<String, List<String>> resolveStaticSets(ClassNode type) {
        Map<String, List<String>> result = new HashMap<>();
        MethodNode initializer = type.methods.stream().filter(method -> method.name.equals("<clinit>"))
            .findFirst().orElseThrow(() -> new IllegalStateException("Static set field lacks <clinit>"));
        List<Object> stack = new ArrayList<>();
        List<String> literals = new ArrayList<>();
        for (AbstractInsnNode insn : initializer.instructions)
            if (insn instanceof LdcInsnNode constant && constant.cst instanceof String text) literals.add(text);
        for (AbstractInsnNode insn : initializer.instructions) {
            int opcode = insn.getOpcode();
            if (opcode < 0) continue;
            if (opcode >= Opcodes.ICONST_M1 && opcode <= Opcodes.ICONST_5) {
                stack.add(opcode - Opcodes.ICONST_0);
            } else if (insn instanceof IntInsnNode integer) {
                stack.add(integer.operand);
            } else if (insn instanceof LdcInsnNode constant && constant.cst instanceof String text) {
                stack.add(text);
            } else if (opcode == Opcodes.ANEWARRAY) {
                int length = (Integer) stack.remove(stack.size() - 1);
                stack.add(new String[length]);
            } else if (opcode == Opcodes.DUP) {
                stack.add(stack.get(stack.size() - 1));
            } else if (opcode == Opcodes.AASTORE) {
                String value = (String) stack.remove(stack.size() - 1);
                int index = (Integer) stack.remove(stack.size() - 1);
                String[] array = (String[]) stack.remove(stack.size() - 1);
                array[index] = value;
            } else if (insn instanceof MethodInsnNode call && call.getOpcode() == Opcodes.INVOKESTATIC
                    && call.owner.equals("java/util/Set") && call.name.equals("of")) {
                Object input = stack.remove(stack.size() - 1);
                List<String> members = new ArrayList<>();
                if (input instanceof String[] array) {
                    for (String value : array) {
                        if (value == null) throw new IllegalArgumentException("Null member in static Set.of");
                        members.add(value);
                    }
                } else if (input instanceof String value) {
                    members.add(value);
                } else {
                    throw new IllegalArgumentException("Unsupported Set.of initializer argument " + input);
                }
                stack.add(members);
            } else if (insn instanceof FieldInsnNode field && opcode == Opcodes.PUTSTATIC) {
                Object value = stack.remove(stack.size() - 1);
                if (!(value instanceof List<?> members))
                    throw new IllegalArgumentException("Unresolved static Set.of field " + field.name);
                List<String> strings = new ArrayList<>();
                for (Object member : members) strings.add((String) member);
                if (strings.size() < literals.size()) strings = new ArrayList<>(literals);
                result.put(field.owner + "#" + field.name, strings);
            } else if (opcode == Opcodes.POP) {
                stack.remove(stack.size() - 1);
            } else if (opcode != Opcodes.RETURN) {
                throw new IllegalArgumentException("Unsupported <clinit> opcode " + opcodeName(opcode)
                    + " in " + type.name);
            }
        }
        return result;
    }

    private static Map<String, Binding> readBindings(Path path) throws Exception {
        JsonNode root = JSON.readTree(path.toFile());
        Map<String, Binding> result = new LinkedHashMap<>();
        for (JsonNode node : root.path("bindings")) {
            Map<String, String> values = new LinkedHashMap<>();
            node.path("values").fields().forEachRemaining(entry -> values.put(entry.getKey(), entry.getValue().asText()));
            result.put(node.path("legacy").asText(), new Binding(node.path("modern").asText(),
                node.path("via").isMissingNode() ? null : node.path("via").asText(), values));
        }
        return result;
    }

    private static Employment mappedEmployment(String code, Map<String, Binding> bindings) {
        Binding binding = bindings.values().stream().filter(candidate -> !candidate.values().isEmpty())
            .findFirst().orElseThrow(() -> new IllegalArgumentException("No value binding for employment codes"));
        String value = binding.values().get(code);
        return value == null ? null : Employment.valueOf(value);
    }
    private static ClassNode readClass(Class<?> type) throws Exception {
        ClassNode node = new ClassNode();
        try (InputStream input = type.getClassLoader().getResourceAsStream(type.getName().replace('.', '/') + ".class")) {
            if (input == null) throw new IllegalStateException("Missing bytecode for " + type.getName());
            new ClassReader(input).accept(node, 0);
        }
        return node;
    }
    private static Value pop(List<Value> stack) {
        if (stack.isEmpty()) throw new IllegalArgumentException("Symbolic operand stack underflow");
        return stack.remove(stack.size() - 1);
    }
    private static Expr expression(Value value, String rule, int opcode) {
        if (value.expr() != null) return value.expr();
        throw new IllegalArgumentException("Unresolved symbolic value " + value.reference() + " in " + rule
            + " at opcode " + (opcode >= 0 ? opcodeName(opcode) : opcode));
    }
    private static String compareOperator(int opcode) {
        return switch (opcode) {
            case Opcodes.IF_ICMPEQ, Opcodes.IFEQ -> "==";
            case Opcodes.IF_ICMPNE, Opcodes.IFNE -> "!=";
            case Opcodes.IF_ICMPLT, Opcodes.IFLT -> "<";
            case Opcodes.IF_ICMPGE, Opcodes.IFGE -> ">=";
            case Opcodes.IF_ICMPGT, Opcodes.IFGT -> ">";
            case Opcodes.IF_ICMPLE, Opcodes.IFLE -> "<=";
            default -> throw new IllegalArgumentException("Not a comparison opcode: " + opcode);
        };
    }
    private static boolean isBoolean(Expr expr) {
        return expr instanceof Compare || expr instanceof Equals || expr instanceof InSet || expr instanceof And
            || expr instanceof Or || expr instanceof Not || expr instanceof IsTrue || expr instanceof IsFalse;
    }
    private static Expr negate(Expr expr) {
        if (expr instanceof Compare compare) {
            String inverse = switch (compare.op()) {
                case "<" -> ">="; case "<=" -> ">"; case ">" -> "<="; case ">=" -> "<";
                case "==" -> "!="; case "!=" -> "=="; default -> throw new IllegalArgumentException(compare.op());
            };
            return new Compare(inverse, compare.left(), compare.right());
        }
        if (expr instanceof IsTrue value) return new IsFalse(value.value());
        if (expr instanceof IsFalse value) return new IsTrue(value.value());
        return new Not(expr);
    }
    private static Expr conjunction(List<Expr> expressions) {
        List<Expr> flat = new ArrayList<>();
        for (Expr expr : expressions) {
            if (expr instanceof And and) flat.addAll(and.values());
            else flat.add(expr);
        }
        return flat.size() == 1 ? flat.get(0) : new And(flat);
    }
    private static String family(Expr expr) {
        if (expr instanceof Compare compare) return "cmp(" + shape(compare.left()) + "," + shape(compare.right()) + ")";
        if (expr instanceof And and) return "and(" + String.join(",", and.values().stream().map(TransformCommand::family).toList()) + ")";
        if (expr instanceof Equals equals) return "eq(" + shape(equals.left()) + "," + shape(equals.right()) + ")";
        if (expr instanceof InSet in) return "in(" + shape(in.value()) + ")";
        if (expr instanceof IsFalse value) return "not(" + shape(value.value()) + ")";
        if (expr instanceof Not not) return "not(" + shape(not.value()) + ")";
        return shape(expr);
    }
    private static String shape(Expr expr) {
        if (expr instanceof Read) return "read";
        if (expr instanceof IntConst) return "int";
        if (expr instanceof EnumConst) return "enum";
        if (expr instanceof StrConst) return "str";
        if (expr instanceof Compare) return "cmp";
        if (expr instanceof Equals) return "eq";
        if (expr instanceof IsFalse || expr instanceof Not) return "not";
        return expr.getClass().getSimpleName().toLowerCase();
    }
    private static String opcodeName(int opcode) {
        return opcode >= 0 && opcode < Printer.OPCODES.length ? Printer.OPCODES[opcode] : "opcode-" + opcode;
    }
}
