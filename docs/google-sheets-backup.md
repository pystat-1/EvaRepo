# Google Sheets grades backup — setup (Apps Script, no service account)

This route needs **no service-account key, no org policy change, no billing** —
it works on a personal Google account. You create an Apps Script bound to your
private Sheet, publish it as a Web App with a secret token, and paste its URL +
token into the app.

## 1. Create the Sheet
1. Go to https://sheets.google.com → **Blank spreadsheet**.
2. Name it (e.g. "Eva — نسخة الدرجات"). Keep it private (don't share it publicly).

## 2. Add the script
1. In the Sheet: **Extensions → Apps Script**.
2. Delete any starter code, paste **all** of `Code.gs` below.
3. Change `SECRET` to a long random string (letters+numbers, ~30 chars). Remember it — it becomes `GOOGLE_SHEETS_TOKEN`.
4. **Save** (disk icon).

```javascript
// Code.gs — Eva grades backup receiver
const SECRET = "CHANGE_ME_to_a_long_random_string";

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.token !== SECRET) return json({ ok: false, error: "bad token" });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tab = body.tab || "Sheet1";
    var sheet = ss.getSheetByName(tab) || ss.insertSheet(tab);

    if (body.action === "sync") {
      sheet.clearContents();
      var header = body.header || [];
      var values = [header].concat(body.rows || []);
      var width = header.length || 1;
      if (values.length) sheet.getRange(1, 1, values.length, width).setValues(pad(values, width));
      sheet.setFrozenRows(1);
    } else if (body.action === "append") {
      var rows = body.rows || [];
      if (rows.length) {
        var w = 0;
        rows.forEach(function (r) { w = Math.max(w, r.length); });
        var start = sheet.getLastRow() + 1;
        sheet.getRange(start, 1, rows.length, w).setValues(pad(rows, w));
      }
    }
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function pad(rows, width) {
  return rows.map(function (r) { var c = r.slice(); while (c.length < width) c.push(""); return c; });
}
function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
```

## 3. Publish as a Web App
1. Top-right **Deploy → New deployment**.
2. Gear icon → select type **Web app**.
3. **Execute as:** *Me*.  **Who has access:** *Anyone*.
   (This is safe: the URL is unguessable and every request must carry the secret token. "Anyone" only means "no Google login prompt," not "public data.")
4. **Deploy** → authorize when prompted (allow the script to edit your sheets).
5. Copy the **Web app URL** (ends in `/exec`). It becomes `GOOGLE_SHEETS_WEBHOOK_URL`.

## 4. Put it in the app's `.env`
```bash
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/AKfy..../exec
GOOGLE_SHEETS_TOKEN=the_same_long_random_string_you_set_as_SECRET
```
Restart the app → open the grading center → click **مزامنة كل الدرجات إلى Google Sheets**.
Two tabs appear in your Sheet: **الدرجات** (full mirror) and **سجل اللقطات**
(auto-updated on every grade). Open the Sheet anytime with your normal Google login.

## Re-deploying after script edits
If you change `Code.gs`, use **Deploy → Manage deployments → edit (pencil) →
Version: New version → Deploy** so the same URL keeps working.
