package modern.foundation.expr;

import modern.foundation.metrics.Metric;
import modern.foundation.metrics.Metrics;

public final class Read implements Expr {
    private final Metric metric;
    public Read(String metricId) { this(Metrics.byId(metricId)); }
    public Read(Metric metric) { this.metric = metric; }
    public String metricId() { return metric.id(); }
    public Metric metric() { return metric; }
    public Object eval(Ctx context) { return metric.read(context.event(), context.services()); }
}
