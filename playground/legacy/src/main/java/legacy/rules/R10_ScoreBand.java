package legacy.rules;

import legacy.engine.Rule;
import legacy.model.Decision;
import legacy.model.LoanApplication;

public class R10_ScoreBand implements Rule {
    public void execute(LoanApplication app, Decision d) {
        int s = app.getApplicant().getCredScr();
        if (s >= 700) {
            d.addCode("BAND_A");
        } else if (s >= 620) {
            d.addCode("BAND_B");
        } else {
            d.addCode("BAND_C");
        }
    }
}
