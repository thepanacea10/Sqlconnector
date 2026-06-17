# AlmohasebSQL Database Analysis

## Source Files

- Schema: `C:\Users\user\Desktop\AlmohasebSQL_Schema.sql`
- Supplemental check: `C:\Users\user\Desktop\DATABASE_CHECK.md`
- Database name in schema: `AlmohasebSQL`
- SQL Server version from check file: SQL Server 2022 `16.0.1000.6`
- Integrity status from check file: `DBCC CHECKDB` OK

## Schema Summary

- Tables: 37
- Foreign keys: 28
- Non-primary nonclustered indexes: 29
- Stored procedures: 3
- Views: 0
- Triggers: 0
- User-defined functions: 0

The script is mostly schema plus Access/Jet-style extended properties. It does not include table data inserts, so account number meanings must be confirmed from live data in `The_Account`.

## Current Data Shape From DATABASE_CHECK

The live check indicates the database is structurally healthy but operationally almost empty:

- `The_Items`: 7 rows
- `The_Persons`: 3 rows
- `The_Account`: 26 rows
- `TheBody_System`: 1 row
- `The_Color`: 1 row
- `The_Group`: 1 row
- `The_FormPackaging`: 1 row
- `The_PlaceExchange`: 1 row
- `The_PlaceOffer`: 1 row
- Transactional tables such as `The_Movementrestrictions`, `The_Details`, `The_ItemDetails`, `The_Outstandingvalues`, `The_Receipts`, `The_Trade`, and `The_Barcode` currently have 0 rows in the check file.

## Core Business Tables

| Area | Tables | Notes |
|---|---|---|
| Persons | `The_Persons` | Users, clients, suppliers share one table; differentiated by `Person_Kind` |
| Accounts | `The_Account` | Chart/account types; `Account_kind` is the accounting sign |
| Invoice headers | `The_Movementrestrictions` | Header for all transactions; linked to person and account |
| Invoice lines | `The_Details` | Item lines for sales/purchases; linked to header, item, and batch/location |
| Items | `The_Items`, `The_Trade`, `The_Barcode`, `The_Units` | Item master is split across several tables |
| Stock | `The_ItemDetails` | Current quantity by item, location, offer place, expiry batch |
| Prices | `the_Charge` | Prices/rates per `ItemDetails_No` |
| Payments | `The_Outstandingvalues`, `The_Receipts` | Payment lines and cash receipt records |
| Expiry | `The_ItemDetails.Exp_date`, `The_Details.Exp_date` | Stock expiry is best read from `The_ItemDetails` |
| Inventory count | `InventoryHead`, `InventoryDetails` | Physical inventory sessions and scanned lines |

## Important Columns

### Customers / Persons

`The_Persons`

- `Person_No`: primary key
- `Person_Name`: display name
- `Person_Add`: address
- `Person_tel`: phone
- `Person_Kind`: type discriminator; check file notes `0=user`, `1=client`, `2=supplier`
- `Person_Status`: active/status flag
- `Person_Pass`: plaintext password field, should not be exposed

### Items

`The_Items`

- `Item_No`: primary key
- `Scientific_Name`: item/scientific name
- `Out_quantitative`: likely reorder/minimum threshold
- `Type_validity`: expiry tracking flag
- `Item_Status`: active/status flag
- `Item_kind`: item kind; stored procedure `Total` filters `Item_kind = 0`
- `FormPackaging_No`: package/form relation
- `Group_No`: category relation

`The_Trade`

- `Trade_Name`: trade/commercial item name
- Linked by `Item_No`

`The_Barcode`

- `Barcode`: barcode per item/unit
- Linked by `Item_No` and `Unit_No`

`The_Units`

- `Unit_Type`: unit label
- `Unit_Quantity`, `Unit_OldQuantity`, `Unit_Inverted`: conversion values
- `Default_Unit`: default unit flag

### Stock And Expiry

`The_ItemDetails`

- `ItemDetails_No`: stock batch/location key
- `Item_No`: item key
- `Item_Quantity`: current stock quantity
- `Item_Reserved`: reserved quantity
- `Item_Cost`: cost
- `PlaceExchange_No`: warehouse/location
- `PlaceOffer_No`: price/offer zone
- `Exp_date`: expiry date

### Invoices And Lines

`The_Movementrestrictions`

