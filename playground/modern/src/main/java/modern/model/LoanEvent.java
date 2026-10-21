package modern.model;

import java.util.ArrayList;
import java.util.List;

public class LoanEvent {
    private String id;
    private Applicant applicant;
    private LoanRequest request;
    private List<Guarantor> guarantors = new ArrayList<Guarantor>();
    public LoanEvent() {}
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public Applicant getApplicant() { return applicant; }
    public void setApplicant(Applicant applicant) { this.applicant = applicant; }
    public LoanRequest getRequest() { return request; }
    public void setRequest(LoanRequest request) { this.request = request; }
    public List<Guarantor> getGuarantors() { return guarantors; }
    public void setGuarantors(List<Guarantor> guarantors) { this.guarantors = guarantors; }
}
