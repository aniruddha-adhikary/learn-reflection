package modern.foundation.metrics;

import modern.model.LoanEvent;
import modern.services.Services;

public interface Metric {
    String id();
    Object read(LoanEvent event, Services services);
}
