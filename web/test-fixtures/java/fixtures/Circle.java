package fixtures;

public final class Circle extends Shape {
  private final int radius;

  public Circle(int radius) {
    this.radius = radius;
  }

  @Override
  public int area() {
    return radius * radius * 3;
  }
}
