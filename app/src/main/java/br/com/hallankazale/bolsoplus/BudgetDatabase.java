package br.com.hallankazale.bolsoplus;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.regex.Pattern;

/** Single-owner persistence boundary. Money is stored as integer cents, never floating point. */
final class BudgetDatabase extends SQLiteOpenHelper {
    private static final String DB_NAME = "bolsoplus_v1.db";
    private static final Pattern MONTH = Pattern.compile("\\d{4}-(0[1-9]|1[0-2])");
    private static final Pattern DAY = Pattern.compile("\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01])");

    BudgetDatabase(Context context) { super(context, DB_NAME, null, 3); }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE settings (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
        db.execSQL("CREATE TABLE recurring (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL, cents INTEGER NOT NULL CHECK(cents > 0), from_month TEXT, until_month TEXT)");
        db.execSQL("CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK(kind IN ('expense','income')), cents INTEGER NOT NULL CHECK(cents > 0), title TEXT NOT NULL, category TEXT NOT NULL, occurred_on TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, remote_id TEXT)");
        db.execSQL("CREATE UNIQUE INDEX ux_entries_remote_id ON entries(remote_id)");
        // Start with no personal data. Never inject example debts or income in production.
        ContentValues setting = new ContentValues(); setting.put("name", "income_cents"); setting.put("value", "0");
        db.insertOrThrow("settings", null, setting);
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Preserve existing user entries on upgrades. Wiping is a separate, explicit user action.
        if (oldVersion > newVersion) throw new IllegalStateException("Versão de banco inválida");
        if (oldVersion < 3) {
            db.execSQL("ALTER TABLE entries ADD COLUMN remote_id TEXT");
            db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS ux_entries_remote_id ON entries(remote_id)");
        }
    }

    private static void requireMoney(long cents) {
        // Limit a single posting to R$ 10M and forbid zero/negative amounts.
        if (cents <= 0 || cents > 1_000_000_000L) throw new IllegalArgumentException("Valor inválido");
    }
    private static String checked(String value, String field) {
        if (value == null) throw new IllegalArgumentException(field + " obrigatório");
        String s = value.trim();
        if (s.isEmpty() || s.length() > 160) throw new IllegalArgumentException(field + " inválido");
        return s;
    }
    private static void requireMonth(String s) { if (s == null || !MONTH.matcher(s).matches()) throw new IllegalArgumentException("Mês inválido"); }
    private static void requireDay(String s) {
        if (s == null || !DAY.matcher(s).matches()) throw new IllegalArgumentException("Data inválida");
        try { java.time.LocalDate.parse(s); } catch (Exception e) { throw new IllegalArgumentException("Data inválida"); }
    }

