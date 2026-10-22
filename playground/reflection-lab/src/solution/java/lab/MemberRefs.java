package lab;

import java.util.ArrayList;
import java.util.List;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.util.Printer;

public final class MemberRefs {
    private MemberRefs() {}

    public static List<String> of(byte[] classBytes) {
        List<String> references = new ArrayList<>();
        new ClassReader(classBytes).accept(new ClassVisitor(Opcodes.ASM9) {
            @Override
            public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
                return new MethodVisitor(Opcodes.ASM9) {
                    @Override
                    public void visitFieldInsn(int opcode, String owner, String fieldName, String fieldDescriptor) {
                        references.add(format(opcode, owner, fieldName, fieldDescriptor));
                    }

                    @Override
                    public void visitMethodInsn(int opcode, String owner, String methodName, String methodDescriptor,
                            boolean isInterface) {
                        references.add(format(opcode, owner, methodName, methodDescriptor));
                    }
                };
            }
        }, 0);
        return List.copyOf(references);
    }

    private static String format(int opcode, String owner, String name, String descriptor) {
        return Printer.OPCODES[opcode] + " " + owner + "." + name + " " + descriptor;
    }
}
