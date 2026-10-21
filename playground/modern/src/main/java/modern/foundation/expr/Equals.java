package modern.foundation.expr;

import java.util.Objects;

public final class Equals implements Expr {
    private final Expr left;
    private final Expr right;
    public Equals(Expr left, Expr right) { this.left = left; this.right = right; }
    public Expr left() { return left; }
    public Expr right() { return right; }
    public Object eval(Ctx context) { return Objects.equals(right.eval(context), left.eval(context)); }
}
