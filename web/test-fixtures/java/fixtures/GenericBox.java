package fixtures;

import java.util.List;

public class GenericBox<T extends Number> {
  private final List<T> values;

  public GenericBox(List<T> values) {
    this.values = values;
  }

  public List<T> getValues() {
    return values;
  }
}
