package legacy.rules;

import legacy.engine.Rule;
import legacy.model.Decision;
import legacy.model.LoanApplication;

public class R09_RetiredTerm implements Rule {
    public void execute(LoanApplication app, Decision d) {
        if ("R".equals(app.getApplicant().getEmpStat()) && app.getTermMonths() > 240) {
            d.addCode("REFER_RETIRED_TERM");
        }
    }
}
