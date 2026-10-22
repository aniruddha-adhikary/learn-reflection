plugins {
    application
}

val labSourceDirectory =
    if (providers.gradleProperty("lab").orNull == "solution") "src/solution/java" else "src/main/java"

sourceSets {
    main {
        java.setSrcDirs(listOf(labSourceDirectory, "src/shared/java"))
    }
}

dependencies {
    implementation(project(":legacy"))

    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
}

application {
    mainClass.set("lab.Main")
}

tasks.test {
    useJUnitPlatform()
}
