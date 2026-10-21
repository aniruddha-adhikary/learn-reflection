package modern.foundation.expr;

import java.util.List;
import java.util.Set;

public final class InSet implements Expr {
    private final Expr value;
    private final List<String> values;
    public InSet(Expr value, List<String> values) { this.value = value; this.values = List.copyOf(values); }
    public Expr value() { return value; }
    public List<String> values() { return values; }
    public Object eval(Ctx context) {
        Object candidate = value.eval(context);
        if (candidate == null) throw new NullPointerException();
        return Set.of(values.toArray(new String[0])).contains(candidate);
    }
}
