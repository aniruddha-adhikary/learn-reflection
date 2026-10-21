package modern.foundation.expr;

import java.util.List;

public final class And implements Expr {
    private final List<Expr> values;
    public And(List<Expr> values) { this.values = List.copyOf(values); }
    public List<Expr> values() { return values; }
    public Object eval(Ctx context) {
        for (Expr value : values) if (!((Boolean) value.eval(context))) return false;
        return true;
    }
}
