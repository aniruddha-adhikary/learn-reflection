package modern.foundation.expr;

public final class IsFalse implements Expr {
    private final Expr value;
    public IsFalse(Expr value) { this.value = value; }
    public Expr value() { return value; }
    public Object eval(Ctx context) { return !((Boolean) value.eval(context)); }
}
