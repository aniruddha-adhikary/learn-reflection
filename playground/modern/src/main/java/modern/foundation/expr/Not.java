package modern.foundation.expr;

public final class Not implements Expr {
    private final Expr value;
    public Not(Expr value) { this.value = value; }
    public Expr value() { return value; }
    public Object eval(Ctx context) { return !((Boolean) value.eval(context)); }
}
