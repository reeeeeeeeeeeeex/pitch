plugins { kotlin("jvm") }
kotlin { jvmToolchain(17) }
dependencies {
    implementation("com.google.code.gson:gson:2.11.0")
    testImplementation(kotlin("test"))
    testImplementation("junit:junit:4.13.2")
}
tasks.test { testLogging { events("failed", "skipped", "passed") } }