    JSONObject snapshot(String month) throws JSONException {
        requireMonth(month);
        JSONObject out = new JSONObject(); out.put("month", month);
        SQLiteDatabase db = getReadableDatabase();
        try (Cursor c = db.rawQuery("SELECT value FROM settings WHERE name=?", new String[]{"income_cents"})) {
            out.put("incomeCents", c.moveToFirst() ? Long.parseLong(c.getString(0)) : 0L);
        }
        JSONArray bills = new JSONArray();
        try (Cursor c = db.rawQuery("SELECT id,title,category,cents,from_month,until_month FROM recurring ORDER BY id", null)) {
            while (c.moveToNext()) {
                JSONObject item = new JSONObject();
                item.put("id", c.getLong(0)); item.put("title", c.getString(1)); item.put("category", c.getString(2)); item.put("cents", c.getLong(3));
                item.put("fromMonth", c.isNull(4) ? JSONObject.NULL : c.getString(4));
                item.put("untilMonth", c.isNull(5) ? JSONObject.NULL : c.getString(5)); bills.put(item);
            }
        }
        out.put("recurring", bills);
        JSONArray entries = new JSONArray();
        try (Cursor c = db.rawQuery("SELECT id,kind,cents,title,category,occurred_on,source FROM entries WHERE occurred_on >= ? AND occurred_on < ? ORDER BY occurred_on DESC,id DESC",
                new String[]{month + "-01", java.time.YearMonth.parse(month).plusMonths(1).toString() + "-01"})) {
            while (c.moveToNext()) {
                JSONObject item = new JSONObject();
                item.put("id", c.getLong(0)); item.put("kind", c.getString(1)); item.put("cents", c.getLong(2)); item.put("title", c.getString(3)); item.put("category", c.getString(4)); item.put("date", c.getString(5)); item.put("source", c.getString(6)); entries.put(item);
            }
        }
        out.put("entries", entries);
        return out;
    }
    void saveEntry(String kind, long cents, String title, String category, String day, String source) {
        if (!"income".equals(kind) && !"expense".equals(kind)) throw new IllegalArgumentException("Tipo inválido");
        requireMoney(cents); requireDay(day);
        ContentValues values = new ContentValues(); values.put("kind", kind); values.put("cents", cents);
        values.put("title", checked(title,"Descrição")); values.put("category", checked(category,"Categoria"));
        values.put("occurred_on", day); values.put("source", "voice".equals(source) ? "voice" : "text");
        getWritableDatabase().insertOrThrow("entries", null, values);
    }
    void updateEntry(long id, String kind, long cents, String title, String category, String day) {
        if (id < 1) throw new IllegalArgumentException("ID inválido");
        if (!"income".equals(kind) && !"expense".equals(kind)) throw new IllegalArgumentException("Tipo inválido");
        requireMoney(cents); requireDay(day);
        ContentValues values = new ContentValues(); values.put("kind", kind); values.put("cents", cents);
        values.put("title", checked(title,"Descrição")); values.put("category", checked(category,"Categoria"));
        values.put("occurred_on", day);
        if (getWritableDatabase().update("entries", values, "id=?", new String[]{Long.toString(id)}) != 1)
            throw new IllegalArgumentException("Lançamento não encontrado");
    }
    void deleteEntry(long id) {
        if (id < 1) throw new IllegalArgumentException("ID inválido");
        getWritableDatabase().delete("entries", "id=?", new String[]{Long.toString(id)});
    }
    void saveIncome(long cents) {
        // Unlike an expense, a zero income is valid and means "not configured".
        if (cents < 0 || cents > 1_000_000_000L) throw new IllegalArgumentException("Renda inválida");
        ContentValues v = new ContentValues(); v.put("name", "income_cents"); v.put("value", Long.toString(cents));
        getWritableDatabase().insertWithOnConflict("settings", null, v, SQLiteDatabase.CONFLICT_REPLACE);
    }
    void saveBill(long id, String title, String category, long cents, String fromMonth, String untilMonth) {
        requireMoney(cents);
        requireMonth(fromMonth);
        if (untilMonth != null && !untilMonth.isEmpty()) requireMonth(untilMonth);
        if (untilMonth != null && !untilMonth.isEmpty() && untilMonth.compareTo(fromMonth) < 0) throw new IllegalArgumentException("Mês final anterior ao inicial");
        ContentValues v = new ContentValues(); v.put("title", checked(title,"Descrição")); v.put("category", checked(category,"Categoria")); v.put("cents", cents); v.put("from_month", fromMonth);
        if (untilMonth == null || untilMonth.isEmpty()) v.putNull("until_month"); else v.put("until_month",untilMonth);
        if (id == 0) getWritableDatabase().insertOrThrow("recurring", null,v);
        else {
            if (id < 0) throw new IllegalArgumentException("ID inválido");
            getWritableDatabase().update("recurring", v, "id=?", new String[]{Long.toString(id)});
        }
    }
    void deleteBill(long id) {
        if (id < 1) throw new IllegalArgumentException("ID inválido");
        getWritableDatabase().delete("recurring", "id=?", new String[]{Long.toString(id)});
    }
    void resetAll() {
        // Destructive operation is only exposed after a confirmation form in the UI.
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("entries", null, null);
            db.delete("recurring", null, null);
            ContentValues setting = new ContentValues(); setting.put("name", "income_cents"); setting.put("value", "0");
            db.insertWithOnConflict("settings", null, setting, SQLiteDatabase.CONFLICT_REPLACE);
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    /**
     * Idempotent, transactional WhatsApp import. The remote owner and bearer are resolved by
     * the Worker; locally only validated entries are stored and duplicate IDs are ignored.
     */
    int importWhatsApp(JSONArray rows) throws JSONException {
        if (rows.length() > 200) throw new IllegalArgumentException("Lote de sincronização inválido");
        SQLiteDatabase db = getWritableDatabase();
        int imported = 0;
        db.beginTransaction();
        try {
            for (int i=0;i<rows.length();i++) {
                JSONObject row = rows.getJSONObject(i);
                String remoteId = checked(row.getString("remoteId"), "Identificador");
                if (!remoteId.matches("[0-9a-fA-F-]{36}")) throw new IllegalArgumentException("Identificador remoto inválido");
                String kind = row.getString("kind");
                if (!"income".equals(kind) && !"expense".equals(kind)) throw new IllegalArgumentException("Tipo remoto inválido");
                long cents=row.getLong("cents");requireMoney(cents);
                String title=checked(row.getString("title"),"Descrição");
                String category=checked(row.getString("category"),"Categoria");
                String date=row.getString("date");requireDay(date);
                ContentValues values=new ContentValues();
                values.put("remote_id",remoteId);values.put("kind",kind);values.put("cents",cents);
                values.put("title",title);values.put("category",category);values.put("occurred_on",date);
                values.put("source","whatsapp");
                if (db.insertWithOnConflict("entries",null,values,SQLiteDatabase.CONFLICT_IGNORE)!=-1) imported++;
            }
            db.setTransactionSuccessful();
        }finally {db.endTransaction();}
        return imported;
    }
    String exportCsv() {
        // A single portable CSV includes every part of the budget, not just variable expenses.
        StringBuilder sb = new StringBuilder("tipo;valor;data;categoria;descricao;origem;inicio;fim\n");
        try (Cursor c = getReadableDatabase().rawQuery("SELECT value FROM settings WHERE name='income_cents'", null)) {
            if (c.moveToFirst()) appendCsv(sb, "renda_fixa", Long.parseLong(c.getString(0)), "", "Entradas", "Renda mensal", "configuracao", "", "");
        }
        try (Cursor c = getReadableDatabase().rawQuery("SELECT title,category,cents,from_month,until_month FROM recurring ORDER BY id", null)) {
            while (c.moveToNext()) appendCsv(sb, "conta_fixa", c.getLong(2), "", c.getString(1), c.getString(0), "recorrente", c.getString(3), c.isNull(4) ? "" : c.getString(4));
        }
        try (Cursor c = getReadableDatabase().rawQuery("SELECT kind,cents,occurred_on,category,title,source FROM entries ORDER BY occurred_on DESC,id DESC",null)) {
            while (c.moveToNext()) appendCsv(sb, c.getString(0), c.getLong(1), c.getString(2), c.getString(3), c.getString(4), c.getString(5), "", "");
        }
        return sb.toString();
    }
    private static void appendCsv(StringBuilder sb, String kind, long cents, String day, String category, String title, String origin, String first, String last) {
        sb.append(csv(kind)).append(';').append(cents / 100).append(',')
                .append(String.format(java.util.Locale.ROOT, "%02d", cents % 100)).append(';')
                .append(csv(day)).append(';').append(csv(category)).append(';')
                .append(csv(title)).append(';').append(csv(origin)).append(';')
                .append(csv(first)).append(';').append(csv(last)).append('\n');
    }
    private static String csv(String v) {
        String cleaned = v.replace("\n", " ").replace("\r", " ");
        // Prevent formulas from executing when a CSV is opened in spreadsheet software.
        if (!cleaned.isEmpty() && "=+-@".indexOf(cleaned.charAt(0)) >= 0) cleaned = "'" + cleaned;
        return "\"" + cleaned.replace("\"", "\"\"") + "\"";
    }
}
