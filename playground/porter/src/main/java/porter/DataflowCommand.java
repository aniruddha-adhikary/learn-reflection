package porter;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import legacy.engine.Rule;
import legacy.engine.RuleSet;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.FieldInsnNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.tree.analysis.Analyzer;
import org.objectweb.asm.tree.analysis.AnalyzerException;
import org.objectweb.asm.tree.analysis.Frame;
import org.objectweb.asm.tree.analysis.SourceInterpreter;
import org.objectweb.asm.tree.analysis.SourceValue;
import org.objectweb.asm.util.Printer;

public final class DataflowCommand {
    private DataflowCommand() {}

    private static final class ProvenanceInterpreter extends SourceInterpreter {
        ProvenanceInterpreter() { super(Opcodes.ASM9); }
        @Override public SourceValue copyOperation(AbstractInsnNode instruction, SourceValue value) {
            return value;
        }
        @Override public SourceValue unaryOperation(AbstractInsnNode instruction, SourceValue value) {
            return combine(super.unaryOperation(instruction, value), instruction, value);
        }
        @Override public SourceValue binaryOperation(AbstractInsnNode instruction, SourceValue first, SourceValue second) {
            return combine(super.binaryOperation(instruction, first, second), instruction, first, second);
        }
        @Override public SourceValue ternaryOperation(AbstractInsnNode instruction, SourceValue first,
                SourceValue second, SourceValue third) {
            return combine(super.ternaryOperation(instruction, first, second, third), instruction, first, second, third);
        }
        @Override public SourceValue naryOperation(AbstractInsnNode instruction, List<? extends SourceValue> values) {
            SourceValue base = super.naryOperation(instruction, values);
            if (base == null) return null;
            Set<AbstractInsnNode> sources = new LinkedHashSet<>(base.insns);
            sources.add(instruction);
            for (SourceValue value : values) sources.addAll(value.insns);
            return new SourceValue(base.getSize(), sources);
        }
        @Override public SourceValue merge(SourceValue first, SourceValue second) {
            if (first.equals(second)) return first;
            Set<AbstractInsnNode> sources = new LinkedHashSet<>(first.insns);
            sources.addAll(second.insns);
            return new SourceValue(Math.max(first.getSize(), second.getSize()), sources);
        }
        private static SourceValue combine(SourceValue base, AbstractInsnNode instruction, SourceValue... inputs) {
            if (base == null) return null;
            Set<AbstractInsnNode> sources = new LinkedHashSet<>(base.insns);
            sources.add(instruction);
            for (SourceValue input : inputs) if (input != null) sources.addAll(input.insns);
            return new SourceValue(base.getSize(), sources);
        }
    }

