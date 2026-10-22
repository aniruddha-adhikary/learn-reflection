package lab;

import java.lang.instrument.Instrumentation;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;
import legacy.model.Decision;
import legacy.model.LoanApplication;
import net.bytebuddy.agent.builder.AgentBuilder;
import net.bytebuddy.agent.builder.ResettableClassFileTransformer;
import net.bytebuddy.asm.Advice;
import net.bytebuddy.implementation.bytecode.assign.Assigner;
import net.bytebuddy.utility.JavaModule;

import static net.bytebuddy.matcher.ElementMatchers.isStatic;
import static net.bytebuddy.matcher.ElementMatchers.named;

public final class TrafficAgent {
    private static ResettableClassFileTransformer transformer;

    private TrafficAgent() {}

    public static synchronized void install(Instrumentation instrumentation) {
        if (instrumentation == null) throw new IllegalArgumentException("Instrumentation must not be null");
        if (transformer != null) throw new IllegalStateException("TrafficAgent is already installed");
        List<Throwable> errors = Collections.synchronizedList(new ArrayList<>());
        AgentBuilder.Listener listener = new AgentBuilder.Listener.Adapter() {
            @Override
            public void onError(String typeName, ClassLoader classLoader, JavaModule module, boolean loaded, Throwable error) {
                errors.add(error);
            }
        };
        ResettableClassFileTransformer installed;
        try {
            installed = new AgentBuilder.Default()
            .disableClassFormatChanges()
            .with(AgentBuilder.RedefinitionStrategy.RETRANSFORMATION)
            .with(AgentBuilder.RedefinitionStrategy.Listener.ErrorEscalating.FAIL_FAST)
            .with(listener)
            .type(named("legacy.engine.RuleRunner"))
            .transform((builder, type, loader, module, protectionDomain) ->
                builder.visit(Advice.to(RuleRunnerAdvice.class).on(named("run").and(isStatic()))))
            .installOn(instrumentation);
        } catch (RuntimeException failure) {
            String details = describe(errors);
            throw new IllegalStateException(
                "Failed to install TrafficAgent: " + details + (details.isEmpty() ? "" : "; ") + failure,
                failure
            );
        }
        if (!errors.isEmpty()) {
            if (!installed.reset(instrumentation, AgentBuilder.RedefinitionStrategy.RETRANSFORMATION)) {
                errors.add(new IllegalStateException("Could not reset failed TrafficAgent transformer"));
            }
            throw new IllegalStateException("Failed to install TrafficAgent: " + describe(errors));
        }
        transformer = installed;
    }

    public static synchronized void uninstall(Instrumentation instrumentation) {
        if (instrumentation == null) throw new IllegalArgumentException("Instrumentation must not be null");
        if (transformer == null) throw new IllegalStateException("TrafficAgent is not installed");
        if (!transformer.reset(instrumentation, AgentBuilder.RedefinitionStrategy.RETRANSFORMATION)) {
            throw new IllegalStateException("Failed to uninstall TrafficAgent transformer");
        }
        transformer = null;
    }

    private static String describe(List<Throwable> errors) {
        return errors.stream()
            .map(error -> error.getClass().getName() + ": " + error.getMessage())
            .collect(Collectors.joining("; "));
    }

    public static final class RuleRunnerAdvice {
        private RuleRunnerAdvice() {}

        @Advice.OnMethodExit(onThrowable = Throwable.class)
        public static void onExit(
            @Advice.Argument(0) LoanApplication application,
            @Advice.Return(typing = Assigner.Typing.DYNAMIC) Decision decision,
            @Advice.Thrown Throwable thrown
        ) {
            TrafficLog.record(
                application.getAppId(),
                decision == null ? java.util.List.of() : decision.getCodes(),
                decision == null ? java.util.List.of() : decision.getReferrals(),
                thrown == null ? null : thrown.getClass().getSimpleName() + ": " + thrown.getMessage()
            );
        }
    }
}
