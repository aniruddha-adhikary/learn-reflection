package porter;

import static org.junit.jupiter.api.Assertions.assertThrows;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;

class ArchitectureTest {
    @Test
    void productionModulesDoNotDependOnEachOther() {
        var classes = new ClassFileImporter().importPackages("legacy", "modern");
        ArchRule legacyRule = com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses()
            .that().resideInAPackage("legacy..").should().dependOnClassesThat().resideInAnyPackage("modern..");
        ArchRule modernRule = com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses()
            .that().resideInAPackage("modern..").should().dependOnClassesThat().resideInAnyPackage("legacy..");
        legacyRule.check(classes);
        modernRule.check(classes);
    }

    @Test
    void negativeFixturesMakeBothRulesFail() {
        var fixtures = new ClassFileImporter().importPackages("archfixture");
        ArchRule legacyRule = com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses()
            .that().haveFullyQualifiedName("archfixture.LegacyDependsOnModern")
            .should().dependOnClassesThat().resideInAnyPackage("modern..");
        ArchRule modernRule = com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses()
            .that().haveFullyQualifiedName("archfixture.ModernDependsOnLegacy")
            .should().dependOnClassesThat().resideInAnyPackage("legacy..");
        assertThrows(AssertionError.class, () -> legacyRule.check(fixtures));
        assertThrows(AssertionError.class, () -> modernRule.check(fixtures));
    }
}
