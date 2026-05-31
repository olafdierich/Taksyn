import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabase.js'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const ROLES = ['super_admin', 'client_admin', 'manager', 'supervisor', 'worker']

const ROLE_LABELS = {
  super_admin:  'Super Admin',
  client_admin: 'Client Admin',
  manager:      'Manager',
  supervisor:   'Supervisor',
  worker:       'Worker',
}

const ROLE_COLORS = {
  super_admin:  '#F59E0B',
  client_admin: '#8B5CF6',
  manager:      '#3B82F6',
  supervisor:   '#10B981',
  worker:       '#6B7280',
}

const TIERS = {
  Personal:     { color:'#6B7280', price:'$3',   users:'1–3',    features:['Basic task tracking','Simple checklists','Reminders'],                                              locked:['Escalation','Hierarchy','Reporting','Exports'] },
  Starter:      { color:'#3B82F6', price:'$8',   users:'1–10',   features:['Task assignment','Checklists','Photo evidence','Basic reporting'],                                  locked:['Escalation','Advanced reporting'] },
  Growth:       { color:'#10B981', price:'$10',  users:'11–30',  features:['Escalation cascade','Supervisor dashboards','Performance tracking','Excel export'],                 locked:[] },
  Professional: { color:'#8B5CF6', price:'$10',  users:'31–100', features:['Multi-site support','Advanced escalation','Audit-ready reporting','Supervisor accountability'],      locked:[] },
  Enterprise:   { color:'#F59E0B', price:'Custom',users:'100+',  features:['Full compliance suite','API integrations','Custom workflows','White-labelling','SLA onboarding'],   locked:[] },
}

const STATUS_CFG = {
  pending:         { label:'Pending',         color:'#6B7280', bg:'rgba(107,114,128,.15)' },
  in_progress:     { label:'In Progress',     color:'#3B82F6', bg:'rgba(59,130,246,.15)'  },
  completed:       { label:'Completed',       color:'#10B981', bg:'rgba(16,185,129,.15)'  },
  awaiting_review: { label:'Awaiting Review', color:'#F59E0B', bg:'rgba(245,158,11,.15)'  },
  overdue:         { label:'Overdue',         color:'#EF4444', bg:'rgba(239,68,68,.15)'   },
  escalated:       { label:'Escalated',       color:'#EF4444', bg:'rgba(239,68,68,.15)'   },
  approved:        { label:'Approved',        color:'#10B981', bg:'rgba(16,185,129,.15)'  },
  rejected:        { label:'Rejected',        color:'#EF4444', bg:'rgba(239,68,68,.15)'   },
}

const PRIORITY_CFG = {
  critical: { label:'Critical', color:'#EF4444' },
  high:     { label:'High',     color:'#F97316' },
  medium:   { label:'Medium',   color:'#F59E0B' },
  low:      { label:'Low',      color:'#10B981' },
}

const CAT_ICONS = {
  Housekeeping:'🏨', Kitchen:'🍽️', Safety:'🛡️', Clinical:'🏥',
  NDIS:'♿', Maintenance:'🔧', HR:'👥', General:'📋',
}

// Demo seed tasks used when Supabase is not configured
const DEMO_TASKS = [
  { id:'T001', title:'Clean Rooms 301–315',          category:'Housekeeping', assigned_role:'worker',    status:'in_progress',     priority:'high',    due_date:'2026-06-01', compliance:true,  escalation:false, subtasks:[{t:'Strip linen',done:true},{t:'Replace towels',done:true},{t:'Clean bathroom',done:false},{t:'Vacuum floors',done:false}], evidence:[], comments:[] },
  { id:'T002', title:'Daily Kitchen Compliance',     category:'Kitchen',      assigned_role:'worker',    status:'pending',         priority:'critical', due_date:'2026-06-01', compliance:true,  escalation:false, subtasks:[{t:'Check fridge temp',done:false},{t:'Check freezer',done:false},{t:'Inspect storage',done:false},{t:'Verify labelling',done:false}], evidence:[], comments:[] },
  { id:'T003', title:'Daily Safety Inspection',      category:'Safety',       assigned_role:'supervisor',status:'completed',        priority:'critical', due_date:'2026-05-31', compliance:true,  escalation:false, subtasks:[{t:'Fire exits clear',done:true},{t:'Extinguishers OK',done:true},{t:'Emergency lighting',done:true}], evidence:['📷 safety_check.jpg'], comments:['All clear'] },
  { id:'T004', title:'Medication Audit',             category:'Clinical',     assigned_role:'worker',    status:'overdue',         priority:'critical', due_date:'2026-05-30', compliance:true,  escalation:true,  subtasks:[{t:'Verify med chart',done:true},{t:'Confirm dosage',done:true},{t:'Administer',done:false},{t:'Record admin',done:false}], evidence:[], comments:[] },
  { id:'T005', title:'SIL House Safety Check',       category:'NDIS',         assigned_role:'worker',    status:'pending',         priority:'high',    due_date:'2026-06-01', compliance:true,  escalation:false, subtasks:[{t:'Exits clear',done:false},{t:'Locks working',done:false},{t:'Smoke alarms OK',done:false},{t:'Meds stored correctly',done:false}], evidence:[], comments:[] },
  { id:'T006', title:'Front Desk Daily Setup',       category:'Housekeeping', assigned_role:'worker',    status:'awaiting_review', priority:'medium',  due_date:'2026-05-31', compliance:false, escalation:false, subtasks:[{t:'Check bookings',done:true},{t:'Prepare keys',done:true},{t:'Payment system',done:true}], evidence:['📷 desk_photo.jpg'], comments:[] },
  { id:'T007', title:'Property Maintenance Check',   category:'Maintenance',  assigned_role:'supervisor',status:'awaiting_review', priority:'medium',  due_date:'2026-06-01', compliance:false, escalation:false, subtasks:[{t:'Check plumbing',done:true},{t:'Electrical OK',done:true},{t:'AC units',done:true}], evidence:['📷 maintenance.jpg'], comments:['Minor leak fixed'] },
  { id:'T008', title:'Staff Compliance Audit',       category:'HR',           assigned_role:'manager',   status:'pending',         priority:'medium',  due_date:'2026-06-03', compliance:true,  escalation:false, subtasks:[{t:'Verify certs',done:false},{t:'Check expiry dates',done:false},{t:'Confirm training',done:false}], evidence:[], comments:[] },
]

// ─── STYLES ───────────────────────────────────────────────────────────────────

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800&family=DM+Mono:wght@400;500&display=swap');

*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#0B0F17;color:#E2E8F4;font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased}

:root{
  --brand:#00C896;--brand-dk:#00A87E;--brand-lt:rgba(0,200,150,.12);
  --surface:#0B0F17;--s2:#111620;--s3:#181F2E;--s4:#1E2738;
  --border:rgba(255,255,255,.07);--border2:rgba(255,255,255,.12);
  --text:#E2E8F4;--t2:#8B96AA;--t3:#3F4D63;
  --red:#EF4444;--amber:#F59E0B;--blue:#3B82F6;--green:#10B981;--purple:#8B5CF6;
  --r:10px;--rs:6px;--shadow:0 8px 32px rgba(0,0,0,.5);
}

/* ── AUTH ── */
.auth-bg{min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse 80% 60% at 50% 0%,rgba(0,200,150,.08) 0%,transparent 70%),var(--surface);padding:20px}
.auth-card{background:var(--s2);border:1px solid var(--border2);border-radius:16px;padding:40px;width:100%;max-width:420px;box-shadow:var(--shadow)}
.auth-logo{display:flex;align-items:center;gap:10px;font-size:22px;font-weight:800;color:var(--brand);letter-spacing:-0.5px;margin-bottom:32px}
.auth-logo svg{width:36px;height:36px}
.auth-title{font-size:20px;font-weight:700;margin-bottom:6px}
.auth-sub{font-size:13px;color:var(--t2);margin-bottom:28px}
.auth-field{margin-bottom:16px}
.auth-label{font-size:11px;font-weight:600;color:var(--t2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px;display:block}
.auth-input{width:100%;background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);padding:11px 14px;color:var(--text);font-size:14px;font-family:inherit;outline:none;transition:border-color .2s}
.auth-input:focus{border-color:var(--brand)}
.auth-btn{width:100%;padding:12px;background:var(--brand);border:none;border-radius:var(--rs);color:#000;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s;margin-top:4px}
.auth-btn:hover{background:var(--brand-dk)}
.auth-btn:disabled{opacity:.5;cursor:not-allowed}
.auth-error{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);border-radius:var(--rs);padding:10px 14px;font-size:13px;color:var(--red);margin-bottom:16px}
.auth-toggle{text-align:center;font-size:13px;color:var(--t2);margin-top:20px}
.auth-toggle a{color:var(--brand);cursor:pointer;font-weight:600}
.auth-divider{text-align:center;color:var(--t3);font-size:12px;margin:20px 0;position:relative}
.auth-divider::before{content:'';position:absolute;top:50%;left:0;right:0;height:1px;background:var(--border)}
.auth-divider span{background:var(--s2);padding:0 12px;position:relative}
.demo-accounts{display:flex;flex-direction:column;gap:8px}
.demo-btn{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);cursor:pointer;transition:all .15s;font-family:inherit;color:var(--text);text-align:left;width:100%}
.demo-btn:hover{border-color:var(--brand);background:var(--brand-lt)}
.demo-role{font-size:12px;font-weight:700;padding:2px 8px;border-radius:4px}
.demo-info{font-size:12px;color:var(--t2)}

