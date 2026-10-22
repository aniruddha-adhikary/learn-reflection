package lab;

import java.util.ArrayList;
import java.util.List;

import legacy.engine.Rule;
import legacy.model.Applicant;
import legacy.model.Decision;
import legacy.model.LoanApplication;
import legacy.rules.R01_MinimumScore;

public final class Main {
    private Main() {}

    public static void main(String[] args) {
        boolean completed = true;
        completed &= runExercise("TODO: exercise 1 - see README", () -> {
            System.out.println("Applicant fields:");
            FieldDumper.dump(Applicant.class).forEach(System.out::println);
        });
        completed &= runExercise("TODO: exercise 2 - see README", () -> {
            System.out.println("Rule implementors:");
            RuleFinder.implementors(Rule.class, ClassIndex.legacyClassNames()).forEach(System.out::println);
        });
        completed &= runExercise("TODO: exercise 3 - see README", () -> {
            Applicant applicant = new Applicant();
            applicant.setName("Ada Lovelace");
            applicant.setAnnualIncome(36000);
            applicant.setCredScr(575);
            applicant.setEmpStat("E");
            applicant.setDebt(100);
            applicant.setCountry("XA");

            LoanApplication application = new LoanApplication();
            application.setAppId("A-1002");
            application.setApplicant(applicant);
            application.setAmount(120000);
            application.setTermMonths(240);
            application.setCollateral(true);

            Decision decision = new Decision();
            List<String> log = new ArrayList<>();
            Rule proxy = RecordingProxy.record(Rule.class, new R01_MinimumScore(), log);
            proxy.execute(application, decision);

            System.out.println("Proxy log:");
            log.forEach(System.out::println);
            System.out.println("Decision codes:");
            decision.getCodes().forEach(System.out::println);
        });
        if (!completed) System.exit(1);
    }

    private static boolean runExercise(String fallback, Exercise exercise) {
        try {
            exercise.run();
            return true;
        } catch (UnsupportedOperationException todo) {
            System.err.println(todo.getMessage() == null ? fallback : todo.getMessage());
        } catch (Exception error) {
            System.err.println("Reflection lab failed: " + error.getMessage());
        }
        return false;
    }

    @FunctionalInterface
    private interface Exercise {
        void run() throws Exception;
    }
}
