package legacy.batch;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import legacy.model.Applicant;
import legacy.model.LoanApplication;

public final class CsvLoader {
    private static final Set<String> COLUMNS = Set.of(
        "APP_ID", "APPL_NAME", "ANNUAL_INC", "CRED_SCR", "EMP_STAT", "DEBT_MO",
        "CNTRY", "LOAN_AMT", "TERM_MO", "COLLAT", "CO_SIGNERS"
    );

    private CsvLoader() {}

    public static void validateHeader(String[] header) {
        Set<String> seen = new HashSet<String>();
        for (String column : header) {
            if (!COLUMNS.contains(column)) throw new IllegalArgumentException("Unknown CSV column: " + column);
            if (!seen.add(column)) throw new IllegalArgumentException("Duplicate CSV column: " + column);
        }
        if (!seen.equals(COLUMNS)) {
            Set<String> missing = new HashSet<String>(COLUMNS);
            missing.removeAll(seen);
            throw new IllegalArgumentException("Missing CSV columns: " + missing);
        }
    }

    public static LoanApplication toApplication(String[] header, String[] row) {
        validateHeader(header);
        if (header.length != row.length) {
            throw new IllegalArgumentException("CSV row has " + row.length + " cells; expected " + header.length);
        }
        Map<String, String> values = new HashMap<String, String>();
        for (int index = 0; index < header.length; index++) values.put(header[index], row[index]);
        Applicant applicant = new Applicant();
        applicant.setName(values.get("APPL_NAME"));
        applicant.setAnnualIncome(Integer.parseInt(values.get("ANNUAL_INC")));
        applicant.setCredScr(Integer.parseInt(values.get("CRED_SCR")));
        applicant.setEmpStat(emptyToNull(values.get("EMP_STAT")));
        applicant.setDebt(Integer.parseInt(values.get("DEBT_MO")));
        applicant.setCountry(emptyToNull(values.get("CNTRY")));

        LoanApplication application = new LoanApplication();
        application.setAppId(values.get("APP_ID"));
        application.setApplicant(applicant);
        application.setAmount(Integer.parseInt(values.get("LOAN_AMT")));
        application.setTermMonths(Integer.parseInt(values.get("TERM_MO")));
        application.setCollateral("Y".equals(values.get("COLLAT")));
        application.getCoSigners().addAll(parseNames(values.get("CO_SIGNERS")));
        return application;
    }

    private static String emptyToNull(String value) {
        return value.isEmpty() ? null : value;
    }

    private static List<String> parseNames(String input) {
        List<String> names = new java.util.ArrayList<String>();
        if (input.isEmpty()) return names;
        StringBuilder name = new StringBuilder();
        for (int index = 0; index <= input.length(); index++) {
            if (index == input.length() || input.charAt(index) == ';') {
                names.add(name.toString());
                name.setLength(0);
            } else {
                name.append(input.charAt(index));
            }
        }
        return names;
    }
}
