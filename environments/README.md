# Extra environment presets

Drop a JSON file here, or in `~/.local/share/study-coach/environments/`, to add a container preset. The file name is the preset id. The fields are those of the environment editor in Track settings:

```json
{
  "label": "Kotlin + Gradle (JUnit)",
  "image": "gradle:8-jdk21",
  "setup": "",
  "manifests": ["build.gradle.kts", "settings.gradle.kts"],
  "install": "gradle --no-daemon -q -g /cache/gradle dependencies > /dev/null",
  "check": "gradle --no-daemon -q --offline -g /cache/gradle test",
  "preview": "",
  "checkNetwork": false,
  "layout": "A Gradle Kotlin project: build.gradle.kts with the kotlin(\"jvm\") plugin and JUnit 5, code in src/main/kotlin and tests in src/test/kotlin.",
  "env": { "GRADLE_OPTS": "-Dhttps.proxyHost=study-coach-egress-proxy -Dhttps.proxyPort=3128 -Dhttp.proxyHost=study-coach-egress-proxy -Dhttp.proxyPort=3128" },
  "memory": "3g",
  "cpus": 2,
  "timeoutSec": 300
}
```

Install runs with internet access through the egress proxy, and check runs offline unless `checkNetwork` is true. Most tools read the `HTTPS_PROXY` variable the app sets; JVM tools such as Gradle need the proxy as Java properties, as in `GRADLE_OPTS` above.
