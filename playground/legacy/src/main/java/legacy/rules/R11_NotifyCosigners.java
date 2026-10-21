package legacy.rules;

import legacy.engine.Rule;
import legacy.model.Decision;
import legacy.model.LoanApplication;

public class R11_NotifyCosigners implements Rule {
    public void execute(LoanApplication app, Decision d) {
        for (String name : app.getCoSigners()) {
            if (!name.isEmpty()) {
                d.getReferrals().add(name);
            }
        }
    }
}
