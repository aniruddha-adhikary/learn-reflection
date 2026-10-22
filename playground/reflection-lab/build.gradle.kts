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
    implementation(project(":modern"))
    implementation("org.ow2.asm:asm:9.7.1")
    implementation("org.ow2.asm:asm-util:9.7.1")
    implementation("net.bytebuddy:byte-buddy:1.15.11")
    implementation("net.bytebuddy:byte-buddy-agent:1.15.11")

    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
}

application {
    mainClass.set("lab.Main")
}

tasks.test {
    useJUnitPlatform()
    jvmArgs("-Djdk.attach.allowAttachSelf=true", "-XX:+EnableDynamicAgentLoading")
}

tasks.withType<JavaExec>().configureEach {
    jvmArgs("-Djdk.attach.allowAttachSelf=true", "-XX:+EnableDynamicAgentLoading")
}
