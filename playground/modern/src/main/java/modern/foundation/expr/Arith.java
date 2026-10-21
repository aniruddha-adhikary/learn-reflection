package modern.foundation.expr;

public final class Arith implements Expr {
    private final String op;
    private final Expr left;
    private final Expr right;
    public Arith(String op, Expr left, Expr right) {
        if (!("+".equals(op) || "-".equals(op) || "*".equals(op) || "/".equals(op)))
            throw new IllegalArgumentException("Unknown arithmetic operator: " + op);
        this.op = op; this.left = left; this.right = right;
    }
    public String op() { return op; }
    public Expr left() { return left; }
    public Expr right() { return right; }
    public Object eval(Ctx context) {
        int a = ((Number) left.eval(context)).intValue();
        int b = ((Number) right.eval(context)).intValue();
        if ("+".equals(op)) return a + b;
        if ("-".equals(op)) return a - b;
        if ("*".equals(op)) return a * b;
        if ("/".equals(op)) return a / b;
        throw new IllegalArgumentException("Unknown arithmetic operator: " + op);
    }
}
