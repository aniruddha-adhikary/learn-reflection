package modern.model;

public class LoanRequest {
    private int principal;
    private int termMonths;
    private boolean secured;
    public LoanRequest() {}
    public int getPrincipal() { return principal; }
    public void setPrincipal(int principal) { this.principal = principal; }
    public int getTermMonths() { return termMonths; }
    public void setTermMonths(int termMonths) { this.termMonths = termMonths; }
    public boolean isSecured() { return secured; }
    public void setSecured(boolean secured) { this.secured = secured; }
}
