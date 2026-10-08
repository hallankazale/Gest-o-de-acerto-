package br.com.hallankazale.bolsoplus;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Android-only HTTPS transport boundary. The device bearer token is encrypted at rest with
 * Android Keystore and is never exposed to WebView JavaScript or included in a backup.
 * No Meta/AI vendor keys ever live in the APK.
 */
final class WhatsAppConnector {
    private static final String PREFS = "bolsoplus_wa_config";
    private static final String ALIAS = "bolsoplus_device_token_v1";
    private final SharedPreferences prefs;
    private final Context context;
    WhatsAppConnector(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS,Context.MODE_PRIVATE);
    }
    boolean configured() { return !prefs.getString("url","").isEmpty(); }
    String endpoint() { return prefs.getString("url",""); }

    /** Only Cloudflare Workers HTTPS endpoints: prevents accidental upload of personal finances to an HTTP server. */
    private static String validateEndpoint(String input) throws Exception {
        URI uri = new URI(input == null ? "" : input.trim());
        if(!"https".equalsIgnoreCase(uri.getScheme()) || uri.getUserInfo()!=null || uri.getPort()!=-1 ||
           uri.getRawQuery()!=null || uri.getRawFragment()!=null || (uri.getPath()!=null && !uri.getPath().matches("/?")) ||
           uri.getHost()==null || !uri.getHost().toLowerCase(java.util.Locale.ROOT).matches("[a-z0-9-]+\\.[a-z0-9-]+\\.workers\\.dev"))
            throw new IllegalArgumentException("Informe seu endereço https://nome.conta.workers.dev");
        return "https://" + uri.getHost().toLowerCase(java.util.Locale.ROOT);
    }
    private SecretKey getKey() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(store.containsAlias(ALIAS))return ((KeyStore.SecretKeyEntry)store.getEntry(ALIAS,null)).getSecretKey();
        KeyGenerator keygen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        keygen.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build());
        return keygen.generateKey();
    }
    private String encryptedToken() throws Exception {
        String saved=prefs.getString("token",null);
        if(saved!=null){
            try {
                byte[] raw=Base64.decode(saved,Base64.NO_WRAP);byte[] iv=java.util.Arrays.copyOfRange(raw,0,12);
                byte[] encrypted=java.util.Arrays.copyOfRange(raw,12,raw.length);
                Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,getKey(),new GCMParameterSpec(128,iv));
                return new String(cipher.doFinal(encrypted),StandardCharsets.UTF_8);
            } catch (Exception exception) {throw new IllegalStateException("Falha ao ler a credencial. Desvincule e vincule novamente.");}
        }
        byte[] secret=new byte[32];new SecureRandom().nextBytes(secret);
        String token=Base64.encodeToString(secret,Base64.NO_WRAP|Base64.URL_SAFE|Base64.NO_PADDING);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,getKey());
        byte[] encrypted=cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
        ByteArrayOutputStream buffer=new ByteArrayOutputStream();buffer.write(cipher.getIV());buffer.write(encrypted);
        if(!prefs.edit().putString("token",Base64.encodeToString(buffer.toByteArray(),Base64.NO_WRAP)).commit())
            throw new IllegalStateException("Não foi possível guardar a credencial");
        return token;
    }
    private JSONObject call(String path,String method) throws Exception {
        if(!configured())throw new IllegalStateException("Informe primeiro a URL do seu servidor");
        URL url=new URL(endpoint()+path);
        HttpURLConnection connection=(HttpURLConnection)url.openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(10000);connection.setReadTimeout(15000);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Authorization","Bearer "+encryptedToken());
            connection.setRequestProperty("Accept","application/json");
            if("POST".equals(method)){
                connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");
                try(OutputStream out=connection.getOutputStream()){out.write("{}".getBytes(StandardCharsets.UTF_8));}
            }
            int status=connection.getResponseCode();
            InputStream input=status>=400?connection.getErrorStream():connection.getInputStream();
            if(input==null)throw new IllegalStateException("Servidor indisponível (HTTP "+status+")");
            byte[] payload;
            try(InputStream in=input; ByteArrayOutputStream buffer=new ByteArrayOutputStream()){
                byte[] chunk=new byte[4096];int n;
                while((n=in.read(chunk))!=-1){buffer.write(chunk,0,n);if(buffer.size()>300000)throw new IllegalStateException("Resposta muito grande");}
                payload=buffer.toByteArray();
            }
            JSONObject response=new JSONObject(new String(payload,StandardCharsets.UTF_8));
            if(status>=400)throw new IllegalStateException("Servidor: "+response.optString("error","Falha de integração"));
            return response;
        } finally {connection.disconnect();}
    }
    JSONObject startPair(String url) throws Exception {
        String valid=validateEndpoint(url);
        // A different server must never inherit the previous server's cursor, token or linking status.
        if(!valid.equals(endpoint())){
            if(!prefs.edit().putString("url",valid).remove("token").putLong("cursor",0).commit())
                throw new IllegalStateException("Não foi possível configurar o servidor");
        }
        return call("/v1/device/pair/start","POST");
    }
    JSONObject status() throws Exception {return configured()?call("/v1/device/status","GET"):new JSONObject().put("linked",false).put("configured",false);}
    JSONObject unlink() throws Exception {
        JSONObject response=configured()?call("/v1/device/unlink","POST"):new JSONObject();
        prefs.edit().remove("url").remove("token").remove("cursor").apply();
        return response.put("linked",false).put("configured",false);
    }
    /** Import at most 2000 entries per tap; cursor advances only after local SQLite commit. */
    JSONObject sync(BudgetDatabase database) throws Exception {
        JSONObject link=status();if(!link.optBoolean("linked"))throw new IllegalStateException("Vincule seu WhatsApp primeiro");
        long cursor=prefs.getLong("cursor",0L);int imported=0;int pages=0;
        do {
            JSONObject payload=call("/v1/device/transactions?cursor="+cursor,"GET");
            JSONArray rows=payload.getJSONArray("items");
            imported+=database.importWhatsApp(rows);
            cursor=payload.getLong("nextCursor");
            if(!prefs.edit().putLong("cursor",cursor).commit())throw new IllegalStateException("Falha ao guardar progresso");
            pages++;
            if(!payload.optBoolean("hasMore") || rows.length()==0)break;
        }while(pages<10);
        return new JSONObject().put("linked",true).put("imported",imported).put("more",pages>=10);
    }
}
