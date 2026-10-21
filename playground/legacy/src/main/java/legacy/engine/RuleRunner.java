package legacy.engine;

import legacy.model.Decision;
import legacy.model.LoanApplication;

public final class RuleRunner {
    private RuleRunner() {}

    public static Decision run(LoanApplication app) {
        Decision decision = new Decision();
        for (Rule rule : RuleSet.all()) {
            rule.execute(app, decision);
        }
        return decision;
    }
}
