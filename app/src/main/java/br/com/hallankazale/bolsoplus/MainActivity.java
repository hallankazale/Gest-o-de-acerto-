package br.com.hallankazale.bolsoplus;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.speech.RecognizerIntent;
import android.graphics.Insets;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native host provides local persistence + platform speech; all layout lives in bundled assets. */
public final class MainActivity extends Activity {
    private static final int SPEECH_REQUEST = 101;
    private static final int EXPORT_REQUEST = 102;
    private WebView webView;
    private BudgetDatabase database;
    private final ExecutorService disk = Executors.newSingleThreadExecutor();
    private String month = LocalDate.now().toString().substring(0,7);

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(android.graphics.Color.rgb(7,20,35));
        getWindow().setNavigationBarColor(android.graphics.Color.rgb(7,20,35));
        database = new BudgetDatabase(this);
        webView = new WebView(this);
        webView.setBackgroundColor(android.graphics.Color.rgb(7,20,35));
        // Android 15+ may draw content under system bars. Inset the WebView itself
        // so both the fixed navigation and bottom sheets stay visible on gesture-navigation devices.
        if (Build.VERSION.SDK_INT >= 35) {
            webView.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        }
        WebSettings config = webView.getSettings();
        config.setJavaScriptEnabled(true); // Required for trusted bundled frontend only.
        config.setDomStorageEnabled(false);
        config.setAllowFileAccess(false); // Bundled android_asset remains accessible; arbitrary files are denied.
        config.setAllowContentAccess(false);
        config.setAllowFileAccessFromFileURLs(false);
        config.setAllowUniversalAccessFromFileURLs(false);
        config.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isTrusted(request.getUrl());
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (isTrusted(Uri.parse(url))) refresh();
            }
        });
        webView.addJavascriptInterface(new NativeBridge(), "BolsoNative");
        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }
    private boolean isTrusted(Uri url) {
        String path = url.getPath();
        return "file".equals(url.getScheme()) && (url.getAuthority() == null || url.getAuthority().isEmpty())
                && path != null && path.startsWith("/android_asset/") && !path.contains("..");
    }
    private void js(String invocation) { runOnUiThread(() -> { if (webView != null) webView.evaluateJavascript(invocation, null); }); }
    private void error(Exception e) { js("window.Bolso.showError(" + JSONObject.quote(e.getMessage() == null ? "Erro inesperado" : e.getMessage()) + ")"); }
    private void refresh() { String selected = month; disk.execute(() -> { try { js("window.Bolso.renderData(" + database.snapshot(selected).toString() + ")"); } catch (Exception e) { error(e); } }); }
    private void task(Runnable work, String success) {
        disk.execute(() -> {
            try {
                work.run();
                refresh();
                js("window.Bolso.toast(" + JSONObject.quote(success) + ")");
            } catch (Exception e) { error(e); }
        });
    }

    private final class NativeBridge {
        @JavascriptInterface public void load(String selectedMonth) {
            if (selectedMonth == null || !selectedMonth.matches("\\d{4}-(0[1-9]|1[0-2])")) { error(new IllegalArgumentException("Mês inválido")); return; }
            month = selectedMonth;
            refresh();
        }
        @JavascriptInterface public void saveEntry(String kind, long cents, String title, String category, String date, String source) {
            task(() -> database.saveEntry(kind, cents, title, category, date, source), "Lançamento salvo");
        }
        @JavascriptInterface public void updateEntry(long id, String kind, long cents, String title, String category, String date) {
            task(() -> database.updateEntry(id, kind, cents, title, category, date), "Lançamento atualizado");
        }
        @JavascriptInterface public void deleteEntry(long id) { task(() -> database.deleteEntry(id), "Lançamento excluído"); }
        @JavascriptInterface public void saveIncome(long cents) { task(() -> database.saveIncome(cents), "Renda atualizada"); }
        @JavascriptInterface public void saveBill(long id, String title, String category, long cents, String fromMonth, String untilMonth) {
            task(() -> database.saveBill(id, title, category, cents, fromMonth, untilMonth), "Conta salva");
        }
        @JavascriptInterface public void deleteBill(long id) { task(() -> database.deleteBill(id), "Conta excluída"); }
        @JavascriptInterface public void resetAll() { task(database::resetAll, "Dados apagados com sucesso"); }
        @JavascriptInterface public void speak() { runOnUiThread(MainActivity.this::requestSpeech); }
        @JavascriptInterface public void exportCsv() { runOnUiThread(MainActivity.this::requestExport); }
    }
    private void requestSpeech() {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR");
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "pt-BR");
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Exemplo: gastei 50 reais de bolachas e salgadinhos");
        try { startActivityForResult(intent, SPEECH_REQUEST); }
        catch (ActivityNotFoundException e) { js("window.Bolso.showError('Seu celular não tem serviço de reconhecimento de voz. Use o campo de texto.')"); }
    }
    private void requestExport() {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("text/csv");
        intent.putExtra(Intent.EXTRA_TITLE, "bolsoplus-backup-completo.csv");
        try { startActivityForResult(intent, EXPORT_REQUEST); }
        catch (ActivityNotFoundException e) { js("window.Bolso.showError('Não foi possível abrir o gerenciador de arquivos.')"); }
    }
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code,result,data);
        if (code == SPEECH_REQUEST && result == RESULT_OK && data != null) {
            ArrayList<String> resultList = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (resultList != null && !resultList.isEmpty()) {
                js("window.Bolso.receiveSpeech(" + JSONObject.quote(resultList.get(0)) + ")");
            }
        }
        if (code == SPEECH_REQUEST && result != RESULT_OK) {
            js("window.Bolso.toast('Voz cancelada ou não reconhecida. Você pode digitar o lançamento.')");
        }
        if (code == EXPORT_REQUEST && result == RESULT_OK && data != null && data.getData() != null) {
            Uri uri = data.getData();
            disk.execute(() -> {
                try (OutputStream stream = getContentResolver().openOutputStream(uri)) {
                    if (stream == null) throw new IllegalStateException("Destino indisponível");
                    stream.write("\ufeff".getBytes(StandardCharsets.UTF_8));
                    stream.write(database.exportCsv().getBytes(StandardCharsets.UTF_8));
                    js("window.Bolso.toast('CSV exportado com sucesso')");
                } catch (Exception e) { error(e); }
            });
        }
    }
    @Override public void onBackPressed() { js("window.Bolso.back()"); }
    @Override protected void onDestroy() {
        disk.execute(() -> database.close()); // Close only after queued writes complete.
        disk.shutdown();
        if (webView != null) { webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
