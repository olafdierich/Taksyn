-- 2026-09-16-branches-incident.sql
-- create_incident: store the branch, and require one once the org has an
-- active branch. Applied to SANDBOX (buqlbmgxevuldahhdbxo) 16 Sep 2026.
-- BR-11 installed; BR-12 PASSED (no-branch refused, branch stored).
-- NOT YET ON LIVE.
--
-- Applied as an in-place edit of the CURRENT function text, so every other
-- line of create_incident is kept exactly as it is on the target database.
-- The block refuses to run unless each of the four anchors appears exactly
-- once, and refuses if the change is already there.
--
-- BEFORE applying on LIVE: confirm LIVE's create_incident has the same
-- signature (text,text,integer,timestamptz,text,jsonb,jsonb) and contains
-- the four anchors (the block checks this and stops if not).
--
-- CODE FINGERPRINT after applying (comments stripped, whitespace collapsed):
--   create_incident  f5373cb898
-- Check query at the bottom.
--
-- App side: patch_incident_branch_v1.py + v2 (BRANCH-INCIDENT-V1/V2) must
-- ship together with this, or reports in orgs WITH branches are refused.
-- Orgs with no active branch are unaffected either way.

do $do$
declare
  d text;
  a text;
  anchors text[] := array[
    $a$  v_ind    uuid;    -- IND: industry this incident is categorised under$a$,
    $a$  select p.outcome_domain, p.is_statutory into v_domain, v_statutory$a$,
    $a$    industry_id,$a$,
    $a$    v_ind,$a$
  ];
begin
  d := pg_get_functiondef(
         'public.create_incident(text,text,integer,timestamptz,text,jsonb,jsonb)'::regprocedure);

  if position('v_branch' in d) > 0 then
    raise exception 'BR-11 STOP: branch change already applied';
  end if;

  foreach a in array anchors loop
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then
      raise exception 'BR-11 STOP: anchor not found exactly once: %', a;
    end if;
  end loop;

  d := replace(d, anchors[1], anchors[1] || E'\n  v_branch uuid;    -- BRANCH: where it happened');

  d := replace(d, anchors[2],
    $b$  -- BRANCH: required once the org has an active branch. The
  -- trg_check_branch trigger then confirms it is this org's and active.
  v_branch := nullif(p_payload->>'branch_id','')::uuid;
  if v_branch is null and exists (select 1 from org_branches b
                                   where b.org_id = p_org and b.is_active) then
    raise exception 'BRANCH: please choose the branch where this happened';
  end if;

$b$ || anchors[2]);

  d := replace(d, anchors[3], anchors[3] || E'\n    branch_id,');
  d := replace(d, anchors[4], anchors[4] || E'\n    v_branch,');

  execute d;
end
$do$;

-- ---------------------------------------------------------------- check
-- Expect: reads_branch true, stores_branch true, code_fingerprint f5373cb898
-- select (prosrc like '%v_branch := nullif(p_payload->>''branch_id''%') as reads_branch,
--        (prosrc like '%branch_id,%') as stores_branch,
--        left(md5(btrim(regexp_replace(
--          regexp_replace(prosrc, '--[^' || chr(10) || ']*', '', 'g'),
--          '\s+', ' ', 'g'), ' ')), 10) as code_fingerprint
-- from pg_proc
-- where oid = 'public.create_incident(text,text,integer,timestamptz,text,jsonb,jsonb)'::regprocedure;