- `Movementrestrictions_No`: transaction/header key
- `Person_No`: customer/supplier/person
- `Account_No`: transaction/account type
- `Purchase_invoice`: external invoice number
- `Movementrestrictions_Date`: invoice date
- `Invoice_Details`: notes
- `Case_Invoice`: state flag; stored procedures filter `Case_Invoice = 0`
- `Close_Invoice`: close flag

`The_Details`

- `Details_No`: line key
- `Movementrestrictions_No`: header key
- `Item_No`: item key
- `Barcode`: barcode at movement time
- `ItemDetails_No`: stock batch/location key
- `Charge_Value`: line price
- `Item_Cost`: cost
- `Item_Quntity`: quantity
- `Exp_date`: expiry date captured on line

### Payments

`The_Outstandingvalues`

- `Outstandingvalues_No`: payment line key
- `Movementrestrictions_No`: invoice/header key
- `Value_paid`: paid amount
- `Date_paid`: payment date
- `Type_Payment`: payment type
- `Person_No`: person
- `Account_No`: account
- `Comment`: notes

`The_Receipts`

- `Receipts_No`: receipt key
- `User_no`: FK to `The_Persons.Person_No`
- `Value_received`: receipt amount
- `Date_Received`: receipt date
- `Type_Payment`: payment type

## Relationship Map

Key relationships needed by Teryaq:

- `The_Movementrestrictions.Person_No -> The_Persons.Person_No`
- `The_Movementrestrictions.Account_No -> The_Account.Account_No`
- `The_Details.Movementrestrictions_No -> The_Movementrestrictions.Movementrestrictions_No`
- `The_Details.Item_No -> The_Items.Item_No`
- `The_Details.ItemDetails_No -> The_ItemDetails.ItemDetails_No`
- `The_ItemDetails.Item_No -> The_Items.Item_No`
- `The_ItemDetails.PlaceExchange_No -> The_PlaceExchange.PlaceExchange_No`
- `The_ItemDetails.PlaceOffer_No -> The_PlaceOffer.PlaceOffer_No`
- `The_Barcode.Item_No -> The_Items.Item_No`
- `The_Trade.Item_No -> The_Items.Item_No`
- `The_Units.Item_No -> The_Items.Item_No`
- `the_Charge.ItemDetails_No -> The_ItemDetails.ItemDetails_No`
- `The_Outstandingvalues.Movementrestrictions_No -> The_Movementrestrictions.Movementrestrictions_No`
- `The_Receipts.User_no -> The_Persons.Person_No`

## Stored Procedures

- `Total`: computes total inventory value from `The_ItemDetails`, `The_Units`, and `The_Items` where `Item_kind = 0`.
- `AllSupply`: computes total for account numbers `7,8,11,12,24` with `Case_Invoice = 0`.
- `AllCredit`: computes total for account numbers `2,4,5,6,9,10,23` with `Case_Invoice = 0`.

These procedures use temporary tables and `SELECT INTO`, so the Teryaq read-only query guard should not call them through `/api/query-readonly`.

## Fit With Teryaq SQL Connector

### Direct Mapping Works For

Customer basics:

- `customersTable`: `dbo.The_Persons`
- `customerIdField`: `Person_No`
- `customerNameField`: `Person_Name`
- `customerPhoneField`: `Person_tel`
- `customerAddressField`: `Person_Add`

Basic item identity can be partially mapped:

- `itemsTable`: `dbo.The_Items`
- `itemIdField`: `Item_No`
- `itemNameField`: `Scientific_Name`

### Direct Mapping Is Not Enough For

The current generic `mapping.json` assumes many dashboard modules can read one table. Almohaseb splits those entities:

- Item display name may be `The_Items.Scientific_Name` or `The_Trade.Trade_Name`.
- Barcode is in `The_Barcode`, not `The_Items`.
- Quantity, cost, location, and expiry are in `The_ItemDetails`, not `The_Items`.
- Selling prices are in `the_Charge`, not `The_Items`.
- Invoice total is computed from `The_Details`, not stored in `The_Movementrestrictions`.
- Paid/remaining values require `The_Outstandingvalues`.
- Ledger is not a single table; it must be composed from invoices and payments.

## Recommended Read-Only Query Strategy

For Almohaseb support, add an app-level adapter or read-only query templates. Do not require the app to create database objects in version 1.

### Customers

Use `The_Persons`, preferably filtered to clients:

```sql
SELECT
  Person_No AS id,
  Person_Name AS name,
  Person_tel AS phone,
  Person_Add AS address
FROM dbo.The_Persons
WHERE Person_Kind = 1
```

### Customer Invoices

