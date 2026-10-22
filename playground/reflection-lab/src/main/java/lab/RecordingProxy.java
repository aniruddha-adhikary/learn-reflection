package lab;

import java.util.List;

public final class RecordingProxy {
    private RecordingProxy() {}

    public static <T> T record(Class<T> iface, T target, List<String> log) {
        throw new UnsupportedOperationException("TODO: exercise 3 - see README");
    }
}
