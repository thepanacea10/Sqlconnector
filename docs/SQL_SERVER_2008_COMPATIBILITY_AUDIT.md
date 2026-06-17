# SQL Server 2008/R2 Compatibility Audit

Scope:

- `backend/profiles/almohasebProfile.js`
- `backend/server.js`

Database impact:

- No database objects are created.
- No tables are created.
- No views are created.
- No database data is modified.

## Required Forbidden Syntax Check

| Syntax | Status |
|---|---|
| `OFFSET/FETCH` | Not used |
| `FORMAT()` | Not used |
| `CONCAT()` | Removed |
| `TRY_CONVERT()` | Not used |
| `STRING_AGG()` | Not used |
| JSON functions | Not used |
| `EOMONTH()` | Not used |
| `IIF()` | Not used |

## Additional SQL Server 2008/R2 Fix

The previous customer statement query used:

```sql
ROWS UNBOUNDED PRECEDING
```

That window-frame syntax is SQL Server 2012+. It has been replaced with a SQL Server 2008-compatible correlated aggregate over a derived table.

## Current Compatibility Notes

The Almohaseb profile uses SQL Server 2008-compatible constructs:

- `SELECT TOP`
- `OUTER APPLY`
- `UNION ALL`
- `ISNULL`
- `COALESCE`
- `CONVERT`
- `CAST`
- `DATEADD`
- derived tables
- correlated subqueries

All adapter queries remain read-only `SELECT` statements.