/* ── APP SHELL ── */
.app{display:flex;flex-direction:column;height:100vh;overflow:hidden}

/* ── TOPBAR ── */
.topbar{display:flex;align-items:center;gap:14px;padding:0 22px;height:56px;background:var(--s2);border-bottom:1px solid var(--border);flex-shrink:0;z-index:100}
.tb-logo{display:flex;align-items:center;gap:9px;font-weight:800;font-size:17px;color:var(--brand);letter-spacing:-.5px;text-decoration:none}
.tb-logo svg{width:26px;height:26px}
.tb-sep{width:1px;height:20px;background:var(--border);margin:0 4px}
.tb-org{font-size:12px;color:var(--t2);font-weight:500}
.tb-space{flex:1}
.tb-search{display:flex;align-items:center;gap:8px;background:var(--s3);border:1px solid var(--border);border-radius:8px;padding:6px 12px;width:200px}
.tb-search input{background:none;border:none;outline:none;color:var(--text);font-size:13px;width:100%;font-family:inherit}
.tb-search input::placeholder{color:var(--t3)}
.tb-icon-btn{position:relative;background:none;border:none;color:var(--t2);cursor:pointer;padding:6px;border-radius:6px;display:flex;align-items:center;justify-content:center;transition:all .15s}
.tb-icon-btn:hover{background:var(--s3);color:var(--text)}
.tb-badge{position:absolute;top:1px;right:1px;width:16px;height:16px;border-radius:50%;background:var(--red);font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;color:#fff;pointer-events:none}
.tb-user{display:flex;align-items:center;gap:9px;cursor:pointer;padding:5px 10px;border-radius:8px;transition:all .15s;border:1px solid transparent}
.tb-user:hover{background:var(--s3);border-color:var(--border)}
.tb-avatar{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0}
.tb-user-info{line-height:1.3}
.tb-user-name{font-size:12px;font-weight:600}
.tb-user-role{font-size:10px;color:var(--t2)}

/* ── LAYOUT ── */
.main{display:flex;flex:1;overflow:hidden}
.sidebar{width:214px;flex-shrink:0;background:var(--s2);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow-y:auto}
.sb-section{padding:16px 10px 6px}
.sb-label{font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;padding:0 8px 8px}
.nav-item{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:var(--rs);cursor:pointer;color:var(--t2);font-size:13px;font-weight:500;transition:all .15s;border:none;background:none;width:100%;text-align:left;font-family:inherit}
.nav-item:hover{background:var(--s3);color:var(--text)}
.nav-item.active{background:var(--brand-lt);color:var(--brand)}
.nav-item svg{width:15px;height:15px;flex-shrink:0}
.nav-badge{margin-left:auto;background:var(--red);color:#fff;font-size:9px;font-weight:700;padding:1px 6px;border-radius:10px;min-width:18px;text-align:center}
.nav-badge.amber{background:var(--amber);color:#000}
.nav-badge.blue{background:var(--blue)}
.sb-bottom{margin-top:auto;padding:12px 10px;border-top:1px solid var(--border)}
.sb-user-card{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--rs);background:var(--s3)}
.sb-logout{width:100%;margin-top:8px;padding:7px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);border-radius:var(--rs);color:var(--red);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s}
.sb-logout:hover{background:rgba(239,68,68,.2)}

/* ── CONTENT ── */
.content{flex:1;overflow-y:auto;padding:26px}

/* ── PAGE HEADER ── */
.ph{margin-bottom:22px}
.ph-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.ph-title{font-size:20px;font-weight:800;letter-spacing:-.5px}
.ph-sub{font-size:12px;color:var(--t2);margin-top:3px}

/* ── STAT GRID ── */
.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
@media(max-width:900px){.stat-grid{grid-template-columns:repeat(2,1fr)}}
.stat-card{background:var(--s2);border:1px solid var(--border);border-radius:var(--r);padding:16px;transition:border-color .2s}
.stat-card:hover{border-color:var(--border2)}
.sc-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.sc-label{font-size:11px;color:var(--t2);font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.sc-icon{width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px}
.sc-val{font-size:24px;font-weight:800;letter-spacing:-1px;line-height:1}
.sc-sub{font-size:11px;color:var(--t2);margin-top:3px}

/* ── SECTIONS ── */
.section{background:var(--s2);border:1px solid var(--border);border-radius:var(--r);padding:18px;margin-bottom:14px}
.section-title{font-size:11px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:14px}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:720px){.two-col{grid-template-columns:1fr}}

/* ── TASKS ── */
.filter-bar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.fb{padding:5px 11px;border-radius:var(--rs);border:1px solid var(--border);background:transparent;color:var(--t2);font-size:12px;font-weight:500;cursor:pointer;transition:all .15s;font-family:inherit;white-space:nowrap}
.fb:hover{background:var(--s3);color:var(--text)}
.fb.active{background:var(--brand-lt);border-color:var(--brand);color:var(--brand)}

.task-card{background:var(--s2);border:1px solid var(--border);border-radius:var(--r);padding:15px;margin-bottom:9px;cursor:pointer;transition:all .15s;position:relative;overflow:hidden}
.task-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px}
.task-card.critical::before{background:var(--red)}
.task-card.high::before{background:#F97316}
.task-card.medium::before{background:var(--amber)}
.task-card.low::before{background:var(--green)}
.task-card:hover{border-color:var(--border2);transform:translateY(-1px)}
.tc-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.tc-title{font-size:14px;font-weight:600;flex:1}
.tc-meta{display:flex;align-items:center;gap:7px;margin-top:8px;flex-wrap:wrap}
.tc-progress{margin-top:10px}
.pb-bg{height:3px;background:var(--s3);border-radius:2px;overflow:hidden;margin-top:3px}
.pb-fill{height:100%;border-radius:2px;background:var(--brand);transition:width .3s}
.esc-flag{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--red);font-weight:600;margin-top:6px}

/* ── BADGES ── */
.badge{display:inline-flex;align-items:center;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600;white-space:nowrap}
.cat-tag{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--t2);background:var(--s3);padding:2px 8px;border-radius:4px}
.role-pill{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700}

/* ── TASK DETAIL ── */
.back-btn{display:inline-flex;align-items:center;gap:6px;color:var(--t2);font-size:13px;font-weight:500;cursor:pointer;background:none;border:none;font-family:inherit;margin-bottom:16px;transition:color .15s}
.back-btn:hover{color:var(--text)}
.detail-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px}
.subtask-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer}
.subtask-row:last-child{border-bottom:none}
.checkbox{width:18px;height:18px;border-radius:4px;border:2px solid var(--border2);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s}
.checkbox.checked{background:var(--brand);border-color:var(--brand)}
.subtask-text{font-size:13px;flex:1}
.subtask-text.done{text-decoration:line-through;color:var(--t2)}
.evidence-zone{border:2px dashed var(--border);border-radius:var(--r);padding:24px;text-align:center;cursor:pointer;transition:all .2s}
.evidence-zone:hover{border-color:var(--brand);background:var(--brand-lt)}
.ev-thumbs{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.ev-thumb{width:64px;height:64px;border-radius:var(--rs);background:var(--s3);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:20px;position:relative}
.ev-rm{position:absolute;top:-5px;right:-5px;width:16px;height:16px;border-radius:50%;background:var(--red);color:#fff;font-size:9px;display:flex;align-items:center;justify-content:center;cursor:pointer}
.comment-box{width:100%;background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);padding:10px 12px;color:var(--text);font-size:13px;font-family:inherit;resize:vertical;min-height:56px;outline:none;transition:border-color .2s}
.comment-box:focus{border-color:var(--brand)}
.comment-item{padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--t2)}
.comment-item:last-child{border-bottom:none}

