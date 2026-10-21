package modern.foundation.expr;

import modern.model.Employment;

public final class EnumConst implements Expr {
    private final Employment value;
    public EnumConst(Employment value) { this.value = value; }
    public Employment value() { return value; }
    public Object eval(Ctx context) { return value; }
}