Use `The_Movementrestrictions` for headers and aggregate lines from `The_Details`.

```sql
SELECT
  mr.Movementrestrictions_No AS invoiceNumber,
  mr.Movementrestrictions_Date AS [date],
  SUM(ISNULL(d.Charge_Value, 0) * ISNULL(d.Item_Quntity, 0)) AS total,
  SUM(ISNULL(ov.Value_paid, 0)) AS paid,
  SUM(ISNULL(d.Charge_Value, 0) * ISNULL(d.Item_Quntity, 0)) - SUM(ISNULL(ov.Value_paid, 0)) AS remaining
FROM dbo.The_Movementrestrictions mr
LEFT JOIN dbo.The_Details d
  ON d.Movementrestrictions_No = mr.Movementrestrictions_No
LEFT JOIN dbo.The_Outstandingvalues ov
  ON ov.Movementrestrictions_No = mr.Movementrestrictions_No
WHERE mr.Person_No = @id
GROUP BY mr.Movementrestrictions_No, mr.Movementrestrictions_Date
```

### Inventory

Use item master plus stock batches:

```sql
SELECT
  i.Item_No AS id,
  COALESCE(t.Trade_Name, i.Scientific_Name) AS itemName,
  SUM(ISNULL(idt.Item_Quantity, 0) - ISNULL(idt.Item_Reserved, 0)) AS availableQuantity,
  MAX(u.Unit_Type) AS unit,
  MAX(idt.Item_Cost) AS cost,
  MAX(c.Charge_Value) AS sellingPrice
FROM dbo.The_Items i
LEFT JOIN dbo.The_Trade t ON t.Item_No = i.Item_No
LEFT JOIN dbo.The_ItemDetails idt ON idt.Item_No = i.Item_No
LEFT JOIN dbo.The_Units u ON u.Item_No = i.Item_No AND u.Default_Unit = 1
LEFT JOIN dbo.the_Charge c ON c.ItemDetails_No = idt.ItemDetails_No AND c.Default_Charge = 1
GROUP BY i.Item_No, COALESCE(t.Trade_Name, i.Scientific_Name)
```

### Shortages

Use `The_Items.Out_quantitative` as the likely minimum/reorder quantity and compare it with current stock.

### Expiry

Use `The_ItemDetails.Exp_date` for batches that exist in stock.

### Sales Today

Use `The_Movementrestrictions.Movementrestrictions_Date` and `The_Details` aggregation. Account filtering needs confirmation from live `The_Account` rows, because the schema does not define which `Account_No` values represent sales.

## Security Observations

- `The_Persons.Person_Pass` stores plaintext passwords. Teryaq must never expose this field.
- Use a SQL login with read-only permissions only.
- Avoid calling stored procedures through the generic query endpoint because the procedures create temp tables with `SELECT INTO`.
- Keep Teryaq’s read-only guard active even if the SQL login is read-only.

## Application Logic Recommendation

The generic mapping layer should remain for simple databases. For Almohaseb, add one of these:

1. `databaseProfile: "almohaseb"` with hard-coded read-only SELECT templates for the split schema.
2. A more expressive mapping file that supports joins, calculated fields, filters, and group-by definitions.
3. Optional DBA-created read-only views such as `vw_TeryaqCustomers`, `vw_TeryaqInventory`, `vw_TeryaqInvoices`, and then point the current mapping file at those views.

Option 1 is the fastest and safest for this existing schema. Option 2 is more flexible but more complex. Option 3 keeps app code simple but requires database-side setup.

## Implemented Profile

تم تنفيذ Option 1 في التطبيق:

- الملف: `backend/profiles/almohasebProfile.js`
- لا يعتمد على `config/mapping.json`
- لا ينشئ جداولًا
- لا ينشئ Views
- لا يعدل قاعدة البيانات
- كل الاستعلامات تمر عبر `executeReadonlyQuery`

الـProfile يغطي:

- Customers: من `The_Persons`
- Customer invoices: من `The_Movementrestrictions` و`The_Details` و`The_Outstandingvalues`
- Customer receipts: من `The_Receipts` و`The_Outstandingvalues`
- Customer statement: ledger مركب من الفواتير والدفعات وسندات القبض
- Inventory: من `The_Items` مع `The_ItemDetails`, `The_Trade`, `The_Barcode`, `The_Units`, `the_Charge`
- Shortages: مقارنة `The_Items.Out_quantitative` مع كمية `The_ItemDetails`
- Expiry: من `The_ItemDetails.Exp_date`
