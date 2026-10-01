plugins {
    id("com.android.application")
}

android {
    namespace = "ir.hokm.game"
    compileSdk = 35

    defaultConfig {
        applicationId = "ir.hokm.game"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key so the APK installs right away.
            // Before publishing to a store, create your own key (Build > Generate Signed App Bundle / APK).
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}
