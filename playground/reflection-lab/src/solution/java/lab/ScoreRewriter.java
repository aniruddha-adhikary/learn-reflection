package lab;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

public final class ScoreRewriter {
    private static final String APP = "legacy/model/LoanApplication";
    private static final String APPLICANT = "legacy/model/Applicant";
    private static final String BRIDGE = "lab/bridge/CreditScores";

    private ScoreRewriter() {}

    public static byte[] rewrite(byte[] classBytes) {
        ClassReader reader = new ClassReader(classBytes);
        ClassWriter writer = new ClassWriter(reader, ClassWriter.COMPUTE_MAXS);
        reader.accept(new ClassVisitor(Opcodes.ASM9, writer) {
            @Override
            public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
                MethodVisitor delegate = super.visitMethod(access, name, descriptor, signature, exceptions);
                return new MethodVisitor(Opcodes.ASM9, delegate) {
                    private boolean pending;

                    @Override
                    public void visitMethodInsn(int opcode, String owner, String methodName, String methodDescriptor,
                            boolean isInterface) {
                        if (pending) {
                            if (opcode == Opcodes.INVOKEVIRTUAL && owner.equals(APPLICANT)
                                    && methodName.equals("getCredScr") && methodDescriptor.equals("()I")) {
                                super.visitMethodInsn(Opcodes.INVOKESTATIC, BRIDGE, "creditScore",
                                    "(Llegacy/model/LoanApplication;)I", false);
                                pending = false;
                                return;
                            }
                            flushPending();
                        }
                        if (opcode == Opcodes.INVOKEVIRTUAL && owner.equals(APP)
                                && methodName.equals("getApplicant")
                                && methodDescriptor.equals("()Llegacy/model/Applicant;")) {
                            pending = true;
                            return;
                        }
                        super.visitMethodInsn(opcode, owner, methodName, methodDescriptor, isInterface);
                    }

                    @Override public void visitInsn(int opcode) { flushPending(); super.visitInsn(opcode); }
                    @Override public void visitIntInsn(int opcode, int operand) { flushPending(); super.visitIntInsn(opcode, operand); }
                    @Override public void visitVarInsn(int opcode, int var) { flushPending(); super.visitVarInsn(opcode, var); }
                    @Override public void visitTypeInsn(int opcode, String type) { flushPending(); super.visitTypeInsn(opcode, type); }
                    @Override public void visitFieldInsn(int opcode, String owner, String name, String descriptor) {
                        flushPending(); super.visitFieldInsn(opcode, owner, name, descriptor);
                    }
                    @Override public void visitJumpInsn(int opcode, org.objectweb.asm.Label label) {
                        flushPending(); super.visitJumpInsn(opcode, label);
                    }
                    @Override public void visitLabel(org.objectweb.asm.Label label) { flushPending(); super.visitLabel(label); }
                    @Override public void visitLdcInsn(Object value) { flushPending(); super.visitLdcInsn(value); }
                    @Override public void visitIincInsn(int var, int increment) {
                        flushPending(); super.visitIincInsn(var, increment);
                    }
                    @Override public void visitInvokeDynamicInsn(String name, String descriptor,
                            org.objectweb.asm.Handle handle, Object... arguments) {
                        flushPending(); super.visitInvokeDynamicInsn(name, descriptor, handle, arguments);
                    }
                    @Override public void visitTableSwitchInsn(int min, int max, org.objectweb.asm.Label dflt,
                            org.objectweb.asm.Label... labels) {
                        flushPending(); super.visitTableSwitchInsn(min, max, dflt, labels);
                    }
                    @Override public void visitLookupSwitchInsn(org.objectweb.asm.Label dflt, int[] keys,
                            org.objectweb.asm.Label[] labels) {
                        flushPending(); super.visitLookupSwitchInsn(dflt, keys, labels);
                    }
                    @Override public void visitMultiANewArrayInsn(String descriptor, int dimensions) {
                        flushPending(); super.visitMultiANewArrayInsn(descriptor, dimensions);
                    }
                    @Override public void visitFrame(int type, int numLocal, Object[] local, int numStack, Object[] stack) {
                        flushPending(); super.visitFrame(type, numLocal, local, numStack, stack);
                    }
                    @Override public void visitLineNumber(int line, org.objectweb.asm.Label start) {
                        flushPending(); super.visitLineNumber(line, start);
                    }
                    @Override public void visitMaxs(int maxStack, int maxLocals) {
                        flushPending(); super.visitMaxs(maxStack, maxLocals);
                    }
                    @Override public void visitEnd() { flushPending(); super.visitEnd(); }

                    private void flushPending() {
                        if (!pending) return;
                        super.visitMethodInsn(Opcodes.INVOKEVIRTUAL, APP, "getApplicant",
                            "()Llegacy/model/Applicant;", false);
                        pending = false;
                    }
                };
            }
        }, 0);
        return writer.toByteArray();
    }
}
