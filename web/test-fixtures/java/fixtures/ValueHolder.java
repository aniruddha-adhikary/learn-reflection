package fixtures;

public class ValueHolder extends BaseValue implements ValueView {
  private final int value;

  public ValueHolder(int value) {
    this.value = value;
  }

  public int getValue() {
    return value;
  }

  public String getLabel() {
    return "value";
  }
}
