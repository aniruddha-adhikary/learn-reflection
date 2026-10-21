package legacy.engine;

import legacy.model.Decision;
import legacy.model.LoanApplication;

public interface Rule {
    void execute(LoanApplication app, Decision d);
}
