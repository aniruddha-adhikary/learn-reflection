package modern.foundation.expr;

public final class StrConst implements Expr {
    private final String value;
    public StrConst(String value) { this.value = value; }
    public String value() { return value; }
    public Object eval(Ctx context) { return value; }
}
