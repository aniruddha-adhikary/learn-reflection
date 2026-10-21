plugins {
    application
}

application {
    mainClass.set("legacy.batch.BatchRunner")
}

tasks.named<JavaExec>("run") {
    workingDir = rootProject.projectDir
}
