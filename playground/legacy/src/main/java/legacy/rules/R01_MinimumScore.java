package legacy.rules;

import legacy.engine.Rule;
import legacy.model.Decision;
import legacy.model.LoanApplication;

public class R01_MinimumScore implements Rule {
    public void execute(LoanApplication app, Decision d) {
        if (app.getApplicant().getCredScr() < 580) {
            d.addCode("DECLINE_LOW_SCORE");
        }
    }
}
