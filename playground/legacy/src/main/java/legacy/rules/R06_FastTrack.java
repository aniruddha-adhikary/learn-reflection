package legacy.rules;

import legacy.engine.Rule;
import legacy.model.Applicant;
import legacy.model.Decision;
import legacy.model.LoanApplication;

public class R06_FastTrack implements Rule {
    public void execute(LoanApplication app, Decision d) {
        Applicant a = app.getApplicant();
        if (a.getCredScr() >= 760 && app.getAmount() <= 50000 && "E".equals(a.getEmpStat())) {
            d.addCode("APPROVE_FAST_TRACK");
        }
    }
}
