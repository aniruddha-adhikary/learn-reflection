package fixtures;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;

public final class FixtureHarness {
  private record Case(String name, Class<?>[] parameterTypes, Object[] arguments) {}

  private static final List<Case> CASES =
      List.of(
          new Case("add", new Class<?>[] {int.class, int.class}, new Object[] {2, 3}),
          new Case("overflow", new Class<?>[] {}, new Object[] {}),
          new Case("longMath", new Class<?>[] {long.class}, new Object[] {9_007_199_254_740_991L}),
          new Case("doubleMath", new Class<?>[] {double.class, double.class}, new Object[] {7.5, 2.0}),
          new Case("tableSwitch", new Class<?>[] {int.class}, new Object[] {2}),
          new Case("lookupSwitch", new Class<?>[] {int.class}, new Object[] {10_000}),
          new Case("branchMerge", new Class<?>[] {boolean.class}, new Object[] {true}),
          new Case("uncaughtDivide", new Class<?>[] {int.class}, new Object[] {0}),
          new Case("caughtDivide", new Class<?>[] {int.class}, new Object[] {0}),
          new Case("tryFinally", new Class<?>[] {int.class}, new Object[] {0}),
          new Case("nestedLoop", new Class<?>[] {int.class}, new Object[] {5}),
          new Case("nullCall", new Class<?>[] {String.class}, new Object[] {null}),
          new Case("stringOps", new Class<?>[] {String.class}, new Object[] {"  hello  "}),
          new Case("builderOps", new Class<?>[] {String.class, int.class}, new Object[] {"item", 4}),
          new Case("listSum", new Class<?>[] {int.class}, new Object[] {5}),
          new Case("mapValue", new Class<?>[] {}, new Object[] {}));
  private static final String[] METHOD_NAMES = {
    "add",
    "overflow",
    "longMath",
    "doubleMath",
    "tableSwitch",
    "lookupSwitch",
    "branchMerge",
    "uncaughtDivide",
    "caughtDivide",
    "tryFinally",
    "nestedLoop",
    "nullCall",
    "stringOps",
    "builderOps",
    "listSum",
    "mapValue"
  };

  private FixtureHarness() {}

  public static void main(String[] args) throws ReflectiveOperationException {
    StringBuilder output = new StringBuilder("[");
    for (int index = 0; index < CASES.size(); index++) {
      if (index > 0) output.append(',');
      Case testCase = CASES.get(index);
      Method method = LegacyCases.class.getMethod(testCase.name(), testCase.parameterTypes());
      output.append("{\"method\":");
      appendJson(output, METHOD_NAMES[index]);
      output.append(",\"args\":");
      appendJson(output, testCase.arguments());
      try {
        output.append(",\"result\":");
        appendJson(output, method.invoke(null, testCase.arguments()));
      } catch (InvocationTargetException exception) {
        output.setLength(output.length() - ",\"result\":".length());
        output.append(",\"threw\":");
        appendJson(output, exception.getCause().getClass().getName());
      }
      output.append('}');
    }
    output.append(']');
    System.out.println(output);
  }

  private static void appendJson(StringBuilder output, Object value) {
    if (value == null) {
      output.append("null");
    } else if (value instanceof String string) {
      output.append('"');
      for (int index = 0; index < string.length(); index++) {
        char character = string.charAt(index);
        switch (character) {
          case '"' -> output.append("\\\"");
          case '\\' -> output.append("\\\\");
          case '\n' -> output.append("\\n");
          case '\r' -> output.append("\\r");
          case '\t' -> output.append("\\t");
          default -> {
            if (character < 0x20) {
              output.append(String.format("\\u%04x", (int) character));
            } else {
              output.append(character);
            }
          }
        }
      }
      output.append('"');
    } else if (value instanceof Long longValue) {
      output.append("{\"$long\":");
      appendJson(output, longValue.toString());
      output.append('}');
    } else if (value instanceof Number || value instanceof Boolean) {
      output.append(value);
    } else if (value instanceof Object[] array) {
      output.append('[');
      for (int index = 0; index < array.length; index++) {
        if (index > 0) output.append(',');
        appendJson(output, array[index]);
      }
      output.append(']');
    } else if (value instanceof Iterable<?> iterable) {
      output.append('[');
      boolean first = true;
      for (Object item : iterable) {
        if (!first) output.append(',');
        first = false;
        appendJson(output, item);
      }
      output.append(']');
    } else if (value instanceof Map<?, ?> map) {
      output.append('{');
      boolean first = true;
      for (Map.Entry<?, ?> entry : map.entrySet()) {
        if (!first) output.append(',');
        first = false;
        appendJson(output, String.valueOf(entry.getKey()));
        output.append(':');
        appendJson(output, entry.getValue());
      }
      output.append('}');
    } else {
      appendJson(output, value.toString());
    }
  }
}
