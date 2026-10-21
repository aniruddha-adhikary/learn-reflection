package legacy.rules;

import legacy.engine.Rule;
import legacy.model.Applicant;
import legacy.model.Decision;
import legacy.model.LoanApplication;

public class R02_DebtToIncome implements Rule {
    public void execute(LoanApplication app, Decision d) {
        Applicant a = app.getApplicant();
        if (a.getDebt() * 100 / a.getIncome() > 43) {
            d.addCode("DECLINE_DTI");
        }
    }
}
