package modern.foundation.expr;

import modern.model.LoanEvent;
import modern.services.Services;

public final class Ctx {
    private final LoanEvent event;
    private final Services services;
    public Ctx(LoanEvent event, Services services) { this.event = event; this.services = services; }
    public LoanEvent event() { return event; }
    public Services services() { return services; }
}
