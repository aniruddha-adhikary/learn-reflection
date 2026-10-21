package legacy.model;

public class Applicant {
    private String name;
    private int annualIncome;
    private int creditScore;
    private String empStat;
    private int monthlyDebt;
    private String country;

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public int getIncome() { return annualIncome / 12; }
    public void setAnnualIncome(int annualIncome) { this.annualIncome = annualIncome; }

    public int getCredScr() { return creditScore; }
    public void setCredScr(int creditScore) { this.creditScore = creditScore; }

    public String getEmpStat() { return empStat; }
    public void setEmpStat(String empStat) { this.empStat = empStat; }

    public int getDebt() { return monthlyDebt; }
    public void setDebt(int monthlyDebt) { this.monthlyDebt = monthlyDebt; }

    public String getCountry() { return country; }
    public void setCountry(String country) { this.country = country; }
}
