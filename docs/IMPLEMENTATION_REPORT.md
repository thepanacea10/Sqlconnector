# Teryaq SQL Connector - Implementation Report

## Status

تم إنشاء مشروع مستقل داخل:

```text
E:\Test_Almohaseb_Old\TeryaqSQLConnector
```

المشروع يفصل بين ملفات المنظومة القديمة وبين تطبيق Teryaq الجديد. التطبيق مبني كواجهة React/Vite وBackend Node.js/Express باستخدام حزمة `mssql`.

## Backend

- Express API على `0.0.0.0:3001`.
- Almohaseb Profile مخصص في `backend/profiles/almohasebProfile.js`.
- endpoints الخاصة بـAlmohaseb لا تعتمد على `config/mapping.json`.
- إدارة اتصال SQL Server عبر:
  - `POST /api/test-connection`
  - `POST /api/save-connection`
  - `GET /api/status`
- تخزين إعداد الاتصال في `config/connection.json`، وهو ملف gitignored ولا يعاد إرسال كلمة المرور إلى الواجهة بعد الحفظ.
- حارس read-only في `backend/queryGuard.js` يسمح فقط بجمل `SELECT`.
- رفض أوامر:
  - `INSERT`
  - `UPDATE`
  - `DELETE`
  - `DROP`
  - `ALTER`
  - `TRUNCATE`
  - `EXEC`
  - `MERGE`
- رفض تعدد الجمل و`SELECT INTO`.
- نظام mapping عام عبر `config/mapping.json`.
- بقي نظام mapping العام كملفات إعداد مستقبلية، لكنه خارج مسار Almohaseb الحالي.

## Frontend

- واجهة عربية RTL.
- صفحة إعداد اتصال SQL Server.
- لوحة رئيسية تعرض حالة الاتصال والسيرفر وقاعدة البيانات وآخر اتصال.
- بطاقات لمس كبيرة:
  - حسابات الزبائن
  - الأصناف
  - المخزون
  - النواقص
  - قريب الانتهاء
  - مبيعات اليوم
- وحدات قراءة فقط مع loading/error/empty states.

## Verification Performed

- تم تثبيت الحزم مرة واحدة سابقًا.
- نجح `npm run build`.
- تم إيقاف متابعة مشاكل `node_modules` المحلية بناءً على طلب المستخدم.
- لم يتم تشغيل `npm install` مرة أخرى بعد طلب الإيقاف.

## Notes

تم تنفيذ adapter مخصص لـAlmohaseb باستعلامات قراءة فقط، بدون إنشاء جداول أو views وبدون تعديل قاعدة البيانات.
