package ir.hokm.game;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/** Hosts the game (assets/index.html) in a full-screen WebView. */
public class MainActivity extends Activity {

    private static final int BG = Color.rgb(0x0E, 0x1A, 0x33);
    private WebView web;
    private FrameLayout rootView;
    private final Relay relay = new Relay();

    /** Bridge for the page: LAN relay (host side) and theme colours for the system bars. */
    private final class Native {
        @JavascriptInterface
        public int startRelay() { return relay.start(); }

        @JavascriptInterface
        public void stopRelay() { relay.stop(); }

        @JavascriptInterface
        public String ips() { return Relay.localIps(); }

        @JavascriptInterface
        public void setBg(final String hex, final boolean light) {
            runOnUiThread(() -> applyBg(hex, light));
        }
    }

    @SuppressWarnings("deprecation")
    private void applyBg(String hex, boolean light) {
        try {
            int c = Color.parseColor(hex);
            if (rootView != null) rootView.setBackgroundColor(c);
            if (web != null) web.setBackgroundColor(c);
            Window w = getWindow();
            if (Build.VERSION.SDK_INT < 35) { w.setStatusBarColor(c); w.setNavigationBarColor(c); }
            if (Build.VERSION.SDK_INT >= 30) {
                android.view.WindowInsetsController ic = w.getInsetsController();
                if (ic != null) {
                    int m = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                    ic.setSystemBarsAppearance(light ? m : 0, m);
                }
            } else if (Build.VERSION.SDK_INT >= 23) {
                int f = w.getDecorView().getSystemUiVisibility();
                w.getDecorView().setSystemUiVisibility(light ? (f | android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR) : (f & ~android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR));
            }
        } catch (Exception ignored) {
            // bad colour string
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT < 35) {
            window.setStatusBarColor(BG);
            window.setNavigationBarColor(BG);
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        rootView = root;

        web = new WebView(this);
        web.setBackgroundColor(BG);
        web.addJavascriptInterface(new Native(), "HokmNative");
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // saved game and settings (localStorage)
        s.setTextZoom(100);                    // keep the table layout stable with large system fonts
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("file".equals(uri.getScheme())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    // no app can open it
                }
                return true;
            }
        });

        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        // Android 15+ draws edge to edge: keep the game clear of the status and navigation bars.
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsets.CONSUMED;
            });
        }

        setContentView(root);

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl("file:///android_asset/index.html");
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        relay.stop();
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /** The page decides what Back means (close a dialog, open the pause menu, …). */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript("(window.hokmBack && window.hokmBack()) ? 'yes' : 'no'", value -> {
            if (value == null || !value.contains("yes")) finish();
        });
    }
}
