package lab;

import static net.bytebuddy.matcher.ElementMatchers.isPublic;
import static net.bytebuddy.matcher.ElementMatchers.nameStartsWith;

import java.lang.reflect.Method;
import java.util.List;
import java.util.concurrent.Callable;
import net.bytebuddy.ByteBuddy;
import net.bytebuddy.implementation.MethodDelegation;
import net.bytebuddy.implementation.bind.annotation.Origin;
import net.bytebuddy.implementation.bind.annotation.RuntimeType;
import net.bytebuddy.implementation.bind.annotation.SuperCall;

public final class GetterRecorder {
    private GetterRecorder() {}

    public static <T> T record(Class<T> type, List<String> log) {
        try {
            Class<? extends T> recordedType = new ByteBuddy()
                .subclass(type)
                .method(isPublic().and(nameStartsWith("get")))
                .intercept(MethodDelegation.to(new GetterInterceptor(log)))
                .make()
                .load(type.getClassLoader())
                .getLoaded();
            return recordedType.getDeclaredConstructor().newInstance();
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("Cannot create getter-recording subclass of " + type.getName(), error);
        }
    }

    public static final class GetterInterceptor {
        private final List<String> log;

        public GetterInterceptor(List<String> log) {
            this.log = log;
        }

        @RuntimeType
        public Object intercept(@Origin Method method, @SuperCall Callable<?> original) throws Exception {
            log.add(method.getName());
            return original.call();
        }
    }
}
