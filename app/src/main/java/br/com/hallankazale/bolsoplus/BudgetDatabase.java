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

    BudgetDatabase(Context context) { super(context, DB_NAME, null, 1); }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE settings (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
        db.execSQL("CREATE TABLE recurring (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, category TEXT NOT NULL, cents INTEGER NOT NULL CHECK(cents > 0), from_month TEXT, until_month TEXT)");
        db.execSQL("CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK(kind IN ('expense','income')), cents INTEGER NOT NULL CHECK(cents > 0), title TEXT NOT NULL, category TEXT NOT NULL, occurred_on TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
        ContentValues setting = new ContentValues(); setting.put("name", "income_cents"); setting.put("value", "390000"); db.insertOrThrow("settings", null, setting);
        seed(db, "Aluguel", "Moradia", 90000, null);
        seed(db, "Água e luz", "Moradia", 25000, null);
        seed(db, "Pensão 1", "Pensões", 54200, null);
        seed(db, "Pensão 2", "Pensões", 40000, null);
        seed(db, "Móveis", "Compras", 41200, "2027-02");
        seed(db, "Ana Loja", "Compras", 30000, "2027-02");
    }
    private void seed(SQLiteDatabase db, String title, String category, int cents, String until) {
        ContentValues v = new ContentValues(); v.put("title", title); v.put("category", category); v.put("cents", cents); v.put("from_month", "2026-01"); v.put("until_month", until); db.insertOrThrow("recurring", null, v);
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { /* Future schema versions use explicit migrations. */ }

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
            out.put("incomeCents", c.moveToFirst() ? Long.parseLong(c.getString(0)) : 390000L);
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
    void deleteEntry(long id) {
        if (id < 1) throw new IllegalArgumentException("ID inválido");
        getWritableDatabase().delete("entries", "id=?", new String[]{Long.toString(id)});
    }
    void saveIncome(long cents) {
        requireMoney(cents);
        ContentValues v = new ContentValues(); v.put("value", Long.toString(cents));
        getWritableDatabase().update("settings", v, "name=?", new String[]{"income_cents"});
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
    String exportCsv() {
        StringBuilder sb = new StringBuilder("tipo;valor;data;categoria;descricao;origem\n");
        try (Cursor c = getReadableDatabase().rawQuery("SELECT kind,cents,occurred_on,category,title,source FROM entries ORDER BY occurred_on DESC,id DESC",null)) {
            while (c.moveToNext()) {
                sb.append(csv(c.getString(0))).append(';').append(c.getLong(1) / 100).append(',').append(String.format(java.util.Locale.ROOT,"%02d", c.getLong(1) % 100)).append(';')
                    .append(csv(c.getString(2))).append(';').append(csv(c.getString(3))).append(';').append(csv(c.getString(4))).append(';').append(csv(c.getString(5))).append('\n');
            }
        }
        return sb.toString();
    }
    private static String csv(String v) {
        String cleaned = v.replace("\n", " ").replace("\r", " ");
        // Prevent formulas from executing when a CSV is opened in spreadsheet software.
        if (!cleaned.isEmpty() && "=+-@".indexOf(cleaned.charAt(0)) >= 0) cleaned = "'" + cleaned;
        return "\"" + cleaned.replace("\"", "\"\"") + "\"";
    }
}
