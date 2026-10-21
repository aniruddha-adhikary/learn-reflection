package modern.engine;

import java.util.ArrayList;
import java.util.List;
import modern.foundation.expr.Ctx;
import modern.model.LoanEvent;
import modern.services.Services;

public class Engine {
    public static List<String> evaluate(List<ConditionRule> rules, LoanEvent event, Services services) {
        List<String> codes = new ArrayList<String>();
        Ctx context = new Ctx(event, services);
        for (ConditionRule rule : rules) {
            if ((Boolean) rule.condition().eval(context)) codes.add(rule.code());
        }
        return codes;
    }
}
