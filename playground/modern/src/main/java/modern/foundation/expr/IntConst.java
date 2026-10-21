package modern.foundation.expr;

public final class IntConst implements Expr {
    private final int value;
    public IntConst(int value) { this.value = value; }
    public int value() { return value; }
    public Object eval(Ctx context) { return value; }
}
