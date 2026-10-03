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
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
    }

    // One fixed key for every build, so a new APK installs as an update over the old one.
    // The key is not in the repo: CI writes it from the HOKM_KEYSTORE_BASE64 secret.
    val ksFile = file(System.getenv("HOKM_KEYSTORE_FILE") ?: "hokm-release.keystore")
    val ksPass = System.getenv("HOKM_KEYSTORE_PASSWORD") ?: ""
    signingConfigs {
        create("hokm") {
            storeFile = ksFile
            storePassword = ksPass
            keyAlias = "hokm"
            keyPassword = ksPass
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (ksFile.exists()) signingConfig = signingConfigs.getByName("hokm")
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
