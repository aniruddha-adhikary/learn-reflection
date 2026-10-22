package lab;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import legacy.engine.Rule;
import legacy.model.Applicant;
import legacy.model.Decision;
import legacy.model.LoanApplication;
import legacy.rules.R01_MinimumScore;
import org.junit.jupiter.api.Test;

class LabTest {
    @Test
    void fieldDumperReportsDeclaredFieldsInSourceOrder() {
        assertEquals(
            List.of(
                "private java.lang.String name",
                "private int annualIncome",
                "private int creditScore",
                "private java.lang.String empStat",
                "private int monthlyDebt",
                "private java.lang.String country"
            ),
            FieldDumper.dump(Applicant.class)
        );
    }

    @Test
    void ruleFinderReturnsAllElevenLegacyRules() throws Exception {
        assertEquals(
            List.of(
                "legacy.rules.R01_MinimumScore",
                "legacy.rules.R02_DebtToIncome",
                "legacy.rules.R03_Unemployed",
                "legacy.rules.R04_LargeLoanCosigner",
                "legacy.rules.R05_RestrictedCountry",
                "legacy.rules.R06_FastTrack",
                "legacy.rules.R07_MaxTerm",
                "legacy.rules.R08_SelfEmployedScore",
                "legacy.rules.R09_RetiredTerm",
                "legacy.rules.R10_ScoreBand",
                "legacy.rules.R11_NotifyCosigners"
            ),
            RuleFinder.implementors(Rule.class, ClassIndex.legacyClassNames())
        );
    }

    @Test
    void recordingProxyLogsAndDelegatesToTheRealRule() {
        Applicant applicant = new Applicant();
        applicant.setCredScr(575);
        LoanApplication application = new LoanApplication();
        application.setApplicant(applicant);
        Decision decision = new Decision();
        List<String> log = new ArrayList<>();

        Rule proxy = RecordingProxy.record(Rule.class, new R01_MinimumScore(), log);
        proxy.execute(application, decision);

        assertEquals(List.of("execute(LoanApplication, Decision)"), log);
        assertTrue(decision.getCodes().contains("DECLINE_LOW_SCORE"));
    }
}
