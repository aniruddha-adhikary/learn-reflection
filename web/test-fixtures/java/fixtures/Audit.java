package fixtures;

import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;

@Retention(RetentionPolicy.RUNTIME)
public @interface Audit {
  String value();

  Level level() default Level.INFO;

  int[] numbers() default {};

  Detail detail() default @Detail("default");

  @interface Detail {
    String value();
  }
}
