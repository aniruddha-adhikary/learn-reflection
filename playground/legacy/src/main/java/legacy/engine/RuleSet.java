package legacy.engine;

import legacy.rules.R01_MinimumScore;
import legacy.rules.R02_DebtToIncome;
import legacy.rules.R03_Unemployed;
import legacy.rules.R04_LargeLoanCosigner;
import legacy.rules.R05_RestrictedCountry;
import legacy.rules.R06_FastTrack;
import legacy.rules.R07_MaxTerm;
import legacy.rules.R08_SelfEmployedScore;
import legacy.rules.R09_RetiredTerm;
import legacy.rules.R10_ScoreBand;
import legacy.rules.R11_NotifyCosigners;

public final class RuleSet {
    private RuleSet() {}

    public static Rule[] all() {
        return new Rule[] {
            new R01_MinimumScore(),
            new R02_DebtToIncome(),
            new R03_Unemployed(),
            new R04_LargeLoanCosigner(),
            new R05_RestrictedCountry(),
            new R06_FastTrack(),
            new R07_MaxTerm(),
            new R08_SelfEmployedScore(),
            new R09_RetiredTerm(),
            new R10_ScoreBand(),
            new R11_NotifyCosigners()
        };
    }
}
