package legacy.rules;

import legacy.engine.Rule;
import legacy.model.Applicant;
import legacy.model.Decision;
import legacy.model.LoanApplication;

public class R08_SelfEmployedScore implements Rule {
    public void execute(LoanApplication app, Decision d) {
        Applicant a = app.getApplicant();
        if ("S".equals(a.getEmpStat()) && a.getCredScr() < 650) {
            d.addCode("REFER_SELF_EMPLOYED");
        }
    }
}
