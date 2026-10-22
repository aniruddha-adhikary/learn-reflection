package lab;

import java.util.ArrayList;
import java.util.List;
import java.lang.reflect.Modifier;

public final class RuleFinder {
    private RuleFinder() {}

    public static List<String> implementors(Class<?> iface, List<String> classNames) {
        List<String> found = new ArrayList<>();
        ClassLoader loader = iface.getClassLoader();
        for (String className : classNames) {
            try {
                Class<?> candidate = Class.forName(className, false, loader);
                if (iface.isAssignableFrom(candidate)
                    && !candidate.isInterface()
                    && !Modifier.isAbstract(candidate.getModifiers())) {
                    found.add(candidate.getName());
                }
            } catch (ClassNotFoundException error) {
                throw new IllegalArgumentException("Could not load class " + className, error);
            }
        }
        found.sort(String::compareTo);
        return found;
    }
}