    public static void run() throws Exception {
        List<String> output = new ArrayList<>();
        List<Class<?>> models = List.of(legacy.model.Applicant.class, legacy.model.LoanApplication.class,
            legacy.model.Decision.class);
        for (Class<?> model : models) {
            ClassNode node = readClass(model);
            for (MethodNode method : node.methods) {
                if (!method.name.startsWith("get") && !method.name.startsWith("is")) continue;
                try {
                    Frame<SourceValue>[] frames = analyze(node, method);
                    for (int i = 0; i < method.instructions.size(); i++) {
                        int opcode = method.instructions.get(i).getOpcode();
                        if (opcode >= Opcodes.IRETURN && opcode <= Opcodes.ARETURN && frames[i] != null
                                && frames[i].getStackSize() > 0) {
                            SourceValue value = frames[i].getStack(frames[i].getStackSize() - 1);
                            output.add("getter " + model.getName() + "." + method.name + method.desc
                                + " returns " + sources(value));
                        }
                    }
                } catch (AnalyzerException error) {
                    output.add("FINDING unresolved getter dataflow " + model.getName() + "." + method.name
                        + ": " + error.getMessage());
                }
            }
        }

        for (Rule rule : RuleSet.all()) {
            ClassNode node = readClass(rule.getClass());
            MethodNode method = node.methods.stream().filter(candidate -> candidate.name.equals("execute"))
                .findFirst().orElseThrow(() -> new IllegalStateException("Missing execute in " + node.name));
            try {
                Frame<SourceValue>[] frames = analyze(node, method);
                for (int i = 0; i < method.instructions.size(); i++) {
                    AbstractInsnNode instruction = method.instructions.get(i);
                    if (instruction instanceof MethodInsnNode call
                            && call.owner.startsWith("legacy/model/")
                            && (call.name.startsWith("get") || call.name.startsWith("is"))) {
                        String targetName = call.owner.replace('/', '.');
                        try {
                            Class<?> target = Class.forName(targetName);
                            ClassNode getterClass = readClass(target);
                            MethodNode getter = getterClass.methods.stream().filter(candidate ->
                                candidate.name.equals(call.name) && candidate.desc.equals(call.desc))
                                .findFirst().orElseThrow(() -> new IllegalStateException(
                                    "Unresolved getter call " + call.owner + "." + call.name + call.desc));
                            output.add("rule " + rule.getClass().getSimpleName() + " getter-call "
                                + call.owner + "." + call.name + call.desc + " -> "
                                + returnedSources(getterClass, getter));
                        } catch (Exception error) {
                            output.add("FINDING unresolved getter call " + call.owner + "." + call.name
                                + call.desc + ": " + error.getMessage());
                        }
                    }
                    if (instruction instanceof MethodInsnNode call && isCollectionAdd(call)) {
                        if (frames[i] == null || frames[i].getStackSize() == 0) {
                            output.add("FINDING unresolved Collection.add argument in " + rule.getClass().getSimpleName());
                        } else {
                            SourceValue argument = frames[i].getStack(frames[i].getStackSize() - 1);
                            output.add("Collection.add " + rule.getClass().getSimpleName() + " argument <- "
                                + sources(argument));
                        }
                    }
                }
            } catch (AnalyzerException error) {
                output.add("FINDING unresolved rule dataflow " + rule.getClass().getName() + ": " + error.getMessage());
            }
        }
        new ObjectMapper().writerWithDefaultPrettyPrinter().writeValue(Path.of("out/dataflow.json").toFile(), output);
        output.forEach(System.out::println);
    }

    private static boolean isCollectionAdd(MethodInsnNode call) {
        return (call.owner.equals("java/util/List") || call.owner.equals("java/util/Collection"))
            && call.name.equals("add") && call.desc.equals("(Ljava/lang/Object;)Z");
    }
    private static String returnedSources(ClassNode owner, MethodNode method) throws AnalyzerException {
        Frame<SourceValue>[] frames = analyze(owner, method);
        List<String> values = new ArrayList<>();
        for (int i = 0; i < method.instructions.size(); i++) {
            int opcode = method.instructions.get(i).getOpcode();
            if (opcode >= Opcodes.IRETURN && opcode <= Opcodes.ARETURN && frames[i] != null
                    && frames[i].getStackSize() > 0) {
                values.addAll(sources(frames[i].getStack(frames[i].getStackSize() - 1)));
            }
        }
        return values.toString();
    }
    private static Frame<SourceValue>[] analyze(ClassNode owner, MethodNode method) throws AnalyzerException {
        return new Analyzer<SourceValue>(new ProvenanceInterpreter()).analyze(owner.name, method);
    }
    private static ClassNode readClass(Class<?> type) throws Exception {
        String resource = type.getName().replace('.', '/') + ".class";
        ClassNode node = new ClassNode();
        try (InputStream input = type.getClassLoader().getResourceAsStream(resource)) {
            if (input == null) throw new IllegalStateException("Missing class bytes: " + resource);
            new ClassReader(input).accept(node, 0);
        }
        return node;
    }
    private static List<String> sources(SourceValue value) {
        List<String> result = new ArrayList<>();
        for (AbstractInsnNode instruction : value.insns) result.add(describe(instruction));
        return result;
    }
    private static String describe(AbstractInsnNode node) {
        if (node instanceof FieldInsnNode field) return field.owner + "." + field.name;
        if (node instanceof MethodInsnNode method) return method.owner + "." + method.name;
        if (node.getOpcode() < 0) return "label";
        if (node.getOpcode() < Printer.OPCODES.length) return Printer.OPCODES[node.getOpcode()];
        return "opcode:" + node.getOpcode();
    }
}
