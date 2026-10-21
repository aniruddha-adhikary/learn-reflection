package legacy.rules;

import legacy.engine.Rule;
import legacy.model.Decision;
import legacy.model.LoanApplication;

public class R04_LargeLoanCosigner implements Rule {
    public void execute(LoanApplication app, Decision d) {
        if (app.getAmount() > 500000 && app.getCoSigners().size() < 1) {
            d.addCode("REFER_COSIGNER");
        }
    }
}