/* ── BUTTONS ── */
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:var(--rs);font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;border:none;font-family:inherit;white-space:nowrap}
.btn-primary{background:var(--brand);color:#000}
.btn-primary:hover{background:var(--brand-dk)}
.btn-secondary{background:var(--s3);color:var(--text);border:1px solid var(--border)}
.btn-secondary:hover{background:var(--s4)}
.btn-danger{background:rgba(239,68,68,.12);color:var(--red);border:1px solid rgba(239,68,68,.25)}
.btn-danger:hover{background:rgba(239,68,68,.22)}
.btn-amber{background:rgba(245,158,11,.12);color:var(--amber);border:1px solid rgba(245,158,11,.25)}
.btn-amber:hover{background:rgba(245,158,11,.22)}
.btn-sm{padding:5px 10px;font-size:12px}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}

/* ── ESCALATION BANNER ── */
.esc-banner{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:var(--r);padding:13px 16px;display:flex;align-items:center;gap:12px;margin-bottom:16px}
.esc-banner-body{flex:1}
.esc-banner-title{font-size:13px;font-weight:700;color:var(--red)}
.esc-banner-sub{font-size:12px;color:var(--t2);margin-top:2px}

/* ── TABLE ── */
.tbl{width:100%;border-collapse:collapse;font-size:13px}
.tbl th{text-align:left;padding:9px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--t2);border-bottom:1px solid var(--border)}
.tbl td{padding:11px 12px;border-bottom:1px solid var(--border);vertical-align:middle}
.tbl tr:last-child td{border-bottom:none}
.tbl tr:hover td{background:rgba(255,255,255,.015)}
.mono{font-family:'DM Mono',monospace;font-size:11px;color:var(--t2)}

/* ── PROGRESS ── */
.mini-prog{display:flex;align-items:center;gap:8px}
.mini-prog-bar{width:70px;height:3px;background:var(--s3);border-radius:2px;overflow:hidden}
.mini-prog-fill{height:100%;border-radius:2px}

/* ── SCORE ── */
.score-ring{width:74px;height:74px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;border:3px solid var(--brand);flex-shrink:0}
.score-val{font-size:18px;font-weight:800;color:var(--brand);line-height:1}
.score-lbl{font-size:9px;color:var(--t2);margin-top:1px}

/* ── TIERS ── */
.tier-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:24px}
@media(max-width:1100px){.tier-grid{grid-template-columns:repeat(3,1fr)}}
@media(max-width:700px){.tier-grid{grid-template-columns:repeat(2,1fr)}}
.tier-card{background:var(--s2);border:2px solid var(--border);border-radius:var(--r);padding:18px;display:flex;flex-direction:column;gap:10px;transition:all .2s}
.tier-card:hover{transform:translateY(-3px)}
.tier-card.active{box-shadow:0 0 0 1px var(--brand)}
.tier-name{font-size:15px;font-weight:800}
.tier-price{font-size:20px;font-weight:800;letter-spacing:-1px}
.tier-price span{font-size:11px;font-weight:400;color:var(--t2)}
.tier-feat{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--t2)}
.tier-feat.locked{opacity:.35}
.tier-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0}

/* ── USER MANAGEMENT ── */
.user-row{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)}
.user-row:last-child{border-bottom:none}
.user-av{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0}
.user-info{flex:1}
.user-name{font-size:13px;font-weight:600}
.user-email{font-size:11px;color:var(--t2);margin-top:1px}

/* ── NOTIF ── */
.notif-item{background:var(--s3);border-radius:var(--rs);padding:11px;border-left:3px solid var(--brand);margin-bottom:8px}
.notif-item.urgent{border-left-color:var(--red)}
.notif-item.amber{border-left-color:var(--amber)}
.notif-title{font-size:13px;font-weight:600}
.notif-sub{font-size:11px;color:var(--t2);margin-top:2px}

/* ── FORM ── */
.form-field{margin-bottom:14px}
.form-label{font-size:11px;font-weight:600;color:var(--t2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px;display:block}
.form-input{width:100%;background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);padding:9px 12px;color:var(--text);font-size:13px;font-family:inherit;outline:none;transition:border-color .2s}
.form-input:focus{border-color:var(--brand)}
.form-select{width:100%;background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);padding:9px 12px;color:var(--text);font-size:13px;font-family:inherit;outline:none;appearance:none;cursor:pointer}

/* ── MODAL ── */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}
.modal{background:var(--s2);border:1px solid var(--border2);border-radius:14px;width:100%;max-width:500px;max-height:85vh;overflow-y:auto;box-shadow:var(--shadow)}
.modal-hdr{display:flex;align-items:center;justify-content:space-between;padding:20px 22px 0}
.modal-title{font-size:15px;font-weight:700}
.modal-close{background:none;border:none;color:var(--t2);cursor:pointer;font-size:22px;line-height:1;padding:2px}
.modal-body{padding:18px 22px 22px}

