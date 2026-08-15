package com.novel.reader;

import android.os.Bundle;
import android.graphics.Color;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private volatile boolean readerHandledVolumeKey = false;
    private volatile boolean readerImmersiveEnabled = false;
    private long lastVolumeKeyTime = 0;
    private final Runnable immersiveRetry = () -> {
        if (readerImmersiveEnabled) applyReaderImmersive(true, false);
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureEdgeToEdgeWindow();
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new AndroidReaderBridge(), "AndroidReader");
        }
    }

    private class AndroidReaderBridge {
        @JavascriptInterface
        public void setReaderVolumeKeyEnabled(boolean enabled) {
            readerHandledVolumeKey = enabled;
        }

        @JavascriptInterface
        public void setReaderImmersiveEnabled(boolean enabled) {
            readerImmersiveEnabled = enabled;
            runOnUiThread(() -> applyReaderImmersive(enabled));
        }
    }

    private void configureEdgeToEdgeWindow() {
        Window window = getWindow();
        if (window == null) return;
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attrs = window.getAttributes();
            attrs.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(attrs);
        }
        WindowCompat.setDecorFitsSystemWindows(window, false);
    }

    private void applyReaderImmersive(boolean enabled) {
        applyReaderImmersive(enabled, true);
    }

    private void applyReaderImmersive(boolean enabled, boolean scheduleRetry) {
        Window window = getWindow();
        if (window == null) return;
        configureEdgeToEdgeWindow();
        View decor = window.getDecorView();
        if (enabled) {
            window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
        if (controller != null) {
            if (enabled) {
                controller.hide(WindowInsetsCompat.Type.systemBars());
                controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            } else {
                controller.show(WindowInsetsCompat.Type.systemBars());
            }
        }
        if (decor == null) return;
        if (enabled) {
            decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            );
        } else {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
        decor.removeCallbacks(immersiveRetry);
        if (enabled && scheduleRetry) {
            decor.postDelayed(immersiveRetry, 180);
            decor.postDelayed(immersiveRetry, 650);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        applyReaderImmersive(readerImmersiveEnabled);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyReaderImmersive(readerImmersiveEnabled);
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            int keyCode = event.getKeyCode();
            if (readerHandledVolumeKey && (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN)) {
                if (event.getRepeatCount() > 0) return true;
                long now = System.currentTimeMillis();
                if (now - lastVolumeKeyTime < 350) return true;
                lastVolumeKeyTime = now;
                String direction = keyCode == KeyEvent.KEYCODE_VOLUME_UP ? "up" : "down";
                if (getBridge() != null) {
                    getBridge().eval(
                        "window.dispatchEvent(new CustomEvent('reader-volume-key',{detail:{direction:'" + direction + "'}}));",
                        null
                    );
                }
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }
}
