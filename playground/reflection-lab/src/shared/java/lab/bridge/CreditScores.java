package lab.bridge;

import legacy.model.LoanApplication;
import modern.services.CreditBureau;

public final class CreditScores {
    private static CreditBureau bureau;

    private CreditScores() {}

    public static void install(CreditBureau value) {
        if (value == null) throw new IllegalArgumentException("CreditBureau must not be null");
        bureau = value;
    }

    public static int creditScore(LoanApplication application) {
        if (bureau == null) throw new IllegalStateException("Credit bureau is not installed");
        return bureau.scoreFor(application.getAppId());
    }
}
