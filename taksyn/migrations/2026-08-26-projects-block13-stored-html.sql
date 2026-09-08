-- =====================================================================
-- Taksyn — Projects module, BLOCK 13: store the rendered report
-- RUN ON BOTH: sandbox buqlbmgxevuldahhdbxo AND live yylvtvbhddcepilzwpaw
--
-- WHY
-- project_reports stored the written conclusion and a snapshot of
-- totals, but not the document. Reopening a filed report therefore
-- re-fetched TODAY's data and re-rendered — old prose over new figures.
-- The footer admitted it, but the button said "Open", which implies
-- retrieving what was filed. It did not.
--
-- For a record that may be produced in evidence, that is not good
-- enough: "what did we tell the board in September" has to return the
-- September document.
--
-- WHAT IS STORED
-- The exact HTML that was rendered, verbatim. Reopening replays it —
-- nothing is recomputed, so nothing can differ.
--
-- Roughly 60-120KB per report as text. Ten reports a year across fifty
-- organisations is around 60MB, which is affordable for the guarantee.
-- Not compressed: a compressed column cannot be read back without the
-- application, and the point of an archive is that it survives the
-- application.
--
-- ONE LIMITATION, RECORDED HONESTLY
-- The stored HTML links to Google Fonts. On a machine with no internet
-- it renders in a fallback serif — the layout holds, the typeface
-- changes. Inlining the fonts would add ~200KB per report, and the
-- archival format is the PDF anyway.
--
-- Nullable, so reports filed before this block still open. They fall
-- back to regenerating, and the UI says so rather than pretending.
-- =====================================================================

\set ON_ERROR_STOP on
set client_min_messages = warning;

begin;

do $$
begin
  if to_regclass('public.project_reports') is null then
    raise exception 'ABORT: project_reports does not exist. Apply the projects schema first.';
  end if;
end $$;

alter table public.project_reports
  add column if not exists rendered_html text,
  add column if not exists rendered_bytes integer;

comment on column public.project_reports.rendered_html is
  'The document exactly as it was rendered when filed. Reopening replays this rather than recomputing, so a report reproduced months later is the one that was filed. Null on reports filed before block 13 — those regenerate, and the UI says so.';

commit;


-- =====================================================================
-- VERIFICATION
-- =====================================================================
select 'B13-01' as marker,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='project_reports'
       and column_name in ('rendered_html','rendered_bytes')) as new_cols,
  (select count(*) from public.project_reports)               as existing_reports,
  (select count(*) from public.project_reports
     where rendered_html is null)                             as will_regenerate;
