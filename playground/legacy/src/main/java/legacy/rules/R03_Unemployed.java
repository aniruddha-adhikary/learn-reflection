package legacy.rules;

import legacy.engine.Rule;
import legacy.model.Decision;
import legacy.model.LoanApplication;

public class R03_Unemployed implements Rule {
    public void execute(LoanApplication app, Decision d) {
        if ("U".equals(app.getApplicant().getEmpStat()) && !app.isCollateral()) {
            d.addCode("REFER_UNEMPLOYED");
        }
    }
}
