package legacy.model;

import java.util.ArrayList;
import java.util.List;

public class Decision {
    private final List<String> codes = new ArrayList<String>();
    private final List<String> referrals = new ArrayList<String>();

    public void addCode(String code) { codes.add(code); }
    public List<String> getCodes() { return codes; }
    public List<String> getReferrals() { return referrals; }
}
