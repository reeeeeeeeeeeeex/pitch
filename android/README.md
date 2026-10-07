# 声见 Android

独立 Kotlin / Jetpack Compose 工程。Android 10+，compile/target SDK 36，JDK 17，Gradle 8.13。

使用 Android Studio 打开本目录，或设置 `JAVA_HOME`（JDK 17）及 `ANDROID_HOME`（Android SDK）后运行：

```powershell
.\gradlew.bat :core:test :app:assembleDebug :app:lintDebug
```

测试 APK：`app/build/outputs/apk/debug/app-debug.apk`。不需要网络服务或账号。

麦克风权限仅在开始采集时请求。应用进入后台或锁屏后结束采集；无需后台录音服务。
