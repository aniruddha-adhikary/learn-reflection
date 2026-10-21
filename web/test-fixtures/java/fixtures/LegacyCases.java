package fixtures;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Audit(
    value = "fixture",
    level = Level.DEBUG,
    numbers = {2, 3},
    detail = @Audit.Detail("nested"))
public class LegacyCases {
  public static final long LONG_LIMIT = Long.MAX_VALUE;
  public static final double FRACTION = 1.25;

  @Audit(value = "private", numbers = {9})
  private String secret = "hidden";

  public static int add(int left, int right) {
    return left + right;
  }

  public static int overflow() {
    return Integer.MAX_VALUE + 1;
  }

  public static long longMath(long value) {
    return value * 3L - 2L;
  }

  public static double doubleMath(double left, double right) {
    return left / right + left * right;
  }

  public static int tableSwitch(int value) {
    return switch (value) {
      case 0 -> 10;
      case 1 -> 20;
      case 2 -> 30;
      default -> -1;
    };
  }

  public static int lookupSwitch(int value) {
    return switch (value) {
      case -100 -> 1;
      case -1 -> 2;
      case 100 -> 3;
      case 10_000 -> 4;
      default -> -1;
    };
  }

  public static int branchMerge(boolean choose) {
    int result;
    if (choose) {
      result = 10;
    } else {
      result = 20;
    }
    return result;
  }

  public static int uncaughtDivide(int divisor) {
    return 10 / divisor;
  }

  public static int caughtDivide(int divisor) {
    try {
      return 10 / divisor;
    } catch (ArithmeticException exception) {
      return -1;
    }
  }

  public static int tryFinally(int divisor) {
    int value = 0;
    try {
      value = 10 / divisor;
    } catch (ArithmeticException exception) {
      value = -1;
    } finally {
      value++;
    }
    return value;
  }

  public static int nestedLoop(int limit) {
    int total = 0;
    for (int outer = 0; outer < limit; outer++) {
      for (int inner = 0; inner < outer; inner++) {
        total += outer;
      }
    }
    return total;
  }

  public static String nullCall(String value) {
    return value.toUpperCase();
  }

  public static Runnable lambdaFactory() {
    return () -> {};
  }

  public static int declaredException() throws java.io.IOException {
    return 17;
  }

  public static String stringOps(String value) {
    return value.trim().toUpperCase().concat("!");
  }

  public static String unsupportedNative(String value) {
    return value.substring(1);
  }

  public static String builderOps(String value, int number) {
    return new StringBuilder(value).append("-").append(number).toString();
  }

  public static int listSum(int limit) {
    List<Integer> values = new ArrayList<>();
    for (int index = 0; index < limit; index++) {
      values.add(index);
    }
    int sum = 0;
    for (int value : values) {
      sum += value;
    }
    return sum;
  }

  public static int mapValue() {
    Map<String, Integer> values = new HashMap<>();
    values.put("answer", 42);
    return values.getOrDefault("answer", 0);
  }

  public static int arrayWrite(int[] values, int index, ValueHolder holder) {
    return values[index] = holder.getValue();
  }

  public static void addValue(List<String> values, ValueHolder holder) {
    values.add(holder.getLabel());
  }

  public static String annotatedParameter(@Audit(value = "parameter") String value) {
    return value;
  }

  public String secret() {
    return secret;
  }
}
