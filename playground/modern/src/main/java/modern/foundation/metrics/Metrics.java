package modern.foundation.metrics;

import modern.model.LoanEvent;
import modern.services.Services;

public final class Metrics {
    private Metrics() {}

    public static Metric byId(String id) {
        if ("credit.score".equals(id)) return new CreditScore();
        if ("income.annual".equals(id)) return new AnnualIncome();
        if ("debt.monthly".equals(id)) return new MonthlyDebt();
        if ("employment".equals(id)) return new EmploymentStatus();
        if ("residence.country".equals(id)) return new CountryCode();
        if ("loan.principal".equals(id)) return new Principal();
        if ("loan.term".equals(id)) return new TermMonths();
        if ("loan.secured".equals(id)) return new Secured();
        if ("guarantors.count".equals(id)) return new GuarantorCount();
        throw new IllegalArgumentException("Unknown metric id: " + id);
    }

    public static Metric[] all() {
        return new Metric[] {new CreditScore(), new AnnualIncome(), new MonthlyDebt(),
            new EmploymentStatus(), new CountryCode(), new Principal(), new TermMonths(), new Secured(),
            new GuarantorCount()};
    }

    public static final class CreditScore implements Metric {
        public CreditScore() {}
        public String id() { return "credit.score"; }
        public Object read(LoanEvent e, Services s) { return s.bureau().scoreFor(e.getApplicant().getApplicantId()); }
    }
    public static final class AnnualIncome implements Metric {
        public AnnualIncome() {}
        public String id() { return "income.annual"; }
        public Object read(LoanEvent e, Services s) { return e.getApplicant().getIncome().getAnnual(); }
    }
    public static final class MonthlyDebt implements Metric {
        public MonthlyDebt() {}
        public String id() { return "debt.monthly"; }
        public Object read(LoanEvent e, Services s) { return e.getApplicant().getDebts().getMonthlyTotal(); }
    }
    public static final class EmploymentStatus implements Metric {
        public EmploymentStatus() {}
        public String id() { return "employment"; }
        public Object read(LoanEvent e, Services s) { return e.getApplicant().getEmployment(); }
    }
    public static final class CountryCode implements Metric {
        public CountryCode() {}
        public String id() { return "residence.country"; }
        public Object read(LoanEvent e, Services s) { return e.getApplicant().getResidence().getCountryCode(); }
    }
    public static final class Principal implements Metric {
        public Principal() {}
        public String id() { return "loan.principal"; }
        public Object read(LoanEvent e, Services s) { return e.getRequest().getPrincipal(); }
    }
    public static final class TermMonths implements Metric {
        public TermMonths() {}
        public String id() { return "loan.term"; }
        public Object read(LoanEvent e, Services s) { return e.getRequest().getTermMonths(); }
    }
    public static final class Secured implements Metric {
        public Secured() {}
        public String id() { return "loan.secured"; }
        public Object read(LoanEvent e, Services s) { return e.getRequest().isSecured(); }
    }
    public static final class GuarantorCount implements Metric {
        public GuarantorCount() {}
        public String id() { return "guarantors.count"; }
        public Object read(LoanEvent e, Services s) { return e.getGuarantors().size(); }
    }
}
