package legacy.rules;

import java.util.Set;
import legacy.engine.Rule;
import legacy.model.Decision;
import legacy.model.LoanApplication;

public class R05_RestrictedCountry implements Rule {
    private static final Set<String> RESTRICTED = Set.of("XA", "XB");

    public void execute(LoanApplication app, Decision d) {
        if (RESTRICTED.contains(app.getApplicant().getCountry())) {
            d.addCode("REFER_SANCTIONS_CHECK");
        }
    }
}
