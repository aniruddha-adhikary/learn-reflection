package porter;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.beans.Introspector;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class FactsCommand {
    private FactsCommand() {}
    public static void run() throws Exception {
        List<Object> output = new ArrayList<Object>();
        for (Class<?> type : List.of(
                legacy.model.Applicant.class, legacy.model.LoanApplication.class, legacy.model.Decision.class,
                modern.model.Applicant.class, modern.model.LoanEvent.class, modern.model.Income.class,
                modern.model.Debts.class, modern.model.Residence.class, modern.model.LoanRequest.class,
                modern.model.Guarantor.class, modern.model.Employment.class)) {
            var record = new java.util.LinkedHashMap<String, Object>();
            record.put("class", type.getName());
            List<Map<String, String>> fields = new ArrayList<>();
            for (Field field : type.getDeclaredFields()) {
                Map<String, String> fact = new LinkedHashMap<>();
                fact.put("field", field.getName());
                fact.put("type", field.getGenericType().getTypeName());
                fact.put("modifiers", Modifier.toString(field.getModifiers()));
                fields.add(fact);
            }
            fields.sort(Comparator.comparing(field -> field.get("field")));
            record.put("fields", fields);
            List<Map<String, String>> properties = new ArrayList<>();
            for (var descriptor : Introspector.getBeanInfo(type).getPropertyDescriptors()) {
                if ("class".equals(descriptor.getName())) continue;
                Map<String, String> fact = new LinkedHashMap<>();
                fact.put("property", descriptor.getName());
                fact.put("readMethod", descriptor.getReadMethod() == null ? "" : descriptor.getReadMethod().getName());
                fact.put("writeMethod", descriptor.getWriteMethod() == null ? "" : descriptor.getWriteMethod().getName());
                properties.add(fact);
            }
            properties.sort(Comparator.comparing(property -> property.get("property")));
            record.put("properties", properties);
            output.add(record);
        }
        new ObjectMapper().writerWithDefaultPrettyPrinter().writeValue(Path.of("out/facts.json").toFile(), output);
        for (Object item : output) {
            @SuppressWarnings("unchecked")
            Map<String, Object> record = (Map<String, Object>) item;
            System.out.println(record.get("class"));
            System.out.println("  Fields");
            System.out.printf("    %-22s %-48s %-18s%n", "FIELD", "TYPE", "MODIFIERS");
            @SuppressWarnings("unchecked")
            List<Map<String, String>> fields = (List<Map<String, String>>) record.get("fields");
            for (Map<String, String> field : fields)
                System.out.printf("    %-22s %-48s %-18s%n", field.get("field"), field.get("type"), field.get("modifiers"));
            System.out.println("  Properties");
            System.out.printf("    %-22s %-24s %-24s%n", "PROPERTY", "READ METHOD", "WRITE METHOD");
            @SuppressWarnings("unchecked")
            List<Map<String, String>> properties = (List<Map<String, String>>) record.get("properties");
            for (Map<String, String> property : properties)
                System.out.printf("    %-22s %-24s %-24s%n", property.get("property"), property.get("readMethod"), property.get("writeMethod"));
        }
    }
}
