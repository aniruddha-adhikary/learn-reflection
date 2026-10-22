package lab;

import java.io.IOException;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.CodeSource;
import java.util.List;
import java.util.StringJoiner;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.stream.Stream;

import legacy.engine.Rule;

public final class ClassIndex {
    private ClassIndex() {}

    public static List<String> legacyClassNames() throws IOException {
        CodeSource source = Rule.class.getProtectionDomain().getCodeSource();
        if (source == null) throw new IllegalStateException("legacy.engine.Rule has no code source");

        Path location;
        try {
            location = Path.of(source.getLocation().toURI());
        } catch (URISyntaxException error) {
            throw new IllegalStateException("Invalid legacy code-source location", error);
        }

        if (Files.isDirectory(location)) return classesInDirectory(location);
        if (Files.isRegularFile(location)
            && location.getFileName() != null
            && location.getFileName().toString().endsWith(".jar")) {
            return classesInJar(location);
        }
        throw new IllegalStateException("Legacy code source is neither a class directory nor a jar: " + location);
    }

    private static List<String> classesInDirectory(Path root) throws IOException {
        try (Stream<Path> files = Files.walk(root)) {
            return files
                .filter(Files::isRegularFile)
                .map(root::relativize)
                .map(ClassIndex::binaryName)
                .filter(name -> name != null)
                .distinct()
                .sorted()
                .toList();
        }
    }

    private static List<String> classesInJar(Path jarPath) throws IOException {
        try (JarFile jar = new JarFile(jarPath.toFile())) {
            return jar.stream()
                .filter(entry -> !entry.isDirectory())
                .map(JarEntry::getName)
                .map(Path::of)
                .map(ClassIndex::binaryName)
                .filter(name -> name != null)
                .distinct()
                .sorted()
                .toList();
        }
    }

    private static String binaryName(Path relativeClassPath) {
        Path path = relativeClassPath.normalize();
        if (path.isAbsolute() || path.getNameCount() == 0 || path.startsWith("..")) return null;
        if (path.getName(0).toString().equals("META-INF")) return null;

        Path fileName = path.getFileName();
        if (fileName == null) return null;
        String name = fileName.toString();
        if (!name.endsWith(".class")) return null;
        String simpleName = name.substring(0, name.length() - ".class".length());
        if (simpleName.equals("module-info") || simpleName.equals("package-info")) return null;

        StringJoiner binaryName = new StringJoiner(".");
        Path withoutExtension = path.resolveSibling(simpleName);
        for (Path part : withoutExtension) {
            String segment = part.toString();
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) return null;
            binaryName.add(segment);
        }
        return binaryName.toString();
    }
}