/* ── MISC ── */
.empty{text-align:center;padding:48px 20px;color:var(--t2)}
.empty-icon{font-size:36px;margin-bottom:10px}
.empty-text{font-size:13px}
.tabs{display:flex;gap:2px;background:var(--s3);border-radius:8px;padding:3px;margin-bottom:18px}
.tab{flex:1;padding:6px 10px;border-radius:6px;border:none;background:transparent;color:var(--t2);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s}
.tab.active{background:var(--s2);color:var(--text);box-shadow:0 1px 4px rgba(0,0,0,.3)}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.anim{animation:fadeUp .2s ease}
::-webkit-scrollbar{width:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--s3);border-radius:3px}
.loading{display:flex;align-items:center;justify-content:center;height:100%;color:var(--t2);font-size:14px;gap:10px}
@keyframes spin{to{transform:rotate(360deg)}}
.spinner{width:18px;height:18px;border:2px solid var(--border);border-top-color:var(--brand);border-radius:50%;animation:spin .7s linear infinite}
`

// ─── TINY ICON ────────────────────────────────────────────────────────────────
const IC = ({ n, s=16 }) => {
  const paths = {
    home:    'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    tasks:   'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
    users:   'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
    alert:   'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
    chart:   'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    img:     'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
    shield:  'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    logout:  'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
    search:  'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0',
    bell:    'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
    check:   'M5 13l4 4L19 7',
    plus:    'M12 4v16m8-8H4',
    tier:    'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z',
    x:       'M6 18L18 6M6 6l12 12',
  }
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d={paths[n]} />
    </svg>
  )
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const pct = (a,b) => b ? Math.round(a/b*100) : 0
const taskPct = t => pct(t.subtasks.filter(s=>s.done).length, t.subtasks.length)
const initials = name => name ? name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) : '??'
const avatarColor = role => ROLE_COLORS[role] || '#6B7280'

// ─── SUPABASE HELPERS ─────────────────────────────────────────────────────────
const isConfigured = () => {
  const url = import.meta.env.VITE_SUPABASE_URL
  return url && url !== 'https://placeholder.supabase.co' && !url.includes('YOUR_PROJECT')
}

// ─── SMALL UI COMPONENTS ─────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const c = STATUS_CFG[status] || STATUS_CFG.pending
  return <span className="badge" style={{color:c.color,background:c.bg}}>{c.label}</span>
}
const PriBadge = ({ priority }) => {
  const c = PRIORITY_CFG[priority] || PRIORITY_CFG.medium
  return <span className="badge" style={{color:c.color,background:`${c.color}22`}}>{c.label}</span>
}
const RolePill = ({ role }) => (
  <span className="role-pill" style={{color:avatarColor(role),background:`${avatarColor(role)}22`}}>
    {ROLE_LABELS[role]||role}
  </span>
)
const Avatar = ({ name, role, size=30 }) => (
  <div className="tb-avatar" style={{width:size,height:size,background:`${avatarColor(role)}22`,color:avatarColor(role)}}>
    {initials(name)}
  </div>
)
const Stat = ({ label, val, sub, icon, color='#00C896', bg='rgba(0,200,150,.12)' }) => (
  <div className="stat-card">
    <div className="sc-top">
      <span className="sc-label">{label}</span>
      <div className="sc-icon" style={{background:bg,color}}>{icon}</div>
    </div>
    <div className="sc-val" style={{color}}>{val}</div>
    <div className="sc-sub">{sub}</div>
  </div>
)

// ─── TASK CARD ─────────────────────────────────────────────────────────────────
const TaskCard = ({ task, onClick, assigneeName }) => {
  const p = taskPct(task)
  return (
    <div className={`task-card ${task.priority}`} onClick={onClick}>
      <div className="tc-top">
        <div style={{flex:1}}>
          <span className="cat-tag">{CAT_ICONS[task.category]||'📋'} {task.category}</span>
          <div className="tc-title" style={{marginTop:6}}>{task.title}</div>
        </div>
        <StatusBadge status={task.status} />
      </div>
      <div className="tc-meta">
        <PriBadge priority={task.priority} />
        <span style={{fontSize:11,color:'var(--t2)'}}>📅 {task.due_date}</span>
        {assigneeName && <span style={{fontSize:11,color:'var(--t2)'}}>👤 {assigneeName}</span>}
        {task.evidence?.length>0 && <span style={{fontSize:11,color:'var(--t2)'}}>📷 {task.evidence.length}</span>}
        {task.compliance && <span className="badge" style={{background:'rgba(139,92,246,.15)',color:'#8B5CF6'}}>🔒 Compliance</span>}
      </div>
      {task.subtasks?.length>0 && (
        <div className="tc-progress">
          <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--t2)'}}>
            <span>{task.subtasks.filter(s=>s.done).length}/{task.subtasks.length} subtasks</span>
            <span>{p}%</span>
          </div>
          <div className="pb-bg"><div className="pb-fill" style={{width:`${p}%`}} /></div>
        </div>
      )}
      {task.escalation && <div className="esc-flag">⚠️ Escalated</div>}
    </div>
  )
}

// ─── AUTH VIEW ────────────────────────────────────────────────────────────────
const DEMO_ACCOUNTS = [
  { email:'admin@taksyn.demo',      password:'Demo1234!', role:'super_admin',  name:'You (Super Admin)',  desc:'Full platform access' },
  { email:'clientadmin@taksyn.demo',password:'Demo1234!', role:'client_admin', name:'Client Admin',       desc:'Manage org & teams' },
  { email:'manager@taksyn.demo',    password:'Demo1234!', role:'manager',      name:'Manager',            desc:'Team oversight' },
  { email:'supervisor@taksyn.demo', password:'Demo1234!', role:'supervisor',   name:'Supervisor',         desc:'Review evidence' },
  { email:'worker@taksyn.demo',     password:'Demo1234!', role:'worker',       name:'Worker',             desc:'Complete tasks' },
]

function AuthView({ onAuth }) {
  const [mode, setMode] = useState('login') // login | register
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('worker')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Demo mode: fake auth without Supabase
  const demoLogin = (account) => {
    onAuth({
      id: account.role,
      email: account.email,
      name: account.name.replace(' (Super Admin)',''),
      role: account.role,
      tier: account.role === 'super_admin' ? 'Enterprise' : account.role === 'client_admin' ? 'Professional' : 'Growth',
      org: 'BrightCare Operations',
    })
  }

  const handleSubmit = async () => {
    setError('')
    if (!email || !password) { setError('Please fill in all fields'); return }
    setLoading(true)
    try {
      if (!isConfigured()) {
        // Demo mode — match against demo accounts
        const found = DEMO_ACCOUNTS.find(a => a.email === email && a.password === password)
        if (found) { demoLogin(found); return }
        // Or allow any login as worker for trial
        onAuth({ id: email, email, name: name || email.split('@')[0], role: 'worker', tier: 'Growth', org: 'Demo Org' })
        return
      }
      if (mode === 'register') {
        const { data, error: e } = await supabase.auth.signUp({ email, password, options:{ data:{ name, role } } })
        if (e) throw e
        setError('Check your email to confirm your account, then sign in.')
        setMode('login')
      } else {
        const { data, error: e } = await supabase.auth.signInWithPassword({ email, password })
        if (e) throw e
        // Profile is fetched in App after auth state change
      }
    } catch(e) {
      setError(e.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-bg">
      <style>{CSS}</style>
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/logo.jpeg" alt="Taksyn" style={{height:44,objectFit:'contain'}} />
        </div>
        <div className="auth-title">{mode==='login' ? 'Sign in to your account' : 'Create your account'}</div>
        <div className="auth-sub">{mode==='login' ? 'Task compliance platform' : 'Join your organisation on Taksyn'}</div>

        {error && <div className="auth-error">{error}</div>}

        {mode==='register' && (
          <div className="auth-field">
            <label className="auth-label">Full Name</label>
            <input className="auth-input" placeholder="Emma Wilson" value={name} onChange={e=>setName(e.target.value)} />
          </div>
        )}
        <div className="auth-field">
          <label className="auth-label">Email Address</label>
          <input className="auth-input" type="email" placeholder="you@organisation.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleSubmit()} />
        </div>
        <div className="auth-field">
          <label className="auth-label">Password</label>
          <input className="auth-input" type="password" placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleSubmit()} />
        </div>
        {mode==='register' && (
          <div className="auth-field">
            <label className="auth-label">Role</label>
            <select className="auth-input" value={role} onChange={e=>setRole(e.target.value)} style={{cursor:'pointer',appearance:'none'}}>
              {ROLES.filter(r=>r!=='super_admin').map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
        )}
        <button className="auth-btn" onClick={handleSubmit} disabled={loading}>
          {loading ? 'Please wait…' : mode==='login' ? 'Sign In' : 'Create Account'}
        </button>
        <div className="auth-toggle">
          {mode==='login' ? <>Don't have an account? <a onClick={()=>setMode('register')}>Sign up</a></> : <>Already have an account? <a onClick={()=>setMode('login')}>Sign in</a></>}
        </div>

        <div className="auth-divider"><span>or try a demo account</span></div>
        <div className="demo-accounts">
          {DEMO_ACCOUNTS.map(a=>(
            <button key={a.role} className="demo-btn" onClick={()=>demoLogin(a)}>
              <span className="demo-role" style={{background:`${avatarColor(a.role)}22`,color:avatarColor(a.role)}}>{ROLE_LABELS[a.role]}</span>
              <div>
                <div style={{fontSize:12,fontWeight:600}}>{a.name}</div>
                <div className="demo-info">{a.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── DASHBOARD VIEW ───────────────────────────────────────────────────────────
function DashboardView({ tasks, user, setPage }) {
  const visible = visibleTasks(tasks, user)
  const done = visible.filter(t=>['completed','approved'].includes(t.status)).length
  const overdue = visible.filter(t=>t.status==='overdue').length
  const esc = visible.filter(t=>t.escalation).length
  const rate = pct(done, visible.length)
  const compT = visible.filter(t=>t.compliance)
  const compDone = compT.filter(t=>['completed','approved'].includes(t.status)).length

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-title">
          {user.role==='super_admin'?'Platform Overview':user.role==='client_admin'?'Organisation Dashboard':user.role==='manager'?'Team Dashboard':user.role==='supervisor'?'Supervisor Dashboard':'My Tasks Today'}
        </div>
        <div className="ph-sub">Welcome back, {user.name.split(' ')[0]} · {user.org}</div>
      </div>

      <div className="stat-grid">
        <Stat label="Total Tasks" val={visible.length} sub={`${visible.length-done} remaining`} icon="📋" />
        <Stat label="Completed" val={done} sub={`${rate}% completion rate`} color="#10B981" bg="rgba(16,185,129,.12)" icon="✅" />
        <Stat label="Overdue" val={overdue} sub={overdue>0?'Action required':'All on track'} color={overdue>0?'#EF4444':'#10B981'} bg={overdue>0?'rgba(239,68,68,.12)':'rgba(16,185,129,.12)'} icon="⏰" />
        <Stat label="Escalations" val={esc} sub={esc>0?'Needs attention':'Clear'} color={esc>0?'#EF4444':'#6B7280'} bg="rgba(107,114,128,.12)" icon="⚠️" />
      </div>

      {overdue>0 && (
        <div className="esc-banner">
          <span style={{fontSize:20}}>🚨</span>
          <div className="esc-banner-body">
            <div className="esc-banner-title">{overdue} task{overdue>1?'s':''} overdue — supervisor notified</div>
            <div className="esc-banner-sub">Immediate action required to maintain compliance</div>
          </div>
          <button className="btn btn-danger btn-sm" onClick={()=>setPage('escalations')}>View</button>
        </div>
      )}

      <div className="two-col">
        <div className="section">
          <div className="section-title">Compliance Score</div>
          <div style={{display:'flex',alignItems:'center',gap:18}}>
            <div className="score-ring">
              <div className="score-val">{pct(compDone,compT.length)}%</div>
              <div className="score-lbl">Score</div>
            </div>
            <div>
              <div style={{fontSize:13,marginBottom:4}}>{compDone}/{compT.length} compliance tasks done</div>
              <div style={{fontSize:12,color:'var(--t2)'}}>{compT.filter(t=>t.status==='overdue').length} critical overdue</div>
              <div style={{fontSize:11,color:'var(--t2)',marginTop:8}}>
                Plan: <span style={{color:TIERS[user.tier]?.color,fontWeight:700}}>{user.tier}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="section">
          <div className="section-title">Alerts</div>
          {visible.filter(t=>t.status==='overdue').slice(0,2).map(t=>(
            <div key={t.id} className="notif-item urgent">
              <div className="notif-title">⚠️ {t.title}</div>
              <div className="notif-sub">Overdue since {t.due_date}</div>
            </div>
          ))}
          {visible.filter(t=>t.status==='awaiting_review').slice(0,2).map(t=>(
            <div key={t.id} className="notif-item amber">
              <div className="notif-title">🔍 {t.title}</div>
              <div className="notif-sub">Awaiting evidence review</div>
            </div>
          ))}
          {visible.filter(t=>['completed','approved'].includes(t.status)).slice(0,1).map(t=>(
            <div key={t.id} className="notif-item">
              <div className="notif-title">✅ {t.title}</div>
              <div className="notif-sub">Completed · {t.due_date}</div>
            </div>
          ))}
          {visible.filter(t=>t.status==='overdue').length===0&&visible.filter(t=>t.status==='awaiting_review').length===0&&(
            <div style={{fontSize:13,color:'var(--t2)'}}>No alerts — everything on track 🎉</div>
          )}
        </div>
      </div>

      <div style={{marginTop:4}}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:12}}>Active Tasks</div>
        {visible.filter(t=>!['completed','approved'].includes(t.status)).slice(0,5).map(t=>(
          <TaskCard key={t.id} task={t} onClick={()=>setPage('tasks')} />
        ))}
        {visible.filter(t=>!['completed','approved'].includes(t.status)).length===0&&(
          <div className="empty"><div className="empty-icon">🎉</div><div className="empty-text">All tasks complete!</div></div>
        )}
      </div>
    </div>
  )
}

// ─── TASK VISIBILITY ──────────────────────────────────────────────────────────
function visibleTasks(tasks, user) {
  if (['super_admin','client_admin','manager'].includes(user.role)) return tasks
  if (user.role === 'supervisor') return tasks // supervisors see all to review
  return tasks.filter(t => t.assigned_role === 'worker' || t.assigned_role === user.role)
}

// ─── TASKS VIEW ───────────────────────────────────────────────────────────────
function TasksView({ tasks, setTasks, user }) {
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState(null)
  const [comment, setComment] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newTask, setNewTask] = useState({ title:'', category:'Housekeeping', priority:'medium', due_date:'', compliance:false })

  const visible = visibleTasks(tasks, user)
  const filtered = filter==='all' ? visible : filter==='escalated' ? visible.filter(t=>t.escalation) : visible.filter(t=>t.status===filter)

  const update = (id, changes) => setTasks(prev=>prev.map(t=>t.id===id?{...t,...changes}:t))
  const toggleSub = (tid, idx) => {
    const task = tasks.find(t=>t.id===tid)
    update(tid, { subtasks: task.subtasks.map((s,i)=>i===idx?{...s,done:!s.done}:s) })
  }
  const addComment = (tid) => {
    if (!comment.trim()) return
    const task = tasks.find(t=>t.id===tid)
    update(tid, { comments:[...(task.comments||[]), `${user.name}: ${comment.trim()}`] })
    setComment('')
  }
  const canCreate = ['super_admin','client_admin','manager','supervisor'].includes(user.role)
  const canApprove = ['super_admin','client_admin','manager','supervisor'].includes(user.role)
  const canEscalate = ['super_admin','client_admin','manager','supervisor'].includes(user.role)

  const createTask = () => {
    if (!newTask.title.trim()) return
    const t = {
      id: `T${String(tasks.length+1).padStart(3,'0')}`,
      ...newTask,
      assigned_role:'worker', status:'pending',
      subtasks:[], evidence:[], comments:[], escalation:false,
      created_by: user.name, created_at: new Date().toISOString()
    }
    setTasks(prev=>[...prev,t])
    setShowCreate(false)
    setNewTask({title:'',category:'Housekeeping',priority:'medium',due_date:'',compliance:false})
  }

  const sel = selected ? tasks.find(t=>t.id===selected) : null

  return (
    <div className="anim">
      {showCreate && (
        <div className="modal-overlay" onClick={()=>setShowCreate(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr">
              <div className="modal-title">Create New Task</div>
              <button className="modal-close" onClick={()=>setShowCreate(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-field">
                <label className="form-label">Task Title</label>
                <input className="form-input" value={newTask.title} onChange={e=>setNewTask({...newTask,title:e.target.value})} placeholder="e.g. Daily Safety Inspection" />
              </div>
              <div className="two-col">
                <div className="form-field">
                  <label className="form-label">Category</label>
                  <select className="form-select" value={newTask.category} onChange={e=>setNewTask({...newTask,category:e.target.value})}>
                    {Object.keys(CAT_ICONS).map(c=><option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">Priority</label>
                  <select className="form-select" value={newTask.priority} onChange={e=>setNewTask({...newTask,priority:e.target.value})}>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>
              <div className="form-field">
                <label className="form-label">Due Date</label>
                <input className="form-input" type="date" value={newTask.due_date} onChange={e=>setNewTask({...newTask,due_date:e.target.value})} />
              </div>
              <div className="form-field" style={{display:'flex',alignItems:'center',gap:10}}>
                <input type="checkbox" id="comp" checked={newTask.compliance} onChange={e=>setNewTask({...newTask,compliance:e.target.checked})} style={{width:16,height:16,accentColor:'var(--brand)',cursor:'pointer'}} />
                <label htmlFor="comp" style={{fontSize:13,cursor:'pointer'}}>Mark as compliance-critical</label>
              </div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className="btn btn-secondary" onClick={()=>setShowCreate(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={createTask}>Create Task</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {sel ? (
        <div className="anim">
          <button className="back-btn" onClick={()=>setSelected(null)}>
            <IC n="x" s={14} /> Close
          </button>
          <div className="detail-header">
            <div style={{flex:1}}>
              <span className="cat-tag">{CAT_ICONS[sel.category]||'📋'} {sel.category}</span>
              <div style={{fontSize:18,fontWeight:800,marginTop:6,letterSpacing:'-.5px'}}>{sel.title}</div>
              <div style={{fontSize:12,color:'var(--t2)',marginTop:3}}>
                {sel.id} · Due {sel.due_date} {sel.created_by && `· Created by ${sel.created_by}`}
              </div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:6,alignItems:'flex-end'}}>
              <StatusBadge status={sel.status} />
              <PriBadge priority={sel.priority} />
            </div>
          </div>

          {sel.escalation && (
            <div className="esc-banner">
              <span style={{fontSize:20}}>🚨</span>
              <div className="esc-banner-body">
                <div className="esc-banner-title">Task escalated — supervisor notified</div>
                <div className="esc-banner-sub">This task requires immediate attention</div>
              </div>
            </div>
          )}

          <div className="section">
            <div className="section-title">Checklist ({sel.subtasks.filter(s=>s.done).length}/{sel.subtasks.length})</div>
            {sel.subtasks.length===0
              ? <div style={{fontSize:13,color:'var(--t2)'}}>No subtasks — mark task complete directly.</div>
              : sel.subtasks.map((s,i)=>(
                <div key={i} className="subtask-row" onClick={()=>user.role==='worker'&&toggleSub(sel.id,i)}>
                  <div className={`checkbox ${s.done?'checked':''}`}>{s.done&&<IC n="check" s={10}/>}</div>
                  <span className={`subtask-text ${s.done?'done':''}`}>{s.t}</span>
                </div>
              ))
            }
            <div className="pb-bg" style={{marginTop:12}}><div className="pb-fill" style={{width:`${taskPct(sel)}%`}} /></div>
          </div>

          <div className="section">
            <div className="section-title">Evidence / Photo Proof</div>
            {sel.evidence?.length>0 && (
              <div className="ev-thumbs" style={{marginBottom:12}}>
                {sel.evidence.map((e,i)=>(
                  <div key={i} className="ev-thumb">
                    📷
                    {user.role==='worker'&&<div className="ev-rm" onClick={()=>update(sel.id,{evidence:sel.evidence.filter((_,j)=>j!==i)})}>×</div>}
                  </div>
                ))}
              </div>
            )}
            {user.role==='worker' && (
              <div className="evidence-zone" onClick={()=>update(sel.id,{evidence:[...(sel.evidence||[]),`photo_${Date.now()}.jpg`]})}>
                <div style={{fontSize:26,marginBottom:6}}>📷</div>
                <div style={{fontSize:13,color:'var(--t2)'}}>Tap to add photo evidence</div>
                <div style={{fontSize:11,color:'var(--t3)',marginTop:4}}>In production: connects to device camera</div>
              </div>
            )}
            {user.role!=='worker'&&sel.evidence?.length===0&&(
              <div style={{fontSize:13,color:'var(--t2)'}}>No evidence uploaded yet</div>
            )}
          </div>

          <div className="section">
            <div className="section-title">Comments & Notes</div>
            {sel.comments?.map((c,i)=>(
              <div key={i} className="comment-item">💬 {c}</div>
            ))}
            <textarea className="comment-box" style={{marginTop:12}} placeholder="Add a note…" value={comment} onChange={e=>setComment(e.target.value)} />
            <button className="btn btn-secondary btn-sm" style={{marginTop:8}} onClick={()=>addComment(sel.id)}>Post Comment</button>
          </div>

          <div className="section">
            <div className="section-title">Details</div>
            <div className="two-col">
              <div style={{fontSize:13}}><span style={{color:'var(--t2)'}}>Due date:</span> {sel.due_date}</div>
              <div style={{fontSize:13}}><span style={{color:'var(--t2)'}}>Compliance:</span> {sel.compliance?'🔒 Yes':'—'}</div>
              <div style={{fontSize:13}}><span style={{color:'var(--t2)'}}>Assigned to:</span> {ROLE_LABELS[sel.assigned_role]||sel.assigned_role}</div>
              <div style={{fontSize:13}}><span style={{color:'var(--t2)'}}>GPS:</span> 📍 Captured on submit</div>
            </div>
          </div>

          <div className="btn-row">
            {user.role==='worker' && !['completed','approved'].includes(sel.status) && (
              <button className="btn btn-primary" onClick={()=>update(sel.id,{status:taskPct(sel)===100?'awaiting_review':'in_progress'})}>
                {taskPct(sel)===100?'Submit for Review':'Save Progress'}
              </button>
            )}
            {canApprove && sel.status==='awaiting_review' && (
              <>
                <button className="btn btn-primary" onClick={()=>update(sel.id,{status:'approved'})}>✅ Approve</button>
                <button className="btn btn-danger" onClick={()=>update(sel.id,{status:'rejected'})}>✗ Reject</button>
              </>
            )}
            {canEscalate && !sel.escalation && !['completed','approved'].includes(sel.status) && (
              <button className="btn btn-amber" onClick={()=>update(sel.id,{escalation:true,status:'escalated'})}>⚠️ Escalate</button>
            )}
            {canEscalate && sel.escalation && (
              <button className="btn btn-secondary" onClick={()=>update(sel.id,{escalation:false,status:'in_progress'})}>Resolve Escalation</button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="ph">
            <div className="ph-top">
              <div>
                <div className="ph-title">Tasks</div>
                <div className="ph-sub">{visible.length} tasks · {visible.filter(t=>t.compliance).length} compliance-critical</div>
              </div>
              {canCreate && <button className="btn btn-primary" onClick={()=>setShowCreate(true)}><IC n="plus" s={14}/> New Task</button>}
            </div>
          </div>
          <div className="filter-bar">
            {['all','pending','in_progress','awaiting_review','completed','overdue','escalated'].map(f=>(
              <button key={f} className={`fb ${filter===f?'active':''}`} onClick={()=>setFilter(f)}>
                {f==='all'?'All':(STATUS_CFG[f]?.label||f)}
                {' '}<span style={{opacity:.6}}>({f==='all'?visible.length:f==='escalated'?visible.filter(t=>t.escalation).length:visible.filter(t=>t.status===f).length})</span>
              </button>
            ))}
          </div>
          {filtered.length===0
            ? <div className="empty"><div className="empty-icon">✅</div><div className="empty-text">No tasks here</div></div>
            : filtered.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)} />)
          }
        </>
      )}
    </div>
  )
}

// ─── ESCALATIONS VIEW ─────────────────────────────────────────────────────────
function EscalationsView({ tasks, setTasks, user }) {
  const esc = tasks.filter(t=>t.escalation||t.status==='overdue'||t.status==='escalated')
  const resolve = id => setTasks(prev=>prev.map(t=>t.id===id?{...t,escalation:false,status:'in_progress'}:t))
  return (
    <div className="anim">
      <div className="ph"><div className="ph-title">Escalations</div><div className="ph-sub">{esc.length} issues requiring attention</div></div>
      {esc.length===0
        ? <div className="empty"><div className="empty-icon">🎉</div><div className="empty-text">No active escalations — great work!</div></div>
        : esc.map(t=>(
          <div key={t.id} style={{background:'rgba(239,68,68,.05)',border:'1px solid rgba(239,68,68,.18)',borderRadius:10,padding:16,marginBottom:12}}>
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12}}>
              <div>
                <div style={{fontSize:14,fontWeight:700}}>{t.title}</div>
                <div style={{fontSize:12,color:'var(--t2)',marginTop:3}}>Due: {t.due_date} · {ROLE_LABELS[t.assigned_role]}</div>
                <div style={{marginTop:8,display:'flex',gap:6}}><PriBadge priority={t.priority}/></div>
              </div>
              <span className="badge" style={{background:'rgba(239,68,68,.15)',color:'var(--red)',flexShrink:0}}>
                🚨 {t.status==='overdue'?'Overdue':'Escalated'}
              </span>
            </div>
            {['super_admin','client_admin','manager','supervisor'].includes(user.role) && (
              <div style={{marginTop:12,display:'flex',gap:8}}>
                <button className="btn btn-secondary btn-sm" onClick={()=>resolve(t.id)}>Mark Acknowledged</button>
              </div>
            )}
          </div>
        ))
      }
    </div>
  )
}

// ─── EVIDENCE VIEW ────────────────────────────────────────────────────────────
function EvidenceView({ tasks, setTasks, user }) {
  const relevant = tasks.filter(t=>t.evidence?.length>0||t.status==='awaiting_review')
  const approve = id => setTasks(prev=>prev.map(t=>t.id===id?{...t,status:'approved'}:t))
  const reject  = id => setTasks(prev=>prev.map(t=>t.id===id?{...t,status:'rejected'}:t))
  return (
    <div className="anim">
      <div className="ph"><div className="ph-title">Evidence Review</div><div className="ph-sub">{tasks.filter(t=>t.status==='awaiting_review').length} pending review</div></div>
      {relevant.length===0
        ? <div className="empty"><div className="empty-icon">📷</div><div className="empty-text">No evidence submitted yet</div></div>
        : relevant.map(t=>(
          <div key={t.id} className="task-card medium">
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12}}>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:600}}>{t.title}</div>
                <div style={{fontSize:12,color:'var(--t2)',marginTop:4}}>{ROLE_LABELS[t.assigned_role]} · {t.due_date}</div>
                <div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap'}}>
                  <StatusBadge status={t.status}/>
                  {t.compliance&&<span className="badge" style={{background:'rgba(139,92,246,.15)',color:'#8B5CF6'}}>🔒 Compliance</span>}
                </div>
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',justifyContent:'flex-end'}}>
                {t.evidence?.length>0
                  ? t.evidence.map((e,i)=><div key={i} className="ev-thumb" style={{width:52,height:52,fontSize:18}}>📷</div>)
                  : <span style={{fontSize:12,color:'var(--t2)'}}>No photos</span>
                }
              </div>
            </div>
            <div className="pb-bg" style={{marginTop:10}}><div className="pb-fill" style={{width:`${taskPct(t)}%`}}/></div>
            {['super_admin','client_admin','manager','supervisor'].includes(user.role) && t.status==='awaiting_review' && (
              <div style={{display:'flex',gap:8,marginTop:12}}>
                <button className="btn btn-primary btn-sm" onClick={()=>approve(t.id)}>✅ Approve</button>
                <button className="btn btn-danger btn-sm" onClick={()=>reject(t.id)}>✗ Reject</button>
              </div>
            )}
          </div>
        ))
      }
    </div>
  )
}

// ─── REPORTS VIEW ─────────────────────────────────────────────────────────────
function ReportsView({ tasks, user }) {
  const [tab, setTab] = useState('overview')
  const total = tasks.length, done = tasks.filter(t=>['completed','approved'].includes(t.status)).length
  const overdue = tasks.filter(t=>t.status==='overdue').length
  const esc = tasks.filter(t=>t.escalation).length
  const compT = tasks.filter(t=>t.compliance), compDone = compT.filter(t=>['completed','approved'].includes(t.status)).length

  const byCat = {}
  tasks.forEach(t=>{
    if(!byCat[t.category]) byCat[t.category]={total:0,done:0}
    byCat[t.category].total++
    if(['completed','approved'].includes(t.status)) byCat[t.category].done++
  })

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-top">
          <div><div className="ph-title">Reports & Analytics</div><div className="ph-sub">Audit-ready compliance documentation</div></div>
          <button className="btn btn-secondary" onClick={()=>{
            const csv = ['ID,Title,Category,Status,Priority,Compliance,Evidence,Due Date',
              ...tasks.map(t=>`${t.id},"${t.title}",${t.category},${t.status},${t.priority},${t.compliance},${t.evidence?.length||0},${t.due_date}`)
            ].join('\n')
            const a = document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv)
            a.download='taksyn-report.csv'; a.click()
          }}>📥 Export CSV</button>
        </div>
      </div>

      <div className="stat-grid">
        <Stat label="Completion Rate" val={`${pct(done,total)}%`} sub={`${done}/${total} tasks`} color="#10B981" bg="rgba(16,185,129,.12)" icon="📈"/>
        <Stat label="Compliance Rate" val={`${pct(compDone,compT.length)}%`} sub={`${compDone}/${compT.length} compliance tasks`} color="#8B5CF6" bg="rgba(139,92,246,.12)" icon="🛡️"/>
        <Stat label="Overdue" val={overdue} sub={overdue>0?'Action required':'All clear'} color={overdue>0?'#EF4444':'#10B981'} bg="rgba(239,68,68,.12)" icon="⏰"/>
        <Stat label="Escalations" val={esc} sub={esc>0?'Active':'None'} color={esc>0?'#EF4444':'#6B7280'} bg="rgba(107,114,128,.12)" icon="⚠️"/>
      </div>

      <div className="tabs">
        {[['overview','By Category'],['audit','Full Audit Log']].map(([k,l])=>(
          <button key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>

      {tab==='overview' && (
        <div className="section">
          <div className="section-title">Completion by Category</div>
          <table className="tbl">
            <thead><tr><th>Category</th><th>Total</th><th>Done</th><th>Rate</th><th>Status</th></tr></thead>
            <tbody>
              {Object.entries(byCat).map(([cat,d])=>{
                const r = pct(d.done,d.total)
                return (
                  <tr key={cat}>
                    <td><span className="cat-tag">{CAT_ICONS[cat]||'📋'} {cat}</span></td>
                    <td style={{fontSize:13}}>{d.total}</td>
                    <td style={{fontSize:13}}>{d.done}</td>
                    <td>
                      <div className="mini-prog">
                        <div className="mini-prog-bar"><div className="mini-prog-fill" style={{width:`${r}%`,background:r>=80?'var(--green)':r>=50?'var(--amber)':'var(--red)'}}/></div>
                        <span style={{fontSize:11,color:'var(--t2)'}}>{r}%</span>
                      </div>
                    </td>
                    <td><span style={{fontSize:11,color:r===100?'var(--green)':r>=50?'var(--amber)':'var(--red)',fontWeight:600}}>{r===100?'✅ Complete':r>=50?'🔄 In Progress':'⚠️ Behind'}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab==='audit' && (
        <div className="section">
          <div className="section-title">Full Task Audit Log</div>
          <table className="tbl">
            <thead><tr><th>ID</th><th>Task</th><th>Assigned To</th><th>Status</th><th>Compliance</th><th>Evidence</th><th>Due</th></tr></thead>
            <tbody>
              {tasks.map(t=>(
                <tr key={t.id}>
                  <td><span className="mono">{t.id}</span></td>
                  <td style={{fontSize:13,fontWeight:500,maxWidth:180}}>{t.title}</td>
                  <td><RolePill role={t.assigned_role}/></td>
                  <td><StatusBadge status={t.status}/></td>
                  <td>{t.compliance?<span style={{color:'#8B5CF6',fontSize:12,fontWeight:700}}>🔒 Yes</span>:<span style={{color:'var(--t2)',fontSize:12}}>—</span>}</td>
                  <td style={{fontSize:12,color:'var(--t2)'}}>{t.evidence?.length||0} file{t.evidence?.length!==1?'s':''}</td>
                  <td style={{fontSize:12,color:'var(--t2)'}}>{t.due_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── USERS VIEW (admin only) ──────────────────────────────────────────────────
function UsersView({ user }) {
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('worker')
  const [inviteName, setInviteName] = useState('')

  const mockUsers = [
    { name:'You (Super Admin)', email:'admin@taksyn.demo', role:'super_admin', status:'active' },
    { name:'Sarah Mitchell',    email:'clientadmin@taksyn.demo', role:'client_admin', status:'active' },
    { name:'Daniel Brooks',     email:'manager@taksyn.demo', role:'manager', status:'active' },
    { name:'Maya Chen',         email:'supervisor@taksyn.demo', role:'supervisor', status:'active' },
    { name:'Emma Wilson',       email:'worker@taksyn.demo', role:'worker', status:'active' },
  ]

  return (
    <div className="anim">
      {showInvite && (
        <div className="modal-overlay" onClick={()=>setShowInvite(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr">
              <div className="modal-title">Invite Team Member</div>
              <button className="modal-close" onClick={()=>setShowInvite(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-field">
                <label className="form-label">Full Name</label>
                <input className="form-input" value={inviteName} onChange={e=>setInviteName(e.target.value)} placeholder="Emma Wilson" />
              </div>
              <div className="form-field">
                <label className="form-label">Email Address</label>
                <input className="form-input" type="email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="emma@yourorg.com" />
              </div>
              <div className="form-field">
                <label className="form-label">Role</label>
                <select className="form-select" value={inviteRole} onChange={e=>setInviteRole(e.target.value)}>
                  {ROLES.filter(r=>r!=='super_admin').map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <div style={{background:'var(--s3)',border:'1px solid var(--border)',borderRadius:8,padding:12,marginBottom:14}}>
                <div style={{fontSize:12,color:'var(--t2)',lineHeight:1.6}}>
                  📧 In production, this sends an invite email with a sign-up link.<br/>
                  For this trial, share the demo credentials:<br/>
                  <span style={{fontFamily:'DM Mono',fontSize:11,color:'var(--brand)'}}>Password: Demo1234!</span>
                </div>
              </div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className="btn btn-secondary" onClick={()=>setShowInvite(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={()=>{alert(`Invite sent to ${inviteEmail} (simulated)`);setShowInvite(false)}}>Send Invite</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="ph">
        <div className="ph-top">
          <div><div className="ph-title">Team Members</div><div className="ph-sub">Manage staff access and roles</div></div>
          <button className="btn btn-primary" onClick={()=>setShowInvite(true)}><IC n="plus" s={14}/> Invite User</button>
        </div>
      </div>

      <div className="section">
        <div className="section-title">Active Users ({mockUsers.length})</div>
        {mockUsers.map((u,i)=>(
          <div key={i} className="user-row">
            <Avatar name={u.name} role={u.role} size={36}/>
            <div className="user-info">
              <div className="user-name">{u.name}</div>
              <div className="user-email">{u.email}</div>
            </div>
            <RolePill role={u.role}/>
            <span className="badge" style={{color:'var(--green)',background:'rgba(16,185,129,.12)'}}>Active</span>
          </div>
        ))}
      </div>

      <div className="section">
        <div className="section-title">Trial Access Instructions</div>
        <div style={{fontSize:13,color:'var(--t2)',lineHeight:1.7}}>
          Share these demo credentials with your team to trial Taksyn. Each role sees a different view:
        </div>
        <div style={{marginTop:12,display:'flex',flexDirection:'column',gap:8}}>
          {DEMO_ACCOUNTS.map(a=>(
            <div key={a.role} style={{background:'var(--s3)',border:'1px solid var(--border)',borderRadius:8,padding:12,display:'flex',alignItems:'center',gap:12}}>
              <RolePill role={a.role}/>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:600}}>{a.email}</div>
                <div style={{fontSize:11,color:'var(--t2)',marginTop:1}}>Password: Demo1234! · {a.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── TIERS VIEW ───────────────────────────────────────────────────────────────
function TiersView({ user }) {
  return (
    <div className="anim">
      <div className="ph"><div className="ph-title">Subscription Plans</div><div className="ph-sub">Current plan: <span style={{color:TIERS[user.tier]?.color,fontWeight:700}}>{user.tier}</span></div></div>
      <div className="tier-grid">
        {Object.entries(TIERS).map(([name,tier])=>(
          <div key={name} className={`tier-card ${user.tier===name?'active':''}`} style={{borderColor:user.tier===name?tier.color:'var(--border)'}}>
            <div>
              <div className="tier-name" style={{color:tier.color}}>{name}</div>
              <div style={{fontSize:11,color:'var(--t2)',marginTop:2}}>{tier.users} users</div>
            </div>
            <div className="tier-price">{tier.price}<span>/user/mo</span></div>
            {user.tier===name&&<span className="badge" style={{background:`${tier.color}22`,color:tier.color,width:'fit-content'}}>Current Plan</span>}
            <div style={{display:'flex',flexDirection:'column',gap:5}}>
              {tier.features.map(f=><div key={f} className="tier-feat"><div className="tier-dot" style={{background:tier.color}}/>{f}</div>)}
              {tier.locked.map(f=><div key={f} className="tier-feat locked"><div className="tier-dot" style={{background:'var(--t3)'}}/> 🔒 {f}</div>)}
            </div>
            {user.tier!==name&&<button className="btn btn-secondary btn-sm" style={{marginTop:'auto'}}>Upgrade</button>}
          </div>
        ))}
      </div>
      <div className="section">
        <div className="section-title">Feature Comparison</div>
        <table className="tbl">
          <thead>
            <tr><th>Feature</th>{Object.keys(TIERS).map(n=><th key={n} style={{color:TIERS[n].color}}>{n}</th>)}</tr>
          </thead>
          <tbody>
            {[
              ['Task Assignment',    '✓','✓','✓','✓','✓'],
              ['Photo Evidence',     '—','✓','✓','✓','✓'],
              ['Escalation Cascade', '—','—','✓','✓','✓'],
              ['Supervisor Dashboard','—','—','✓','✓','✓'],
              ['GPS Verification',   '—','—','✓','✓','✓'],
              ['Audit Reports',      '—','—','—','✓','✓'],
              ['Multi-site',         '—','—','—','✓','✓'],
              ['Digital Signatures', '—','—','—','✓','✓'],
              ['API Integrations',   '—','—','—','—','✓'],
              ['White-labelling',    '—','—','—','—','✓'],
            ].map(([feat,...vals])=>(
              <tr key={feat}>
                <td style={{fontSize:13}}>{feat}</td>
                {vals.map((v,i)=><td key={i} style={{fontSize:13,textAlign:'center',color:v==='✓'?'var(--green)':'var(--t3)'}}>{v}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── SIDEBAR CONFIG ───────────────────────────────────────────────────────────
const NAV = {
  super_admin:  [['dashboard','Dashboard','home'],['tasks','Tasks','tasks'],['evidence','Evidence','img'],['escalations','Escalations','alert'],['reports','Reports','chart'],['users','Team','users'],['tiers','Plans','tier']],
  client_admin: [['dashboard','Dashboard','home'],['tasks','Tasks','tasks'],['evidence','Evidence','img'],['escalations','Escalations','alert'],['reports','Reports','chart'],['users','Team','users'],['tiers','Plans','tier']],
  manager:      [['dashboard','Dashboard','home'],['tasks','Tasks','tasks'],['evidence','Evidence','img'],['escalations','Escalations','alert'],['reports','Reports','chart']],
  supervisor:   [['dashboard','Dashboard','home'],['tasks','Tasks','tasks'],['evidence','Evidence','img'],['escalations','Escalations','alert'],['reports','Reports','chart']],
  worker:       [['dashboard','Today','home'],['tasks','My Tasks','tasks']],
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null)
  const [page, setPage] = useState('dashboard')
  const [tasks, setTasks] = useState(DEMO_TASKS)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    // Check for existing Supabase session
    if (isConfigured()) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          // Fetch user profile from your profiles table
          supabase.from('profiles').select('*').eq('id', session.user.id).single()
            .then(({ data }) => {
              if (data) setUser({ ...data, email: session.user.email })
              setLoading(false)
            })
        } else {
          setLoading(false)
        }
      })
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!session) setUser(null)
      })
      return () => subscription.unsubscribe()
    } else {
      setLoading(false) // demo mode
    }
  }, [])

  const handleAuth = (userData) => {
    setUser(userData)
    setPage('dashboard')
  }

  const logout = async () => {
    if (isConfigured()) await supabase.auth.signOut()
    setUser(null)
    setTasks(DEMO_TASKS)
    setPage('dashboard')
  }

  useEffect(() => { setPage('dashboard') }, [user?.role])

  if (loading) return (
    <>
      <style>{CSS}</style>
      <div className="loading"><div className="spinner"/><span>Loading Taksyn…</span></div>
    </>
  )

  if (!user) return <AuthView onAuth={handleAuth} />

  const escalationCount = tasks.filter(t=>t.escalation||t.status==='overdue').length
  const reviewCount = tasks.filter(t=>t.status==='awaiting_review').length
  const navItems = NAV[user.role] || NAV.worker

  const pageProps = { tasks, setTasks, user, setPage }

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        {/* TOPBAR */}
        <div className="topbar">
          <div className="tb-logo">
            <img src="/logo.jpeg" alt="Taksyn" style={{height:28,objectFit:'contain'}} />
          </div>
          <div className="tb-sep"/>
          <span className="tb-org">{user.org}</span>
          <div className="tb-space"/>
          <div className="tb-search">
            <IC n="search" s={13}/>
            <input placeholder="Search tasks…" value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <button className="tb-icon-btn" onClick={()=>setPage('escalations')}>
            <IC n="bell" s={17}/>
            {escalationCount>0&&<div className="tb-badge">{escalationCount}</div>}
          </button>
          <div className="tb-user" onClick={logout} title="Click to sign out">
            <Avatar name={user.name} role={user.role} size={28}/>
            <div className="tb-user-info">
              <div className="tb-user-name">{user.name.split(' ')[0]}</div>
              <div className="tb-user-role">{ROLE_LABELS[user.role]}</div>
            </div>
          </div>
        </div>

        {/* MAIN */}
        <div className="main">
          {/* SIDEBAR */}
          <div className="sidebar">
            <div className="sb-section">
              <div className="sb-label">Navigation</div>
              {navItems.map(([key,label,icon])=>(
                <button key={key} className={`nav-item ${page===key?'active':''}`} onClick={()=>setPage(key)}>
                  <IC n={icon} s={15}/>
                  {label}
                  {key==='escalations'&&escalationCount>0&&<span className="nav-badge">{escalationCount}</span>}
                  {key==='evidence'&&reviewCount>0&&<span className="nav-badge amber">{reviewCount}</span>}
                </button>
              ))}
            </div>
            <div className="sb-bottom">
              <div className="sb-user-card">
                <Avatar name={user.name} role={user.role} size={30}/>
                <div style={{flex:1,overflow:'hidden'}}>
                  <div style={{fontSize:12,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{user.name}</div>
                  <div style={{fontSize:10,color:TIERS[user.tier]?.color,marginTop:1,fontWeight:600}}>{user.tier} Plan</div>
                </div>
              </div>
              <button className="sb-logout" onClick={logout}>
                Sign Out
              </button>
            </div>
          </div>

          {/* CONTENT */}
          <div className="content">
            {page==='dashboard'   && <DashboardView   {...pageProps}/>}
            {page==='tasks'       && <TasksView        {...pageProps}/>}
            {page==='evidence'    && <EvidenceView     {...pageProps}/>}
            {page==='escalations' && <EscalationsView  {...pageProps}/>}
            {page==='reports'     && <ReportsView      {...pageProps}/>}
            {page==='users'       && <UsersView        {...pageProps}/>}
            {page==='tiers'       && <TiersView        {...pageProps}/>}
          </div>
        </div>
      </div>
    </>
  )
}
