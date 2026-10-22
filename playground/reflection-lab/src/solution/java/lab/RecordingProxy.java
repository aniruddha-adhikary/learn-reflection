package lab;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

public final class RecordingProxy {
    private RecordingProxy() {}

    public static <T> T record(Class<T> iface, T target, List<String> log) {
        InvocationHandler handler = (proxy, method, args) -> {
            String arguments = args == null
                ? ""
                : Arrays.stream(args)
                    .map(argument -> argument == null ? "null" : argument.getClass().getSimpleName())
                    .collect(Collectors.joining(", "));
            log.add(method.getName() + "(" + arguments + ")");
            try {
                return method.invoke(target, args);
            } catch (InvocationTargetException error) {
                throw error.getCause();
            }
        };
        Object proxy = Proxy.newProxyInstance(iface.getClassLoader(), new Class<?>[] { iface }, handler);
        return iface.cast(proxy);
    }
}
