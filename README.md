# Teryaq SQL Connector

تطبيق ويب عربي RTL للاتصال بقواعد Microsoft SQL Server وعرض لوحة أعمال قراءة فقط.

## المتطلبات

- Node.js 18 أو أحدث
- صلاحية قراءة على قاعدة SQL Server
- فتح منفذي `5173` للواجهة و`3001` للـ API على الجهاز المضيف عند الاستخدام من الجوالات داخل الشبكة

## التثبيت والتشغيل

```bash
npm install
npm run dev
```

التشغيل الافتراضي:

- الواجهة: `http://0.0.0.0:5173`
- الـ API: `http://0.0.0.0:3001`

من جهاز آخر على نفس الشبكة افتح:

```text
http://YOUR-PC-IP:5173
```

## إعداد الاتصال

من صفحة الإعداد أدخل:

- عنوان السيرفر
- اسم قاعدة البيانات
- اسم المستخدم
- كلمة المرور
- المنفذ، افتراضيًا `1433`
- `Encrypt`
- `Trust Server Certificate`

زر `اختبار الاتصال` ينفذ:

```http
POST /api/test-connection
```

زر `حفظ الاتصال` ينفذ:

```http
POST /api/save-connection
```

بعد الحفظ يتم تخزين الإعدادات في:

```text
config/connection.json
```

هذا الملف موجود في `.gitignore` ولا يتم إرسال كلمة المرور إلى الواجهة بعد الحفظ.

يمكن أيضًا استخدام `.env` بدل ملف الاتصال. انسخ المثال:

```bash
copy .env.example .env
```

ثم عدّل القيم.

## Almohaseb Profile

التطبيق يستخدم افتراضيًا Profile مخصصًا لقاعدة `AlmohasebSQL`.

هذا الـProfile لا يعتمد على `config/mapping.json`، ولا ينشئ جداولًا أو Views، ولا يعدل قاعدة البيانات. كل الشاشات الأساسية تستخدم استعلامات `SELECT` فقط مبنية على الجداول الفعلية:

- `The_Persons`
- `The_Movementrestrictions`
- `The_Details`
- `The_ItemDetails`
- `The_Outstandingvalues`
- `The_Receipts`
- `The_Items`
- `The_Trade`
- `The_Barcode`
- `The_Units`
- `the_Charge`

## إعداد Mapping عام

التطبيق لا يفترض أسماء الجداول أو الحقول. عدّل الملف:

```text
config/mapping.json
```

ملاحظة: هذا الملف موجود للاستخدامات العامة مستقبلًا، لكنه غير مطلوب لتشغيل Almohaseb Profile الحالي.

يوجد مثال كامل في:

```text
config/mapping.example.json
```

يمكن كتابة الجداول بصيغة:

```json
{
  "customersTable": "dbo.Customers",
  "customerIdField": "Id",
  "customerNameField": "Name"
}
```

إذا كان اسم الجدول أو الحقل يحتوي مسافات يمكن استخدام الأقواس:

```json
{
  "customersTable": "dbo.[Customer Accounts]",
  "customerNameField": "Customer Name"
}
```

## وضع القراءة فقط

كل استعلام يمر عبر حارس backend قبل التنفيذ. يسمح التطبيق فقط باستعلامات `SELECT`.

يتم رفض أي استعلام يحتوي على:

- `INSERT`
- `UPDATE`
- `DELETE`
- `DROP`
- `ALTER`
- `TRUNCATE`
- `EXEC`
- `MERGE`

كما يتم رفض تعدد الجمل و`SELECT INTO`.

## Endpoints

```http
POST /api/test-connection
POST /api/save-connection
GET  /api/status
POST /api/query-readonly
GET  /api/customers
GET  /api/customer/:id
GET  /api/customer/:id/ledger
GET  /api/customer/:id/invoices
GET  /api/customer/:id/receipts
GET  /api/suppliers
GET  /api/items
GET  /api/shortages
GET  /api/expiry
GET  /api/sales-today
GET  /api/revenue-details
GET  /api/trading-profit
GET  /api/trading-profit-debug
```

### Current Report Endpoints

- `GET /api/suppliers`
  - Returns Almohaseb supplier account summaries.
- `GET /api/revenue-details`
  - Revenue Today report.
  - This is a separate operational revenue/audit report and must not be mixed into Trading & Profit unless Almohaseb itself uses the same official source.
- `GET /api/trading-profit`
  - Trading & Profit report.
  - Official summary source: `The_Profit`.
  - Summary cards must match the official Almohaseb Trading & Profit screen.
  - Do not calculate official Trading & Profit totals from `The_Movementrestrictions` / `The_Details`.
  - Invoice rows shown in the details section are review-only and must not affect official Trading & Profit totals.
- `GET /api/trading-profit-debug`
  - Diagnostic endpoint only.
  - Used for investigation and comparison while matching Almohaseb behavior.
  - Do not treat it as a production report source.

## بناء نسخة إنتاجية

```bash
npm run build
npm start
```

بعد البناء، يخدم Express ملفات الواجهة من مجلد `dist`.

## Official Runtime Ports

Use one official backend/API server:

- Backend/API: `http://0.0.0.0:3001`
- Frontend/Vite: `http://0.0.0.0:5173`
- Official backend port: `3001`
- Official frontend port: `5173`
- Vite proxies `/api` to `http://127.0.0.1:3001` by default.
- Do not run the frontend with `API_PORT=3002` except for temporary diagnostics.

Development startup:

```bash
npm run backend
npm run frontend
```

Alternative combined startup:

```bash
npm run dev
```

If port `3001` is occupied by an old Node process, stop that process first, then start the backend again. Check runtime status with:

```http
GET /api/status
```

The status response includes:

```json
{
  "backend": {
    "host": "0.0.0.0",
    "port": 3001,
    "version": "1.0.0"
  }
}
```
