package legacy.rules;

import legacy.engine.Rule;
import legacy.model.Decision;
import legacy.model.LoanApplication;

public class R07_MaxTerm implements Rule {
    public void execute(LoanApplication app, Decision d) {
        if (app.getTermMonths() > 360) {
            d.addCode("DECLINE_TERM");
        }
    }
}
