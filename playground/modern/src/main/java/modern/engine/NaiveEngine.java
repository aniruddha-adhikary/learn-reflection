package modern.engine;

import java.util.List;
import modern.foundation.metrics.Metric;
import modern.foundation.metrics.Metrics;
import modern.model.LoanEvent;
import modern.services.Services;

public final class NaiveEngine extends Engine {
    public static List<String> evaluate(List<ConditionRule> rules, LoanEvent event, Services services) {
        for (Metric metric : Metrics.all()) metric.read(event, services);
        return Engine.evaluate(rules, event, services);
    }
}
