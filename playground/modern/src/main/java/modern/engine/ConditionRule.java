package modern.engine;

import modern.foundation.expr.Expr;

public final class ConditionRule {
    private final String id;
    private final Expr condition;
    private final String code;
    public ConditionRule(String id, Expr condition, String code) {
        this.id = id; this.condition = condition; this.code = code;
    }
    public String id() { return id; }
    public Expr condition() { return condition; }
    public String code() { return code; }
}
