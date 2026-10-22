package lab;

import java.util.ArrayList;
import java.util.List;

public final class TrafficLog {
    public record Entry(String appId, List<String> codes, List<String> referrals, String error) {}

    private static final List<Entry> ENTRIES = new ArrayList<>();

    private TrafficLog() {}

    public static synchronized void record(String appId, List<String> codes, List<String> referrals) {
        record(appId, codes, referrals, null);
    }

    public static synchronized void record(String appId, List<String> codes, List<String> referrals, String error) {
        ENTRIES.add(new Entry(appId, List.copyOf(codes), List.copyOf(referrals), error));
    }

    public static synchronized List<Entry> snapshot() {
        return List.copyOf(ENTRIES);
    }

    public static synchronized void clear() {
        ENTRIES.clear();
    }
}
