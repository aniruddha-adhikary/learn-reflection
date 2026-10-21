package fixtures;

public sealed class Shape permits Circle {
  public int area() {
    return 0;
  }
}
