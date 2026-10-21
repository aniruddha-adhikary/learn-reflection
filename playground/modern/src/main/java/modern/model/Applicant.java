package modern.model;

public class Applicant {
    private String applicantId;
    private String fullName;
    private Income income;
    private Employment employment;
    private Debts debts;
    private Residence residence;
    public Applicant() {}
    public String getApplicantId() { return applicantId; }
    public void setApplicantId(String applicantId) { this.applicantId = applicantId; }
    public String getFullName() { return fullName; }
    public void setFullName(String fullName) { this.fullName = fullName; }
    public Income getIncome() { return income; }
    public void setIncome(Income income) { this.income = income; }
    public Employment getEmployment() { return employment; }
    public void setEmployment(Employment employment) { this.employment = employment; }
    public Debts getDebts() { return debts; }
    public void setDebts(Debts debts) { this.debts = debts; }
    public Residence getResidence() { return residence; }
    public void setResidence(Residence residence) { this.residence = residence; }
}
