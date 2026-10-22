package lab;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.List;

public final class FieldDumper {
    private FieldDumper() {}

    public static List<String> dump(Class<?> type) {
        List<String> lines = new ArrayList<>();
        for (Field field : type.getDeclaredFields()) {
            lines.add(
                Modifier.toString(field.getModifiers())
                    + " " + field.getType().getTypeName()
                    + " " + field.getName()
            );
        }
        return lines;
    }
}
