-- =====================================================================
-- Taksyn — a logo for Demo Care Services
-- TARGET: SANDBOX buqlbmgxevuldahhdbxo  ONLY.  DO NOT RUN ON LIVE.
--
-- Sample data, so the report masthead can be seen with a real
-- letterhead rather than the text fallback.
--
-- SVG rather than a raster image, stored as a data URI:
--   - 1226 characters, against the 290,571 of the one PNG already
--     on record. Roughly 1 per cent of the size.
--   - sharp at any size, including in print, where a small PNG in a
--     masthead is the usual way a document looks cheap
--   - embeds with no session and no expiry, so it survives the report
--     opening in a new window and being saved as a PDF
--
-- Worth noting for the upload path: it accepts data URIs already, and
-- nothing stops someone uploading a 300KB photograph. Compressing or
-- resizing at upload would be worth doing.
-- =====================================================================

\set ON_ERROR_STOP on

do $$
begin
  if exists (select 1 from public.organisations where id = 'ORG1780482520610') then
    raise exception 'ABORT: Kemrose found. This looks like LIVE. Sandbox-only.';
  end if;
end $$;

update public.organisations
   set logo = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzNDAgOTYiIHdpZHRoPSIzNDAiIGhlaWdodD0iOTYiPgogIDxnPgogICAgPHJlY3QgeD0iNiIgeT0iMTQiIHdpZHRoPSI2OCIgaGVpZ2h0PSI2OCIgcng9IjE4IiBmaWxsPSIjMEY3NjZFIi8+CiAgICA8cGF0aCBkPSJNMjIgNTAgTDQwIDMzIEw1OCA1MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkZGRkZGIiBzdHJva2Utd2lkdGg9IjUiCiAgICAgICAgICBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KICAgIDxwYXRoIGQ9Ik0yOCA1MCB2MTQgYTMgMyAwIDAgMCAzIDMgaDE4IGEzIDMgMCAwIDAgMyAtMyB2LTE0IgogICAgICAgICAgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjN0REM0M0IiBzdHJva2Utd2lkdGg9IjQuNSIKICAgICAgICAgIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgogICAgPGNpcmNsZSBjeD0iNDAiIGN5PSI1NiIgcj0iNSIgZmlsbD0iI0ZGRkZGRiIvPgogIDwvZz4KICA8dGV4dCB4PSI5MCIgeT0iNDYiIGZvbnQtZmFtaWx5PSJIZWx2ZXRpY2EgTmV1ZSwgSGVsdmV0aWNhLCBBcmlhbCwgc2Fucy1zZXJpZiIKICAgICAgICBmb250LXNpemU9IjI1IiBmb250LXdlaWdodD0iNzAwIiBmaWxsPSIjMTIzMTJFIiBsZXR0ZXItc3BhY2luZz0iLTAuNCI+RGVtbyBDYXJlPC90ZXh0PgogIDx0ZXh0IHg9IjkwIiB5PSI3MiIgZm9udC1mYW1pbHk9IkhlbHZldGljYSBOZXVlLCBIZWx2ZXRpY2EsIEFyaWFsLCBzYW5zLXNlcmlmIgogICAgICAgIGZvbnQtc2l6ZT0iMjUiIGZvbnQtd2VpZ2h0PSIzMDAiIGZpbGw9IiMwRjc2NkUiIGxldHRlci1zcGFjaW5nPSIxLjYiPlNFUlZJQ0VTPC90ZXh0Pgo8L3N2Zz4K'
 where id = 'ORG1990000000001';

select 'LOGO' as marker, name,
       case when logo like 'data:image/svg%' then 'svg, ' || length(logo) || ' chars'
            when logo is null then 'none'
            else 'other, ' || length(logo) || ' chars' end as stored
from public.organisations
where id in ('ORG1990000000001','ORG1900000000001');
