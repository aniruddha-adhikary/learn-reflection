package legacy.model;

import java.util.ArrayList;
import java.util.List;

public class LoanApplication {
    private String appId;
    private Applicant applicant;
    private int amount;
    private int termMonths;
    private boolean collateral;
    private List<String> coSigners = new ArrayList<String>();

    public String getAppId() { return appId; }
    public void setAppId(String appId) { this.appId = appId; }

    public Applicant getApplicant() { return applicant; }
    public void setApplicant(Applicant applicant) { this.applicant = applicant; }

    public int getAmount() { return amount; }
    public void setAmount(int amount) { this.amount = amount; }

    public int getTermMonths() { return termMonths; }
    public void setTermMonths(int termMonths) { this.termMonths = termMonths; }

    public boolean isCollateral() { return collateral; }
    public void setCollateral(boolean collateral) { this.collateral = collateral; }

    public List<String> getCoSigners() { return coSigners; }
}
