import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase.js'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const ROLES = ['super_admin','client_admin','manager','supervisor','worker']
const ROLE_LABELS = { super_admin:'Super Admin', client_admin:'Client Admin', manager:'Manager', supervisor:'Supervisor', worker:'Worker' }
const ROLE_COLORS = { super_admin:'#F59E0B', client_admin:'#8B5CF6', manager:'#3B82F6', supervisor:'#10B981', worker:'#6B7280' }
const TIERS = {
  Personal:     { color:'#6B7280', base:'$4',   perUser:'$2', users:'Max 4',    storage:'0.5GB', images:'—',     retention:'30 days',  features:['Basic task tracking','Simple checklists','Reminders','Unlimited tasks'], locked:['Photo evidence','Escalation','Compliance reporting'] },
  Starter:      { color:'#3B82F6', base:'$19',  perUser:'$9', users:'1–10',     storage:'5GB',   images:'2/task',retention:'6 months', features:['Task assignment','Checklists','Photo evidence (2/task)','Basic reporting','Unlimited tasks'], locked:['Escalation','Advanced reporting'] },
  Growth:       { color:'#10B981', base:'$39',  perUser:'$8', users:'11–30',    storage:'15GB',  images:'3/task',retention:'12 months',features:['Escalation cascade','Supervisor dashboards','GPS tracking','3 photos/task','12 month retention','Performance tracking'], locked:[] },
  Professional: { color:'#8B5CF6', base:'$149', perUser:'$7', users:'31–100',   storage:'50GB',  images:'5/task',retention:'24 months',features:['Multi-site support','Advanced escalation','Audit-ready reporting','5 photos/task','24 month retention','Extended storage'], locked:[] },
  Enterprise:   { color:'#F59E0B', base:'$399', perUser:'$6', users:'Unlimited',storage:'100GB+',images:'5/task',retention:'Custom (up to 7yr)', features:['Full compliance suite','API integrations','Custom workflows','White-labelling','SLA + onboarding','Custom data retention'], locked:[] },
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
const PRIORITY_CFG = { critical:{label:'Critical',color:'#EF4444'}, high:{label:'High',color:'#F97316'}, medium:{label:'Medium',color:'#F59E0B'}, low:{label:'Low',color:'#10B981'} }
const CAT_ICONS = { Housekeeping:'🏨', Kitchen:'🍽️', Safety:'🛡️', Clinical:'🏥', NDIS:'♿', Maintenance:'🔧', HR:'👥', General:'📋' }
const RECURRENCE_OPTS = ['once','daily','weekdays','weekly','fortnightly','monthly','quarterly','annually']
const RECURRENCE_LABELS = { once:'One-off', daily:'Daily', weekdays:'Weekdays (Mon–Fri)', weekly:'Weekly', fortnightly:'Fortnightly', monthly:'Monthly', quarterly:'Quarterly', annually:'Annually' }
const DEMO_TASKS = []

// ─── STYLES ───────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800&family=DM+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#F4F6F9;color:#1A2033;font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased}
:root{
  --brand:#00A87E;--brand-dk:#008A68;--brand-lt:rgba(0,168,126,.1);
  --surface:#F4F6F9;--s2:#FFFFFF;--s3:#F0F2F5;--s4:#E8EBF0;
  --border:rgba(0,0,0,.08);--border2:rgba(0,0,0,.14);
  --text:#1A2033;--t2:#5A6478;--t3:#9AA3B2;
  --red:#EF4444;--amber:#F59E0B;--blue:#3B82F6;--green:#10B981;--purple:#8B5CF6;
  --r:10px;--rs:6px;--shadow:0 4px 20px rgba(0,0,0,.08);
  --sidebar-w:214px;
}
/* AUTH */
.auth-bg{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#F0F7F4 0%,#E8F4F0 100%);padding:20px}
.auth-card{background:#fff;border:1px solid var(--border2);border-radius:16px;padding:36px;width:100%;max-width:420px;box-shadow:var(--shadow)}
.auth-logo{display:flex;align-items:center;justify-content:center;margin-bottom:28px}
.auth-title{font-size:20px;font-weight:700;margin-bottom:6px;text-align:center}
.auth-sub{font-size:13px;color:var(--t2);margin-bottom:24px;text-align:center}
.auth-field{margin-bottom:14px}
.auth-label{font-size:11px;font-weight:600;color:var(--t2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px;display:block}
.auth-input{width:100%;background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);padding:11px 14px;color:var(--text);font-size:14px;font-family:inherit;outline:none;transition:border-color .2s}
.auth-input:focus{border-color:var(--brand)}
.auth-btn{width:100%;padding:12px;background:var(--brand);border:none;border-radius:var(--rs);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s;margin-top:4px}
.auth-btn:hover{background:var(--brand-dk)}
.auth-btn:disabled{opacity:.5;cursor:not-allowed}
.auth-error{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:var(--rs);padding:10px 14px;font-size:13px;color:var(--red);margin-bottom:14px}
.auth-toggle{text-align:center;font-size:13px;color:var(--t2);margin-top:18px}
.auth-toggle a{color:var(--brand);cursor:pointer;font-weight:600}
.auth-divider{text-align:center;color:var(--t3);font-size:12px;margin:18px 0;position:relative}
.auth-divider::before{content:'';position:absolute;top:50%;left:0;right:0;height:1px;background:var(--border)}
.auth-divider span{background:#fff;padding:0 12px;position:relative}
.demo-accounts{display:flex;flex-direction:column;gap:6px}
.demo-btn{display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);cursor:pointer;transition:all .15s;font-family:inherit;color:var(--text);text-align:left;width:100%}
.demo-btn:hover{border-color:var(--brand);background:var(--brand-lt)}
.demo-role{font-size:11px;font-weight:700;padding:2px 7px;border-radius:4px}
.demo-info{font-size:11px;color:var(--t2)}
/* APP SHELL */
.app{display:flex;flex-direction:column;height:100vh;overflow:hidden}
/* TOPBAR */
.topbar{display:flex;align-items:center;gap:12px;padding:0 16px;height:52px;background:#fff;border-bottom:1px solid var(--border);flex-shrink:0;z-index:200}
.tb-menu-btn{background:none;border:none;cursor:pointer;padding:6px;border-radius:6px;color:var(--t2);display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0}
.tb-menu-btn:hover{background:var(--s3);color:var(--text)}
.tb-logo{height:30px;object-fit:contain;cursor:pointer}
.tb-sep{width:1px;height:18px;background:var(--border);margin:0 2px}
.tb-org{font-size:12px;color:var(--t2);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px}
.tb-space{flex:1}
.tb-search{display:flex;align-items:center;gap:7px;background:var(--s3);border:1px solid var(--border);border-radius:8px;padding:5px 10px;width:180px}
.tb-search input{background:none;border:none;outline:none;color:var(--text);font-size:13px;width:100%;font-family:inherit}
.tb-search input::placeholder{color:var(--t3)}
@media(max-width:600px){.tb-search{display:none}.tb-org{max-width:80px}}
.tb-icon-btn{position:relative;background:none;border:none;color:var(--t2);cursor:pointer;padding:6px;border-radius:6px;display:flex;align-items:center;transition:all .15s}
.tb-icon-btn:hover{background:var(--s3)}
.tb-badge{position:absolute;top:1px;right:1px;width:15px;height:15px;border-radius:50%;background:var(--red);font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;color:#fff}
.tb-user{display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 8px;border-radius:8px;transition:all .15s;border:1px solid transparent;flex-shrink:0}
.tb-user:hover{background:var(--s3);border-color:var(--border)}
.tb-avatar{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0}
.tb-user-name{font-size:12px;font-weight:600}
.tb-user-role{font-size:10px;color:var(--t2)}
@media(max-width:480px){.tb-user-name,.tb-user-role{display:none}}
/* LAYOUT */
.main{display:flex;flex:1;overflow:hidden;position:relative}
/* SIDEBAR */
.sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:150}
.sidebar-overlay.open{display:block}
.sidebar{width:var(--sidebar-w);flex-shrink:0;background:#fff;border-right:1px solid var(--border);display:flex;flex-direction:column;overflow-y:auto;overflow-x:hidden;transition:transform .25s ease,width .25s ease;z-index:160}
.sidebar.collapsed{width:52px}
@media(max-width:768px){
  .sidebar{position:fixed;top:52px;left:0;bottom:0;transform:translateX(-100%);width:var(--sidebar-w) !important;z-index:160}
  .sidebar.mobile-open{transform:translateX(0)}
}
.sb-section{padding:14px 8px 6px}
.sb-label{font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;padding:0 8px 6px;white-space:nowrap;overflow:hidden;transition:opacity .2s}
.sidebar.collapsed .sb-label{opacity:0}
.nav-item{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:var(--rs);cursor:pointer;color:var(--t2);font-size:13px;font-weight:500;transition:all .15s;border:none;background:none;width:100%;text-align:left;font-family:inherit;white-space:nowrap;overflow:hidden}
.nav-item:hover{background:var(--s3);color:var(--text)}
.nav-item.active{background:var(--brand-lt);color:var(--brand)}
.nav-item svg{width:15px;height:15px;flex-shrink:0}
.nav-item-label{transition:opacity .2s,width .2s}
.sidebar.collapsed .nav-item-label{opacity:0;width:0;overflow:hidden}
.nav-badge{margin-left:auto;background:var(--red);color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:10px;min-width:16px;text-align:center;transition:opacity .2s}
.nav-badge.amber{background:var(--amber);color:#000}
.sidebar.collapsed .nav-badge{opacity:0}
.sb-bottom{margin-top:auto;padding:10px 8px;border-top:1px solid var(--border)}
.sb-user-card{display:flex;align-items:center;gap:8px;padding:8px;border-radius:var(--rs);background:var(--s3);overflow:hidden}
.sb-user-info{overflow:hidden;transition:opacity .2s,width .2s}
.sidebar.collapsed .sb-user-info{opacity:0;width:0}
.sb-logout{width:100%;margin-top:6px;padding:7px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.15);border-radius:var(--rs);color:var(--red);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap;overflow:hidden}
.sb-logout:hover{background:rgba(239,68,68,.15)}
.sidebar.collapsed .sb-logout{font-size:0;padding:7px 0}
/* CONTENT */
.content{flex:1;overflow-y:auto;padding:20px}
@media(max-width:768px){.content{padding:14px}}
/* PAGE HEADER */
.ph{margin-bottom:20px}
.ph-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ph-title{font-size:20px;font-weight:800;letter-spacing:-.5px}
.ph-sub{font-size:12px;color:var(--t2);margin-top:3px}
/* STAT GRID */
.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
@media(max-width:900px){.stat-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:480px){.stat-grid{grid-template-columns:repeat(2,1fr);gap:8px}}
.stat-card{background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:14px;transition:border-color .2s}
.stat-card:hover{border-color:var(--border2)}
.sc-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.sc-label{font-size:10px;color:var(--t2);font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.sc-icon{width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:13px}
.sc-val{font-size:22px;font-weight:800;letter-spacing:-1px;line-height:1}
.sc-sub{font-size:11px;color:var(--t2);margin-top:2px}
/* SECTIONS */
.section{background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:16px;margin-bottom:12px}
.section-title{font-size:10px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:640px){.two-col{grid-template-columns:1fr}}
/* TASKS */
.filter-bar{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px}
.fb{padding:4px 10px;border-radius:var(--rs);border:1px solid var(--border);background:transparent;color:var(--t2);font-size:11px;font-weight:500;cursor:pointer;transition:all .15s;font-family:inherit;white-space:nowrap}
.fb:hover{background:var(--s3);color:var(--text)}
.fb.active{background:var(--brand-lt);border-color:var(--brand);color:var(--brand)}
.task-card{background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:14px;margin-bottom:8px;cursor:pointer;transition:all .15s;position:relative;overflow:hidden}
.task-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px}
.task-card.critical::before{background:var(--red)}
.task-card.high::before{background:#F97316}
.task-card.medium::before{background:var(--amber)}
.task-card.low::before{background:var(--green)}
.task-card:hover{border-color:var(--border2);transform:translateY(-1px);box-shadow:0 2px 12px rgba(0,0,0,.06)}
.tc-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.tc-title{font-size:14px;font-weight:600;flex:1}
.tc-meta{display:flex;align-items:center;gap:6px;margin-top:7px;flex-wrap:wrap}
.tc-progress{margin-top:8px}
.pb-bg{height:3px;background:var(--s3);border-radius:2px;overflow:hidden;margin-top:3px}
.pb-fill{height:100%;border-radius:2px;background:var(--brand);transition:width .3s}
.esc-flag{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--red);font-weight:600;margin-top:5px}
.recurrence-tag{display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--brand);background:var(--brand-lt);padding:2px 7px;border-radius:10px;font-weight:600}
/* BADGES */
.badge{display:inline-flex;align-items:center;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600;white-space:nowrap}
.cat-tag{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--t2);background:var(--s3);padding:2px 7px;border-radius:4px}
.role-pill{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700}
/* TASK DETAIL */
.back-btn{display:inline-flex;align-items:center;gap:6px;color:var(--t2);font-size:13px;font-weight:500;cursor:pointer;background:none;border:none;font-family:inherit;margin-bottom:14px;transition:color .15s;padding:0}
.back-btn:hover{color:var(--text)}
.detail-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.subtask-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer}
.subtask-row:last-child{border-bottom:none}
.checkbox{width:18px;height:18px;border-radius:4px;border:2px solid var(--border2);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s}
.checkbox.checked{background:var(--brand);border-color:var(--brand)}
.subtask-text{font-size:13px;flex:1}
.subtask-text.done{text-decoration:line-through;color:var(--t2)}
.evidence-zone{border:2px dashed var(--border);border-radius:var(--r);padding:22px;text-align:center;cursor:pointer;transition:all .2s}
.evidence-zone:hover{border-color:var(--brand);background:var(--brand-lt)}
.ev-thumbs{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.ev-thumb{width:60px;height:60px;border-radius:var(--rs);background:var(--s3);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:18px;position:relative}
.ev-rm{position:absolute;top:-5px;right:-5px;width:16px;height:16px;border-radius:50%;background:var(--red);color:#fff;font-size:9px;display:flex;align-items:center;justify-content:center;cursor:pointer}
.comment-box{width:100%;background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);padding:9px 11px;color:var(--text);font-size:13px;font-family:inherit;resize:vertical;min-height:52px;outline:none;transition:border-color .2s}
.comment-box:focus{border-color:var(--brand)}
.comment-item{padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--t2)}
.comment-item:last-child{border-bottom:none}
/* GPS & TIMING */
.timing-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.timing-chip{display:flex;align-items:center;gap:5px;background:var(--s3);border:1px solid var(--border);border-radius:6px;padding:5px 10px;font-size:12px;color:var(--t2)}
.timing-chip.active{background:var(--brand-lt);border-color:var(--brand);color:var(--brand);font-weight:600}
.gps-chip{display:flex;align-items:center;gap:5px;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:6px;padding:5px 10px;font-size:11px;color:var(--blue)}
/* BUTTONS */
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:var(--rs);font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;border:none;font-family:inherit;white-space:nowrap}
.btn-primary{background:var(--brand);color:#fff}
.btn-primary:hover{background:var(--brand-dk)}
.btn-secondary{background:var(--s3);color:var(--text);border:1px solid var(--border)}
.btn-secondary:hover{background:var(--s4)}
.btn-danger{background:rgba(239,68,68,.08);color:var(--red);border:1px solid rgba(239,68,68,.2)}
.btn-danger:hover{background:rgba(239,68,68,.15)}
.btn-amber{background:rgba(245,158,11,.08);color:var(--amber);border:1px solid rgba(245,158,11,.2)}
.btn-amber:hover{background:rgba(245,158,11,.15)}
.btn-green{background:rgba(16,185,129,.1);color:var(--green);border:1px solid rgba(16,185,129,.25)}
.btn-green:hover{background:rgba(16,185,129,.2)}
.btn-sm{padding:5px 10px;font-size:12px}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn-row{display:flex;gap:7px;flex-wrap:wrap;margin-top:14px}
/* ESCALATION BANNER */
.esc-banner{background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.2);border-radius:var(--r);padding:12px 14px;display:flex;align-items:center;gap:10px;margin-bottom:14px}
.esc-banner-body{flex:1}
.esc-banner-title{font-size:13px;font-weight:700;color:var(--red)}
.esc-banner-sub{font-size:11px;color:var(--t2);margin-top:2px}
/* TABLE */
.tbl{width:100%;border-collapse:collapse;font-size:13px}
.tbl th{text-align:left;padding:8px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--t2);border-bottom:1px solid var(--border)}
.tbl td{padding:10px;border-bottom:1px solid var(--border);vertical-align:middle}
.tbl tr:last-child td{border-bottom:none}
.tbl tr:hover td{background:rgba(0,0,0,.015)}
.mono{font-family:'DM Mono',monospace;font-size:11px;color:var(--t2)}
.tbl-scroll{overflow-x:auto}
/* PROGRESS */
.mini-prog{display:flex;align-items:center;gap:7px}
.mini-prog-bar{width:60px;height:3px;background:var(--s3);border-radius:2px;overflow:hidden}
.mini-prog-fill{height:100%;border-radius:2px}
/* SCORE */
.score-ring{width:70px;height:70px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;border:3px solid var(--brand);flex-shrink:0}
.score-val{font-size:17px;font-weight:800;color:var(--brand);line-height:1}
.score-lbl{font-size:9px;color:var(--t2);margin-top:1px}
/* TIERS */
.tier-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:20px}
@media(max-width:1000px){.tier-grid{grid-template-columns:repeat(3,1fr)}}
@media(max-width:600px){.tier-grid{grid-template-columns:repeat(2,1fr)}}
.tier-card{background:#fff;border:2px solid var(--border);border-radius:var(--r);padding:16px;display:flex;flex-direction:column;gap:8px;transition:all .2s}
.tier-card:hover{transform:translateY(-2px)}
.tier-card.active{box-shadow:0 0 0 2px var(--brand)}
.tier-name{font-size:14px;font-weight:800}
.tier-price{font-size:18px;font-weight:800;letter-spacing:-1px}
.tier-price span{font-size:11px;font-weight:400;color:var(--t2)}
.tier-feat{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t2)}
.tier-feat.locked{opacity:.35}
.tier-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
/* USERS */
.user-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)}
.user-row:last-child{border-bottom:none}
.user-info{flex:1;overflow:hidden}
.user-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.user-email{font-size:11px;color:var(--t2);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* NOTIF */
.notif-item{background:var(--s3);border-radius:var(--rs);padding:10px;border-left:3px solid var(--brand);margin-bottom:7px}
.notif-item.urgent{border-left-color:var(--red)}
.notif-item.amber{border-left-color:var(--amber)}
.notif-title{font-size:13px;font-weight:600}
.notif-sub{font-size:11px;color:var(--t2);margin-top:2px}
/* FORM */
.form-field{margin-bottom:12px}
.form-label{font-size:11px;font-weight:600;color:var(--t2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px;display:block}
.form-input{width:100%;background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);padding:9px 11px;color:var(--text);font-size:13px;font-family:inherit;outline:none;transition:border-color .2s}
.form-input:focus{border-color:var(--brand)}
.form-select{width:100%;background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);padding:9px 11px;color:var(--text);font-size:13px;font-family:inherit;outline:none;appearance:none;cursor:pointer}
/* MODAL */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:300;display:flex;align-items:flex-end;justify-content:center;padding:0;backdrop-filter:blur(3px)}
@media(min-width:600px){.modal-overlay{align-items:center;padding:20px}}
.modal{background:#fff;border-radius:16px 16px 0 0;width:100%;max-width:520px;max-height:92vh;overflow-y:auto;box-shadow:0 -4px 40px rgba(0,0,0,.15)}
@media(min-width:600px){.modal{border-radius:14px;max-height:85vh}}
.modal-hdr{display:flex;align-items:center;justify-content:space-between;padding:18px 20px 0;position:sticky;top:0;background:#fff;z-index:1}
.modal-title{font-size:15px;font-weight:700}
.modal-close{background:none;border:none;color:var(--t2);cursor:pointer;font-size:22px;line-height:1;padding:2px}
.modal-body{padding:16px 20px 20px}
/* CELEBRATION */
@keyframes celebrate{0%{transform:scale(0) rotate(-10deg);opacity:0}50%{transform:scale(1.3) rotate(5deg);opacity:1}100%{transform:scale(1) rotate(0deg);opacity:1}}
@keyframes float-up{0%{transform:translateY(0);opacity:1}100%{transform:translateY(-80px);opacity:0}}
.celebration-overlay{position:fixed;inset:0;z-index:400;display:flex;align-items:center;justify-content:center;pointer-events:none}
.celebration-card{background:#fff;border-radius:20px;padding:28px 36px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.15);animation:celebrate .4s ease;pointer-events:auto}
.celebration-emoji{font-size:56px;margin-bottom:12px;display:block}
.celebration-title{font-size:20px;font-weight:800;color:var(--text);margin-bottom:4px}
.celebration-sub{font-size:13px;color:var(--t2)}
.confetti-piece{position:fixed;pointer-events:none;animation:float-up 1.5s ease forwards;font-size:20px;z-index:401}
/* AWARD BADGE */
.award-card{background:linear-gradient(135deg,#FFF8E7,#FFF3CD);border:2px solid #F59E0B;border-radius:var(--r);padding:14px;display:flex;align-items:center;gap:12px;margin-bottom:10px}
.award-icon{font-size:28px;flex-shrink:0}
.award-info{flex:1}
.award-title{font-size:13px;font-weight:700;color:#92400E}
.award-name{font-size:15px;font-weight:800;color:#78350F;margin-top:2px}
.award-sub{font-size:11px;color:#92400E;margin-top:2px;opacity:.8}
/* MISC */
.empty{text-align:center;padding:40px 20px;color:var(--t2)}
.empty-icon{font-size:32px;margin-bottom:8px}
.empty-text{font-size:13px}
.tabs{display:flex;gap:2px;background:var(--s3);border-radius:8px;padding:3px;margin-bottom:16px}
.tab{flex:1;padding:6px 8px;border-radius:6px;border:none;background:transparent;color:var(--t2);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s}
.tab.active{background:#fff;color:var(--text);box-shadow:0 1px 4px rgba(0,0,0,.1)}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.anim{animation:fadeUp .18s ease}
::-webkit-scrollbar{width:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--s4);border-radius:2px}
.loading{display:flex;align-items:center;justify-content:center;height:100%;color:var(--t2);font-size:14px;gap:10px}
.undo-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1A2033;color:#fff;border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:12px;font-size:13px;font-weight:500;z-index:500;box-shadow:0 8px 32px rgba(0,0,0,.25);animation:fadeUp .2s ease}
.undo-btn{background:var(--brand);color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
.topbar.sticky{position:sticky;top:0;z-index:200}
@keyframes spin{to{transform:rotate(360deg)}}
.spinner{width:18px;height:18px;border:2px solid var(--border);border-top-color:var(--brand);border-radius:50%;animation:spin .7s linear infinite}
`

// ─── ICONS ────────────────────────────────────────────────────────────────────
const IC = ({ n, s=16 }) => {
  const paths = {
    home:   'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    tasks:  'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
    users:  'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
    alert:  'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
    chart:  'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    img:    'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
    shield: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    tier:   'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z',
    search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0',
    bell:   'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
    check:  'M5 13l4 4L19 7',
    plus:   'M12 4v16m8-8H4',
    menu:   'M4 6h16M4 12h16M4 18h16',
    x:      'M6 18L18 6M6 6l12 12',
    clock:  'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0',
    gps:    'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z',
    trophy: 'M8 21h8m-4-4v4M7 3H5a2 2 0 00-2 2v3c0 3.314 2.686 6 6 6h2c3.314 0 6-2.686 6-6V5a2 2 0 00-2-2h-2M9 3h6',
    repeat: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
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
const isConfigured = () => { const u = import.meta.env.VITE_SUPABASE_URL; return u && !u.includes('placeholder') && !u.includes('YOUR_PROJECT') }
const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '—'
const fmtDuration = (start, end) => {
  if (!start || !end) return null
  const mins = Math.round((new Date(end) - new Date(start)) / 60000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins/60)}h ${mins%60}m`
}

// ─── SMALL COMPONENTS ─────────────────────────────────────────────────────────
const StatusBadge = ({ status }) => { const c = STATUS_CFG[status]||STATUS_CFG.pending; return <span className="badge" style={{color:c.color,background:c.bg}}>{c.label}</span> }
const PriBadge = ({ priority }) => { const c = PRIORITY_CFG[priority]||PRIORITY_CFG.medium; return <span className="badge" style={{color:c.color,background:`${c.color}22`}}>{c.label}</span> }
const RolePill = ({ role }) => <span className="role-pill" style={{color:avatarColor(role),background:`${avatarColor(role)}22`}}>{ROLE_LABELS[role]||role}</span>
const Avatar = ({ name, role, size=28, avatarUrl=null }) => avatarUrl
  ? <img src={avatarUrl} alt={name} style={{width:size,height:size,borderRadius:'50%',objectFit:'cover',flexShrink:0}} />
  : <div className="tb-avatar" style={{width:size,height:size,background:`${avatarColor(role)}22`,color:avatarColor(role)}}>{initials(name)}</div>
const Stat = ({ label, val, sub, icon, color='#00A87E', bg='rgba(0,168,126,.1)' }) => (
  <div className="stat-card">
    <div className="sc-top"><span className="sc-label">{label}</span><div className="sc-icon" style={{background:bg,color}}>{icon}</div></div>
    <div className="sc-val" style={{color}}>{val}</div>
    <div className="sc-sub">{sub}</div>
  </div>
)

// ─── CELEBRATION ──────────────────────────────────────────────────────────────
function Celebration({ onClose }) {
  const emojis = ['🎉','❤️','⭐','🌟','💪','✅','🏆','👏']
  const confetti = Array.from({length:12},(_,i)=>({id:i,emoji:emojis[i%emojis.length],x:Math.random()*100,delay:Math.random()*0.5}))
  useEffect(()=>{ const t = setTimeout(onClose, 2500); return ()=>clearTimeout(t) },[])
  return (
    <div className="celebration-overlay" onClick={onClose}>
      {confetti.map(c=>(
        <div key={c.id} className="confetti-piece" style={{left:`${c.x}%`,bottom:'20%',animationDelay:`${c.delay}s`}}>{c.emoji}</div>
      ))}
      <div className="celebration-card">
        <span className="celebration-emoji">🎉</span>
        <div className="celebration-title">Task Complete!</div>
        <div className="celebration-sub">Great work — keep it up! 💪</div>
      </div>
    </div>
  )
}

// ─── TASK CARD ────────────────────────────────────────────────────────────────
const TaskCard = ({ task, onClick }) => {
  const p = taskPct(task)
  const dur = fmtDuration(task.started_at, task.completed_at)
  return (
    <div className={`task-card ${task.priority}`} onClick={onClick}>
      <div className="tc-top">
        <div style={{flex:1}}>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:5}}>
            <span className="cat-tag">{CAT_ICONS[task.category]||'📋'} {task.category}</span>
            {task.recurrence && task.recurrence!=='once' && <span className="recurrence-tag">🔁 {RECURRENCE_LABELS[task.recurrence]}</span>}
          </div>
          <div className="tc-title">{task.title}</div>
        </div>
        <StatusBadge status={task.status} />
      </div>
      <div className="tc-meta">
        <PriBadge priority={task.priority} />
        <span style={{fontSize:11,color:'var(--t2)'}}>📅 {task.due_date}</span>
        {task.assigned_user_name && <span style={{fontSize:11,color:'var(--t2)'}}>👤 {task.assigned_user_name}</span>}
        {task.evidence?.length>0 && <span style={{fontSize:11,color:'var(--t2)'}}>📷 {task.evidence.length}</span>}
        {task.compliance && <span className="badge" style={{background:'rgba(139,92,246,.1)',color:'#8B5CF6'}}>🔒</span>}
        {dur && <span style={{fontSize:11,color:'var(--t2)'}}>⏱ {dur}</span>}
        {task.gps_start && (
          <a href={`https://www.google.com/maps?q=${task.gps_start}`} target="_blank" rel="noopener noreferrer" 
            style={{fontSize:11,color:'var(--blue)',textDecoration:'none'}} 
            onClick={e=>e.stopPropagation()}
            title="View on Google Maps">
            📍 GPS ↗
          </a>
        )}
      </div>
      {task.subtasks?.length>0 && (
        <div className="tc-progress">
          <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--t2)'}}><span>{task.subtasks.filter(s=>s.done).length}/{task.subtasks.length}</span><span>{p}%</span></div>
          <div className="pb-bg"><div className="pb-fill" style={{width:`${p}%`}}/></div>
        </div>
      )}
      {task.escalation && <div className="esc-flag">⚠️ Escalated</div>}
    </div>
  )
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
const DEMO_ACCOUNTS = [
  { email:'admin@taksyn.demo',      password:'Demo1234!', role:'super_admin',  name:'Super Admin',  desc:'Full platform access' },
  { email:'clientadmin@taksyn.demo',password:'Demo1234!', role:'client_admin', name:'Client Admin', desc:'Manage org & teams' },
  { email:'manager@taksyn.demo',    password:'Demo1234!', role:'manager',      name:'Manager',      desc:'Team oversight' },
  { email:'supervisor@taksyn.demo', password:'Demo1234!', role:'supervisor',   name:'Supervisor',   desc:'Review evidence' },
  { email:'worker@taksyn.demo',     password:'Demo1234!', role:'worker',       name:'Worker',       desc:'Complete tasks' },
]

// ─── ONBOARDING ───────────────────────────────────────────────────────────────
function OnboardingView({ user, onComplete }) {
  const [step, setStep] = useState(0)
  const steps = [
    {
      icon:'👋',
      title:`Welcome to Taksyn, ${user.name.split(' ')[0]}!`,
      sub:'Your task compliance and accountability platform.',
      body: <div style={{display:'flex',flexDirection:'column',gap:12}}>
        {[['📋','Assign tasks','Create tasks and assign them to specific staff members'],['📷','Capture evidence','Workers submit photo proof of completed work'],['⚡','Auto escalation','Overdue tasks automatically escalate up the management chain'],['🛡️','Compliance audit trail','Every action is timestamped and traceable for audits']].map(([icon,title,desc])=>(
          <div key={title} style={{display:'flex',gap:12,padding:'10px 12px',background:'var(--s3)',borderRadius:8}}>
            <span style={{fontSize:20}}>{icon}</span>
            <div><div style={{fontSize:13,fontWeight:600}}>{title}</div><div style={{fontSize:12,color:'var(--t2)',marginTop:2}}>{desc}</div></div>
          </div>
        ))}
      </div>
    },
    {
      icon:'🏢',
      title:'Your Role: ' + (ROLE_LABELS[user.role]||user.role),
      sub:'Here is what you can do in Taksyn.',
      body: <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {user.role==='super_admin'&&[['👥','Manage all users and teams'],['📊','Full platform reports and analytics'],['🔧','Configure task templates and workflows'],['🏆','View staff performance and awards']].map(([i,t])=><div key={t} style={{display:'flex',gap:10,padding:'8px 10px',background:'var(--s3)',borderRadius:6}}><span>{i}</span><span style={{fontSize:13}}>{t}</span></div>)}
        {user.role==='worker'&&[['📋','See tasks assigned to you'],['▶️','Time in and time out for each task'],['📷','Upload photo evidence'],['✅','Submit tasks for supervisor review']].map(([i,t])=><div key={t} style={{display:'flex',gap:10,padding:'8px 10px',background:'var(--s3)',borderRadius:6}}><span>{i}</span><span style={{fontSize:13}}>{t}</span></div>)}
        {user.role==='supervisor'&&[['🔍','Review and approve worker submissions'],['✅','Approve or send tasks back with instructions'],['⚠️','Escalate issues to manager'],['📊','View team performance']].map(([i,t])=><div key={t} style={{display:'flex',gap:10,padding:'8px 10px',background:'var(--s3)',borderRadius:6}}><span>{i}</span><span style={{fontSize:13}}>{t}</span></div>)}
        {user.role==='manager'&&[['👥','Oversee all team tasks'],['⚠️','Manage escalations'],['📊','View completion rates and performance'],['🏆','Award top performers']].map(([i,t])=><div key={t} style={{display:'flex',gap:10,padding:'8px 10px',background:'var(--s3)',borderRadius:6}}><span>{i}</span><span style={{fontSize:13}}>{t}</span></div>)}
        {user.role==='client_admin'&&[['🏢','Manage your organisation'],['👥','Invite and manage staff'],['📊','Full reports and compliance tracking'],['📧','Invite via email or WhatsApp']].map(([i,t])=><div key={t} style={{display:'flex',gap:10,padding:'8px 10px',background:'var(--s3)',borderRadius:6}}><span>{i}</span><span style={{fontSize:13}}>{t}</span></div>)}
      </div>
    },
    {
      icon:'🚀',
      title:"You're all set!",
      sub:'Here are your first steps to get started.',
      body: <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {(user.role==='super_admin'||user.role==='client_admin')&&[['1','Go to Team','Invite your staff via email or WhatsApp'],['2','Create a Task','Assign it to a staff member with a due date'],['3','Check Reports','Monitor completion rates and compliance']].map(([n,t,d])=>(
          <div key={n} style={{display:'flex',gap:12,padding:'10px 12px',background:'var(--brand-lt)',border:'1px solid rgba(0,168,126,.2)',borderRadius:8}}>
            <div style={{width:24,height:24,borderRadius:'50%',background:'var(--brand)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,flexShrink:0}}>{n}</div>
            <div><div style={{fontSize:13,fontWeight:600}}>{t}</div><div style={{fontSize:12,color:'var(--t2)',marginTop:2}}>{d}</div></div>
          </div>
        ))}
        {user.role==='worker'&&[['1','Go to My Tasks','See tasks assigned to you'],['2','Tap a task','Press Time In to start, Time Out when done'],['3','Upload a photo','Take a photo as evidence before submitting']].map(([n,t,d])=>(
          <div key={n} style={{display:'flex',gap:12,padding:'10px 12px',background:'var(--brand-lt)',border:'1px solid rgba(0,168,126,.2)',borderRadius:8}}>
            <div style={{width:24,height:24,borderRadius:'50%',background:'var(--brand)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,flexShrink:0}}>{n}</div>
            <div><div style={{fontSize:13,fontWeight:600}}>{t}</div><div style={{fontSize:12,color:'var(--t2)',marginTop:2}}>{d}</div></div>
          </div>
        ))}
        {(user.role==='supervisor'||user.role==='manager')&&[['1','Check Evidence tab','Review submitted tasks from workers'],['2','Approve or send back','Add instructions if work needs redoing'],['3','Monitor escalations','Act on any overdue or escalated tasks']].map(([n,t,d])=>(
          <div key={n} style={{display:'flex',gap:12,padding:'10px 12px',background:'var(--brand-lt)',border:'1px solid rgba(0,168,126,.2)',borderRadius:8}}>
            <div style={{width:24,height:24,borderRadius:'50%',background:'var(--brand)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,flexShrink:0}}>{n}</div>
            <div><div style={{fontSize:13,fontWeight:600}}>{t}</div><div style={{fontSize:12,color:'var(--t2)',marginTop:2}}>{d}</div></div>
          </div>
        ))}
      </div>
    }
  ]
  const current = steps[step]
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:500,display:'flex',alignItems:'center',justifyContent:'center',padding:20,backdropFilter:'blur(4px)'}}>
      <style>{CSS}</style>
      <div style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:460,maxHeight:'85vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,.15)'}}>
        <div style={{padding:'28px 24px 0',textAlign:'center'}}>
          <div style={{fontSize:48,marginBottom:12}}>{current.icon}</div>
          <div style={{fontSize:18,fontWeight:800,marginBottom:6}}>{current.title}</div>
          <div style={{fontSize:13,color:'var(--t2)',marginBottom:20}}>{current.sub}</div>
        </div>
        <div style={{padding:'0 24px 24px'}}>
          {current.body}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:20}}>
            <div style={{display:'flex',gap:6}}>
              {steps.map((_,i)=><div key={i} style={{width:i===step?20:7,height:7,borderRadius:4,background:i===step?'var(--brand)':'var(--s4)',transition:'width .2s'}}/>)}
            </div>
            <div style={{display:'flex',gap:8}}>
              {step>0&&<button className="btn btn-secondary btn-sm" onClick={()=>setStep(s=>s-1)}>Back</button>}
              {step<steps.length-1
                ? <button className="btn btn-primary" onClick={()=>setStep(s=>s+1)}>Next →</button>
                : <button className="btn btn-primary" onClick={onComplete}>Get Started 🚀</button>
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AuthView({ onAuth }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('worker')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const demoLogin = (a) => onAuth({ id:a.role, email:a.email, name:a.name, role:a.role, tier:a.role==='super_admin'?'Enterprise':a.role==='client_admin'?'Professional':'Growth', org:'BrightCare Operations' })

  const handleSubmit = async () => {
    setError('')
    if (!email||!password) { setError('Please fill in all fields'); return }
    setLoading(true)
    try {
      if (!isConfigured()) {
        const found = DEMO_ACCOUNTS.find(a=>a.email===email&&a.password===password)
        if (found) { demoLogin(found); return }
        onAuth({ id:email, email, name:name||email.split('@')[0], role:'worker', tier:'Growth', org:'My Organisation' })
        return
      }
      if (mode==='register') {
        const { error:e } = await supabase.auth.signUp({ email, password, options:{ data:{name,role} } })
        if (e) throw e
        setError('Check your email to confirm your account, then sign in.')
        setMode('login')
      } else {
        const { error:e } = await supabase.auth.signInWithPassword({ email, password })
        if (e) throw e
      }
    } catch(e) { setError(e.message||'Something went wrong') }
    finally { setLoading(false) }
  }

  return (
    <div className="auth-bg">
      <style>{CSS}</style>
      <div className="auth-card">
        <div className="auth-logo"><img src="/logo.jpeg" alt="Taksyn" style={{height:48,objectFit:'contain'}} /></div>
        <div className="auth-title">{mode==='login'?'Sign in to your account':'Create your account'}</div>
        <div className="auth-sub">Task compliance & accountability platform</div>
        {error && <div className="auth-error">{error}</div>}
        {mode==='register' && <div className="auth-field"><label className="auth-label">Full Name</label><input className="auth-input" placeholder="Your name" value={name} onChange={e=>setName(e.target.value)} /></div>}
        <div className="auth-field"><label className="auth-label">Email</label><input className="auth-input" type="email" placeholder="you@organisation.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleSubmit()} /></div>
        <div className="auth-field"><label className="auth-label">Password</label><input className="auth-input" type="password" placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleSubmit()} /></div>
        {mode==='register' && <div className="auth-field"><label className="auth-label">Role</label><select className="auth-input" value={role} onChange={e=>setRole(e.target.value)} style={{cursor:'pointer'}}>{ROLES.filter(r=>r!=='super_admin').map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></div>}
        <button className="auth-btn" onClick={handleSubmit} disabled={loading}>{loading?'Please wait…':mode==='login'?'Sign In':'Create Account'}</button>
        <div className="auth-toggle">{mode==='login'?<>No account? <a onClick={()=>setMode('register')}>Sign up</a></>:<>Have an account? <a onClick={()=>setMode('login')}>Sign in</a></>}</div>

      </div>
    </div>
  )
}

// ─── TASK VISIBILITY ──────────────────────────────────────────────────────────
function visibleTasks(tasks, user) {
  if (['super_admin','client_admin','manager','supervisor'].includes(user.role)) return tasks
  return tasks.filter(t=>
    t.assigned_user_id === user.id ||
    t.assigned_user_name === user.name ||
    (!t.assigned_user_id && !t.assigned_user_name && t.assigned_role === user.role)
  )
}

// ─── AWARDS ──────────────────────────────────────────────────────────────────
function computeAwards(tasks) {
  const workerStats = {}
  tasks.filter(t=>['completed','approved'].includes(t.status)&&t.assigned_role==='worker').forEach(t=>{
    const key = t.completed_by||'Worker'
    if (!workerStats[key]) workerStats[key]={name:key,count:0,totalMins:0}
    workerStats[key].count++
    const dur = t.started_at&&t.completed_at ? (new Date(t.completed_at)-new Date(t.started_at))/60000 : 0
    workerStats[key].totalMins += dur
  })
  const sorted = Object.values(workerStats).sort((a,b)=>b.count-a.count)
  return { week: sorted[0]||null, month: sorted[0]||null, year: sorted[0]||null }
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function DashboardView({ tasks, user, setPage }) {
  const visible = visibleTasks(tasks, user)
  const done = visible.filter(t=>['completed','approved','awaiting_review'].includes(t.status)).length
  const overdue = visible.filter(t=>t.status==='overdue').length
  const esc = visible.filter(t=>t.escalation).length
  const rate = pct(done, visible.length)
  const compT = visible.filter(t=>t.compliance)
  const compDone = compT.filter(t=>['completed','approved'].includes(t.status)).length
  const pending = visible.filter(t=>t.status==='pending').length
  const review = visible.filter(t=>t.status==='awaiting_review').length
  const rejected = visible.filter(t=>t.status==='rejected').length
  const awards = computeAwards(tasks)

  const isSA = user.role==='super_admin', isCA = user.role==='client_admin'
  const isMgr = user.role==='manager', isSup = user.role==='supervisor', isWkr = user.role==='worker'

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-title">{isSA?'Platform Overview':isCA?'Organisation Dashboard':isMgr?'Team Dashboard':isSup?'Supervisor Dashboard':'My Tasks Today'}</div>
        <div className="ph-sub">{isSA?`Full visibility · ${visible.length} total tasks`:isCA?`${user.org} · ${visible.length} tasks`:isMgr?`Monitor team performance`:isSup?`Review evidence and approve submissions`:`Hello ${user.name.split(' ')[0]} — your tasks for today`}</div>
      </div>

      <div className="stat-grid">
        {(isSA||isCA||isMgr) && <>
          <Stat label="Total Tasks" val={visible.length} sub={`${pending} pending`} icon="📋" />
          <Stat label="Completion" val={`${rate}%`} sub={`${done} done`} color="#10B981" bg="rgba(16,185,129,.1)" icon="✅" />
          <Stat label="Overdue" val={overdue} sub={overdue>0?'Action needed':'On track'} color={overdue>0?'#EF4444':'#10B981'} bg={overdue>0?'rgba(239,68,68,.1)':'rgba(16,185,129,.1)'} icon="⏰" />
          <Stat label="Escalations" val={esc} sub={esc>0?'Active':'Clear'} color={esc>0?'#EF4444':'#6B7280'} bg="rgba(107,114,128,.1)" icon="🚨" />
        </>}
        {isSup && <>
          <Stat label="To Review" val={review} sub="Awaiting approval" color="#F59E0B" bg="rgba(245,158,11,.1)" icon="🔍" />
          <Stat label="Approved" val={done} sub="Evidence validated" color="#10B981" bg="rgba(16,185,129,.1)" icon="✅" />
          <Stat label="Escalated" val={esc} sub={esc>0?'Sent to manager':'None'} color={esc>0?'#EF4444':'#6B7280'} bg="rgba(107,114,128,.1)" icon="⚠️" />
          <Stat label="Overdue" val={overdue} sub="Needs attention" color={overdue>0?'#EF4444':'#10B981'} bg={overdue>0?'rgba(239,68,68,.1)':'rgba(16,185,129,.1)'} icon="⏰" />
        </>}
        {isWkr && <>
          <Stat label="My Tasks" val={visible.filter(t=>!['awaiting_review','approved','completed'].includes(t.status)).length} sub="remaining to do" icon="📋" />
          <Stat label="Submitted" val={visible.filter(t=>['awaiting_review','approved','completed'].includes(t.status)).length} sub="done or awaiting review" color="#10B981" bg="rgba(16,185,129,.1)" icon="✅" />
          <Stat label="Overdue" val={overdue} sub={overdue>0?'Complete soon':'All good'} color={overdue>0?'#EF4444':'#10B981'} bg={overdue>0?'rgba(239,68,68,.1)':'rgba(16,185,129,.1)'} icon="⏰" />
          <Stat label="Rejected" val={rejected} sub={rejected>0?'Action needed':'All good'} color={rejected>0?'#EF4444':'#6B7280'} bg={rejected>0?'rgba(239,68,68,.1)':'rgba(107,114,128,.1)'} icon="✗" />
        </>}
      </div>

      {overdue>0 && (
        <div className="esc-banner">
          <span style={{fontSize:18}}>🚨</span>
          <div className="esc-banner-body">
            <div className="esc-banner-title">{overdue} task{overdue>1?'s':''} overdue — supervisor notified</div>
            <div className="esc-banner-sub">Immediate action required to maintain compliance</div>
          </div>
          <button className="btn btn-danger btn-sm" onClick={()=>setPage('escalations')}>View</button>
        </div>
      )}

      {/* AWARDS SECTION */}
      {(isSA||isCA||isMgr) && awards.week && (
        <div className="section">
          <div className="section-title">🏆 Staff Recognition</div>
          <div className="award-card">
            <div className="award-icon">🥇</div>
            <div className="award-info">
              <div className="award-title">Worker of the Week</div>
              <div className="award-name">{awards.week.name}</div>
              <div className="award-sub">{awards.week.count} tasks completed this week</div>
            </div>
          </div>
        </div>
      )}

      <div className="two-col">
        <div className="section">
          {(isSA||isCA||isMgr) && <>
            <div className="section-title">Compliance Score</div>
            <div style={{display:'flex',alignItems:'center',gap:16}}>
              <div className="score-ring"><div className="score-val">{pct(compDone,compT.length)}%</div><div className="score-lbl">Score</div></div>
              <div>
                <div style={{fontSize:13,marginBottom:3}}>{compDone}/{compT.length} compliance tasks done</div>
                <div style={{fontSize:12,color:'var(--t2)'}}>{compT.filter(t=>t.status==='overdue').length} critical overdue</div>
                {isSA && <div style={{fontSize:11,color:'var(--t2)',marginTop:6}}>Plan: <span style={{color:TIERS[user.tier]?.color,fontWeight:700}}>{user.tier}</span></div>}
              </div>
            </div>
          </>}
          {isSup && <>
            <div className="section-title">Pending Evidence</div>
            {visible.filter(t=>t.status==='awaiting_review').slice(0,3).map(t=>(
              <div key={t.id} className="notif-item amber" style={{cursor:'pointer'}} onClick={()=>setPage('evidence')}>
                <div className="notif-title">📷 {t.title}</div>
                <div className="notif-sub">Submitted · {t.due_date}</div>
              </div>
            ))}
            {review===0&&<div style={{fontSize:13,color:'var(--t2)'}}>No evidence pending ✅</div>}
          </>}
          {isWkr && <>
            <div className="section-title">My Progress</div>
            <div style={{display:'flex',alignItems:'center',gap:16}}>
              <div className="score-ring"><div className="score-val">{rate}%</div><div className="score-lbl">Done</div></div>
              <div>
                <div style={{fontSize:13,marginBottom:3}}>{done} of {visible.length} tasks done</div>
                <div style={{fontSize:12,color:'var(--t2)'}}>{overdue} overdue · {pending} pending</div>
                <div style={{fontSize:11,color:'var(--brand)',marginTop:6,fontWeight:600}}>Keep it up! 💪</div>
              </div>
            </div>
          </>}
        </div>
        <div className="section">
          <div className="section-title">{isSup?'Escalations':'Alerts'}</div>
          {visible.filter(t=>t.status==='overdue').slice(0,2).map(t=>(
            <div key={t.id} className="notif-item urgent"><div className="notif-title">⚠️ {t.title}</div><div className="notif-sub">Overdue since {t.due_date}</div></div>
          ))}
          {!isWkr&&visible.filter(t=>t.status==='awaiting_review').slice(0,1).map(t=>(
            <div key={t.id} className="notif-item amber"><div className="notif-title">🔍 {t.title}</div><div className="notif-sub">Awaiting review</div></div>
          ))}
          {visible.filter(t=>t.escalation).slice(0,1).map(t=>(
            <div key={t.id} className="notif-item urgent"><div className="notif-title">🚨 {t.title} — Escalated</div><div className="notif-sub">Immediate attention required</div></div>
          ))}
          {overdue===0&&review===0&&esc===0&&<div style={{fontSize:13,color:'var(--t2)'}}>No alerts 🎉</div>}
        </div>
      </div>

      <div style={{marginTop:4}}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:10}}>{isSup?'Tasks Awaiting Review':isWkr?'My Active Tasks':'Active Tasks'}</div>
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

// ─── TASKS VIEW ───────────────────────────────────────────────────────────────
function TasksView({ tasks, setTasks, user, saveTask, updateTaskRemote, loadTasks, search, pushUndo }) {
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState(null)
  const [comment, setComment] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [celebration, setCelebration] = useState(false)
  const [showReject, setShowReject] = useState(null)
  const [rejectNote, setRejectNote] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteScope, setDeleteScope] = useState('')
  const [showEdit, setShowEdit] = useState(false)
  const [editTask, setEditTask] = useState({})
  const [teamUsers, setTeamUsers] = useState([])
  const [userSearch, setUserSearch] = useState('')
  const [newTask, setNewTask] = useState({ title:'', category:'Housekeeping', priority:'medium', due_date:'', compliance:false, recurrence:'once', assigned_role:'worker', assigned_user_id:'', assigned_user_name:'', assigned_user_email:'' })

  useEffect(()=>{
    if (isConfigured()) {
      supabase.from('profiles').select('*').then(({data})=>{ if(data) setTeamUsers(data) })
    }
  },[])

  const visible = visibleTasks(tasks, user)
  const searchFiltered = search ? visible.filter(t=>
    t.title?.toLowerCase().includes(search.toLowerCase()) ||
    t.category?.toLowerCase().includes(search.toLowerCase()) ||
    t.assigned_user_name?.toLowerCase().includes(search.toLowerCase())
  ) : visible
  const filtered = filter==='all'?searchFiltered:filter==='escalated'?searchFiltered.filter(t=>t.escalation):searchFiltered.filter(t=>t.status===filter)

  const update = async (id, changes) => {
    setTasks(prev=>prev.map(t=>t.id===id?{...t,...changes}:t))
    if (isConfigured()) {
      const payload = { ...changes }
      if (changes.subtasks) payload.subtasks = JSON.stringify(changes.subtasks)
      if (changes.evidence) payload.evidence = JSON.stringify(changes.evidence)
      if (changes.comments) payload.comments = JSON.stringify(changes.comments)
      const { error } = await supabase.from('tasks').update(payload).eq('id', id)
      if (error) console.error('Task update error:', error)
    }
  }

  const toggleSub = (tid, idx) => {
    const task = tasks.find(t=>t.id===tid)
    update(tid, { subtasks: task.subtasks.map((s,i)=>i===idx?{...s,done:!s.done}:s) })
  }

  const startTask = (tid) => {
    navigator.geolocation?.getCurrentPosition(
      pos => update(tid, { status:'in_progress', started_at:new Date().toISOString(), gps_start:`${pos.coords.latitude.toFixed(4)},${pos.coords.longitude.toFixed(4)}` }),
      () => update(tid, { status:'in_progress', started_at:new Date().toISOString() })
    )
  }

  const submitTask = (tid) => {
    const task = tasks.find(t=>t.id===tid)
    // Auto-save comment if there is one
    const updatedComments = comment.trim()
      ? [...(task.comments||[]), `${user.name}: ${comment.trim()}`]
      : task.comments || []
    const doSubmit = (extraChanges={}) => {
      update(tid, { 
        status:'awaiting_review', 
        completed_by:user.name,
        comments: updatedComments,
        ...extraChanges
      })
      setCelebration(true)
      setComment('')
      setSelected(null) // close task detail and return to list
    }
    navigator.geolocation?.getCurrentPosition(
      pos => doSubmit({ gps_end:`${pos.coords.latitude.toFixed(4)},${pos.coords.longitude.toFixed(4)}` }),
      () => doSubmit()
    )
  }

  const addComment = (tid) => {
    if (!comment.trim()) return
    const task = tasks.find(t=>t.id===tid)
    update(tid, { comments:[...(task.comments||[]),`${user.name}: ${comment.trim()}`] })
    setComment('')
  }

  const createTask = async () => {
    if (!newTask.title.trim()) return
    const taskId = 'T' + Date.now()
    const t = { 
      id: taskId, 
      ...newTask, 
      status:'pending', 
      subtasks:[], 
      evidence:[], 
      comments:[], 
      escalation:false, 
      created_by:user.name, 
      created_at:new Date().toISOString() 
    }
    // Save to Supabase first
    if (isConfigured()) {
      const payload = {
        ...t,
        subtasks: JSON.stringify([]),
        evidence: JSON.stringify([]),
        comments: JSON.stringify([]),
      }
      const { error } = await supabase.from('tasks').insert(payload)
      if (error) console.error('Task save error:', error)
    }
    setTasks(prev=>[...prev,t])
    if (loadTasks) await loadTasks()
    setShowCreate(false)
    setUserSearch('')
    setNewTask({title:'',category:'Housekeeping',priority:'medium',due_date:'',compliance:false,recurrence:'once',assigned_role:'worker',assigned_user_id:'',assigned_user_name:'',assigned_user_email:''})
  }

  const canCreate = ['super_admin','client_admin','manager','supervisor'].includes(user.role)
  const canApprove = ['super_admin','client_admin','manager','supervisor'].includes(user.role)
  const sel = selected ? tasks.find(t=>t.id===selected) : null

  return (
    <div className="anim">
      {celebration && <Celebration onClose={()=>setCelebration(false)} />}

      {showEdit && sel && (
        <div className="modal-overlay" onClick={()=>setShowEdit(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr">
              <div className="modal-title">Edit Task</div>
              <button className="modal-close" onClick={()=>setShowEdit(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-field">
                <label className="form-label">Task Title</label>
                <input className="form-input" value={editTask.title||''} onChange={e=>setEditTask({...editTask,title:e.target.value})} />
              </div>
              <div className="two-col">
                <div className="form-field">
                  <label className="form-label">Category</label>
                  <select className="form-select" value={editTask.category||''} onChange={e=>setEditTask({...editTask,category:e.target.value})}>
                    {Object.keys(CAT_ICONS).map(c=><option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">Priority</label>
                  <select className="form-select" value={editTask.priority||''} onChange={e=>setEditTask({...editTask,priority:e.target.value})}>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>
              <div className="two-col">
                <div className="form-field">
                  <label className="form-label">Due Date</label>
                  <input className="form-input" type="date" value={editTask.due_date||''} onChange={e=>setEditTask({...editTask,due_date:e.target.value})} />
                </div>
                <div className="form-field">
                  <label className="form-label">Schedule</label>
                  <select className="form-select" value={editTask.recurrence||'once'} onChange={e=>setEditTask({...editTask,recurrence:e.target.value})}>
                    {RECURRENCE_OPTS.map(r=><option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-field">
                <label className="form-label">Assign To</label>
                {teamUsers.length > 0 ? (
                  <select className="form-select" value={editTask.assigned_user_id||''} onChange={e=>{
                    const u = teamUsers.find(u=>u.id===e.target.value)
                    if(u) setEditTask({...editTask,assigned_user_id:u.id,assigned_user_name:u.name,assigned_role:u.role})
                  }}>
                    <option value="">— Select staff member —</option>
                    {teamUsers.map(u=><option key={u.id} value={u.id}>{u.name} ({ROLE_LABELS[u.role]||u.role})</option>)}
                  </select>
                ) : (
                  <select className="form-select" value={editTask.assigned_role||'worker'} onChange={e=>setEditTask({...editTask,assigned_role:e.target.value})}>
                    {ROLES.filter(r=>r!=='super_admin').map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                )}
              </div>
              <div className="form-field" style={{display:'flex',alignItems:'center',gap:10}}>
                <input type="checkbox" id="edit-comp" checked={editTask.compliance||false} onChange={e=>setEditTask({...editTask,compliance:e.target.checked})} style={{width:16,height:16,accentColor:'var(--brand)',cursor:'pointer'}} />
                <label htmlFor="edit-comp" style={{fontSize:13,cursor:'pointer'}}>Compliance-critical task</label>
              </div>
              <div className="form-field">
                <label className="form-label">Add Subtask</label>
                <div style={{display:'flex',gap:8}}>
                  <input className="form-input" id="new-subtask" placeholder="e.g. Check temperature log" onKeyDown={e=>{
                    if(e.key==='Enter'&&e.target.value.trim()){
                      setEditTask(prev=>({...prev,subtasks:[...(prev.subtasks||[]),{t:e.target.value.trim(),done:false}]}))
                      e.target.value=''
                    }
                  }}/>
                  <button className="btn btn-secondary btn-sm" onClick={()=>{
                    const inp=document.getElementById('new-subtask')
                    if(inp.value.trim()){setEditTask(prev=>({...prev,subtasks:[...(prev.subtasks||[]),{t:inp.value.trim(),done:false}]}));inp.value=''}
                  }}>Add</button>
                </div>
                {editTask.subtasks?.length>0 && (
                  <div style={{marginTop:8,display:'flex',flexDirection:'column',gap:4}}>
                    {editTask.subtasks.map((s,i)=>(
                      <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 8px',background:'var(--s3)',borderRadius:6,fontSize:13}}>
                        <span style={{flex:1}}>{s.t}</span>
                        <span style={{cursor:'pointer',color:'var(--red)',fontSize:16}} onClick={()=>setEditTask(prev=>({...prev,subtasks:prev.subtasks.filter((_,j)=>j!==i)}))}>×</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className="btn btn-secondary" onClick={()=>setShowEdit(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={()=>{
                  update(sel.id, editTask)
                  setShowEdit(false)
                }}>Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      )}


        <div className="modal-overlay" onClick={()=>{setShowReject(null);setRejectNote('')}}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr">
              <div className="modal-title">Send Task Back to Worker</div>
              <button className="modal-close" onClick={()=>{setShowReject(null);setRejectNote('')}}>×</button>
            </div>
            <div className="modal-body">
              <div style={{fontSize:13,color:'var(--t2)',marginBottom:14}}>
                The task will be sent back to the worker as <span style={{color:'var(--red)',fontWeight:600}}>Rejected</span> with your instructions.
              </div>
              <div className="form-field">
                <label className="form-label">Instructions for Worker</label>
                <textarea 
                  className="comment-box" 
                  style={{minHeight:80}} 
                  placeholder="e.g. Please re-clean the bathroom and take a clearer photo of the sink area…"
                  value={rejectNote}
                  onChange={e=>setRejectNote(e.target.value)}
                />
              </div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className="btn btn-secondary" onClick={()=>{setShowReject(null);setRejectNote('')}}>Cancel</button>
                <button className="btn btn-danger" disabled={!rejectNote.trim()} onClick={()=>{
                  const task = tasks.find(t=>t.id===showReject)
                  const rejectionMsg = `⚠️ ${user.name} (Supervisor): ${rejectNote.trim()}`
                  update(showReject, {
                    status:'rejected',
                    comments:[...(task.comments||[]), rejectionMsg]
                  })
                  setShowReject(null)
                  setRejectNote('')
                  setSelected(null)
                }}>Send Back to Worker</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={()=>setShowCreate(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr">
              <div className="modal-title">Create New Task</div>
              <button className="modal-close" onClick={()=>setShowCreate(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-field"><label className="form-label">Task Title</label><input className="form-input" value={newTask.title} onChange={e=>setNewTask({...newTask,title:e.target.value})} placeholder="e.g. Daily Safety Inspection" /></div>
              <div className="two-col">
                <div className="form-field"><label className="form-label">Category</label><select className="form-select" value={newTask.category} onChange={e=>setNewTask({...newTask,category:e.target.value})}>{Object.keys(CAT_ICONS).map(c=><option key={c}>{c}</option>)}</select></div>
                <div className="form-field"><label className="form-label">Priority</label><select className="form-select" value={newTask.priority} onChange={e=>setNewTask({...newTask,priority:e.target.value})}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
              </div>
              <div className="two-col">
                <div className="form-field"><label className="form-label">Due Date</label><input className="form-input" type="date" value={newTask.due_date} onChange={e=>setNewTask({...newTask,due_date:e.target.value})} /></div>
                <div className="form-field">
                  <label className="form-label">Assign To</label>
                  {teamUsers.length > 0 ? (
                    <div>
                      <input className="form-input" placeholder="Search staff by name…" value={userSearch} onChange={e=>setUserSearch(e.target.value)} style={{marginBottom:6}} />
                      <select className="form-select" value={newTask.assigned_user_id} onChange={e=>{
                        const u = teamUsers.find(u=>u.id===e.target.value)
                        if (u) setNewTask({...newTask, assigned_user_id:u.id, assigned_user_name:u.name, assigned_user_email:u.email||'', assigned_role:u.role})
                        else setNewTask({...newTask, assigned_user_id:'', assigned_user_name:'', assigned_user_email:''})
                      }}>
                        <option value="">— Select a staff member —</option>
                        {teamUsers.filter(u=>!userSearch||u.name?.toLowerCase().includes(userSearch.toLowerCase())||u.email?.toLowerCase().includes(userSearch.toLowerCase())).map(u=>(
                          <option key={u.id} value={u.id}>{u.name} ({ROLE_LABELS[u.role]||u.role})</option>
                        ))}
                      </select>
                      {newTask.assigned_user_name && <div style={{fontSize:11,color:'var(--brand)',marginTop:4,fontWeight:600}}>✓ Assigned to: {newTask.assigned_user_name}</div>}
                    </div>
                  ) : (
                    <select className="form-select" value={newTask.assigned_role} onChange={e=>setNewTask({...newTask,assigned_role:e.target.value})}>
                      {ROLES.filter(r=>r!=='super_admin').map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                  )}
                </div>
              </div>
              <div className="form-field">
                <label className="form-label">Schedule / Recurrence</label>
                <select className="form-select" value={newTask.recurrence} onChange={e=>setNewTask({...newTask,recurrence:e.target.value})}>
                  {RECURRENCE_OPTS.map(r=><option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>)}
                </select>
              </div>
              {newTask.recurrence!=='once' && (
                <div style={{background:'rgba(0,168,126,.08)',border:'1px solid rgba(0,168,126,.2)',borderRadius:8,padding:10,marginBottom:12,fontSize:12,color:'var(--brand)'}}>
                  🔁 This task will repeat {RECURRENCE_LABELS[newTask.recurrence].toLowerCase()}
                </div>
              )}
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
          <button className="back-btn" onClick={()=>setSelected(null)}><IC n="x" s={14}/> Close</button>
          <div className="detail-header">
            <div style={{flex:1}}>
              <div style={{display:'flex',gap:6,marginBottom:6,flexWrap:'wrap'}}>
                <span className="cat-tag">{CAT_ICONS[sel.category]||'📋'} {sel.category}</span>
                {sel.recurrence&&sel.recurrence!=='once'&&<span className="recurrence-tag">🔁 {RECURRENCE_LABELS[sel.recurrence]}</span>}
              </div>
              <div style={{fontSize:17,fontWeight:800,letterSpacing:'-.5px'}}>{sel.title}</div>
              <div style={{fontSize:11,color:'var(--t2)',marginTop:3}}>{sel.id} · Due {sel.due_date} {sel.created_by&&`· Created by ${sel.created_by}`}</div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:5,alignItems:'flex-end'}}>
              <StatusBadge status={sel.status} />
              <PriBadge priority={sel.priority} />
            </div>
          </div>

          {/* TIMING & GPS */}
          <div className="timing-bar">
            <div className={`timing-chip ${sel.started_at?'active':''}`}>
              ⏱ Time In: {sel.started_at ? fmtTime(sel.started_at) : '—'}
            </div>
            <div className={`timing-chip ${sel.completed_at?'active':''}`}>
              ⏹ Time Out: {sel.completed_at ? fmtTime(sel.completed_at) : '—'}
            </div>
            {fmtDuration(sel.started_at,sel.completed_at) && (
              <div className="timing-chip active">⏱ Duration: {fmtDuration(sel.started_at,sel.completed_at)}</div>
            )}
            {sel.gps_start && (
              <span
                className="gps-chip"
                style={{cursor:'pointer',textDecoration:'underline'}}
                onClick={()=>{ window.location.href=`https://maps.google.com/?q=${sel.gps_start}` }}
              >
                <IC n="gps" s={11}/> 📍 Start: {sel.gps_start}
              </span>
            )}
            {sel.gps_end && (
              <span
                className="gps-chip"
                style={{cursor:'pointer',textDecoration:'underline',background:'rgba(16,185,129,.08)',borderColor:'rgba(16,185,129,.2)',color:'var(--green)'}}
                onClick={()=>{ window.location.href=`https://maps.google.com/?q=${sel.gps_end}` }}
              >
                <IC n="gps" s={11}/> 📍 End: {sel.gps_end}
              </span>
            )}
          </div>

          {sel.status==='rejected' && (
            <div style={{background:'rgba(239,68,68,.06)',border:'1px solid rgba(239,68,68,.25)',borderRadius:10,padding:14,marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:700,color:'var(--red)',marginBottom:6}}>⚠️ Task Sent Back — Action Required</div>
              {sel.comments?.filter(c=>c.includes('Supervisor:')).slice(-1).map((c,i)=>(
                <div key={i} style={{fontSize:13,color:'var(--text)',background:'rgba(239,68,68,.04)',borderRadius:6,padding:'8px 10px',lineHeight:1.5}}>
                  {c.replace('⚠️ ','').replace(/.*Supervisor\):\s*/,'')}
                </div>
              ))}
              <div style={{fontSize:11,color:'var(--t2)',marginTop:8}}>Please complete the required changes and resubmit.</div>
            </div>
          )}

          {sel.status==='rejected' && (
            <div style={{background:'rgba(239,68,68,.06)',border:'1px solid rgba(239,68,68,.25)',borderRadius:10,padding:14,marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:700,color:'var(--red)',marginBottom:6}}>⚠️ Task Sent Back — Action Required</div>
              {sel.comments?.filter(c=>c.startsWith('⚠️')).slice(-1).map((c,i)=>(
                <div key={i} style={{fontSize:13,color:'var(--text)',background:'rgba(239,68,68,.04)',borderRadius:6,padding:'8px 10px',lineHeight:1.5}}>
                  {c.replace('⚠️ ','').split(': ').slice(1).join(': ')}
                </div>
              ))}
              <div style={{fontSize:11,color:'var(--t2)',marginTop:8}}>Please complete the required changes and resubmit.</div>
            </div>
          )}

          {sel.escalation && (
            <div className="esc-banner">
              <span style={{fontSize:18}}>🚨</span>
              <div className="esc-banner-body"><div className="esc-banner-title">Task escalated — supervisor notified</div><div className="esc-banner-sub">Immediate attention required</div></div>
            </div>
          )}

          <div className="section">
            <div className="section-title">Checklist ({sel.subtasks.filter(s=>s.done).length}/{sel.subtasks.length})</div>
            {sel.subtasks.length===0 ? <div style={{fontSize:13,color:'var(--t2)'}}>No subtasks — mark complete directly.</div>
              : sel.subtasks.map((s,i)=>(
                <div key={i} className="subtask-row" onClick={()=>user.role==='worker'&&toggleSub(sel.id,i)}>
                  <div className={`checkbox ${s.done?'checked':''}`}>{s.done&&<IC n="check" s={10}/>}</div>
                  <span className={`subtask-text ${s.done?'done':''}`}>{s.t}</span>
                </div>
              ))
            }
            <div className="pb-bg" style={{marginTop:10}}><div className="pb-fill" style={{width:`${taskPct(sel)}%`}}/></div>
          </div>

          <div className="section">
            <div className="section-title">Evidence / Photo Proof</div>
            {sel.evidence?.length>0 && (
              <div className="ev-thumbs" style={{marginBottom:10}}>
                {sel.evidence.map((e,i)=>(
                  <div key={i} className="ev-thumb" style={{overflow:'hidden'}}>
                    {e.startsWith('data:image') || e.startsWith('http')
                      ? <img src={e} alt="evidence" style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'var(--rs)'}} />
                      : <span style={{fontSize:18}}>📷</span>
                    }
                    {user.role==='worker'&&<div className="ev-rm" onClick={()=>update(sel.id,{evidence:sel.evidence.filter((_,j)=>j!==i)})}>×</div>}
                  </div>
                ))}
              </div>
            )}
            {user.role==='worker' && (
              <div>
                <div style={{display:'flex',gap:8,marginBottom:10}}>
                  <button className="btn btn-secondary" style={{flex:1}} onClick={()=>document.getElementById('camera-input').click()}>
                    📷 Take Photo
                  </button>
                  <button className="btn btn-secondary" style={{flex:1}} onClick={()=>document.getElementById('gallery-input').click()}>
                    🖼 From Gallery
                  </button>
                </div>
                <input id="camera-input" type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={async(e)=>{
                  const file = e.target.files[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = async(ev) => {
                    const dataUrl = ev.target.result
                    const newEvidence = [...(sel.evidence||[]), dataUrl]
                    await update(sel.id, {evidence: newEvidence})
                  }
                  reader.readAsDataURL(file)
                  e.target.value = ''
                }}/>
                <input id="gallery-input" type="file" accept="image/*" style={{display:'none'}} onChange={async(e)=>{
                  const file = e.target.files[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = async(ev) => {
                    const dataUrl = ev.target.result
                    const newEvidence = [...(sel.evidence||[]), dataUrl]
                    await update(sel.id, {evidence: newEvidence})
                  }
                  reader.readAsDataURL(file)
                  e.target.value = ''
                }}/>
                {(!sel.evidence||sel.evidence.length===0) && (
                  <div className="evidence-zone" onClick={()=>document.getElementById('camera-input').click()}>
                    <div style={{fontSize:24,marginBottom:5}}>📷</div>
                    <div style={{fontSize:13,color:'var(--t2)'}}>Tap to take a photo or choose from gallery</div>
                  </div>
                )}
              </div>
            )}
            {user.role!=='worker'&&!sel.evidence?.length&&<div style={{fontSize:13,color:'var(--t2)'}}>No evidence uploaded yet</div>}
          </div>

          <div className="section">
            <div className="section-title">Comments & Notes</div>
            {sel.comments?.map((c,i)=><div key={i} className="comment-item">💬 {c}</div>)}
            <textarea className="comment-box" style={{marginTop:10}} placeholder="Add a note… (saves automatically when you submit or leave the field)" value={comment} onChange={e=>setComment(e.target.value)} onBlur={()=>{ if(comment.trim()) { addComment(sel.id) } }} />
          </div>

          <div className="section">
            <div className="section-title">Details</div>
            <div className="two-col">
              <div style={{fontSize:13}}><span style={{color:'var(--t2)'}}>Due:</span> {sel.due_date}</div>
              <div style={{fontSize:13}}><span style={{color:'var(--t2)'}}>Compliance:</span> {sel.compliance?'🔒 Yes':'—'}</div>
              <div style={{fontSize:13}}><span style={{color:'var(--t2)'}}>Assigned to:</span> {sel.assigned_user_name || ROLE_LABELS[sel.assigned_role]}</div>
              <div style={{fontSize:13}}><span style={{color:'var(--t2)'}}>Schedule:</span> {RECURRENCE_LABELS[sel.recurrence||'once']}</div>
            </div>
          </div>

          {/* RECURRENCE REMOVE OPTIONS */}
          {sel.recurrence&&sel.recurrence!=='once'&&user.role!=='worker'&&(
            <div className="section">
              <div className="section-title">Recurrence Options</div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                <button className="btn btn-secondary btn-sm" onClick={()=>update(sel.id,{recurrence:'once'})}>Remove this repeat only</button>
                <button className="btn btn-danger btn-sm" onClick={()=>update(sel.id,{recurrence:'once',status:'pending'})}>Stop all future repeats</button>
              </div>
            </div>
          )}

          <div className="btn-row">
            {canApprove && !['approved'].includes(sel.status) && (
              <button className="btn btn-secondary" onClick={()=>{ setEditTask({...sel}); setShowEdit(true) }}>✏️ Edit Task</button>
            )}
            {user.role==='worker'&&sel.status==='pending'&&(
              <button className="btn btn-green" onClick={()=>startTask(sel.id)}>⏱ Time In — Start Task</button>
            )}
            {user.role==='worker'&&sel.status==='in_progress'&&!sel.completed_at&&(
              <button className="btn btn-amber" onClick={()=>{
                navigator.geolocation?.getCurrentPosition(
                  pos => update(sel.id,{completed_at:new Date().toISOString(),gps_end:`${pos.coords.latitude.toFixed(4)},${pos.coords.longitude.toFixed(4)}`}),
                  () => update(sel.id,{completed_at:new Date().toISOString()})
                )
              }}>⏹ Time Out — Finish Task</button>
            )}
            {user.role==='worker'&&sel.status==='in_progress'&&sel.completed_at&&(
              <button className="btn btn-primary" onClick={()=>submitTask(sel.id)}>✅ Submit for Review</button>
            )}
            {user.role==='worker'&&sel.status==='in_progress'&&!sel.completed_at&&(
              <button className="btn btn-secondary" onClick={()=>submitTask(sel.id)}>💾 Save Progress</button>
            )}
            {canApprove&&sel.status==='awaiting_review'&&(
              <>
                <button className="btn btn-primary" onClick={()=>update(sel.id,{status:'approved'})}>✅ Approve</button>
                <button className="btn btn-danger" onClick={()=>setShowReject(sel.id)}>✗ Send Back</button>
              </>
            )}
            {canApprove&&!sel.escalation&&!['completed','approved'].includes(sel.status)&&(
              <button className="btn btn-amber" onClick={()=>update(sel.id,{escalation:true,status:'escalated'})}>⚠️ Escalate</button>
            )}
            {canApprove&&sel.escalation&&(
              <button className="btn btn-secondary" onClick={()=>update(sel.id,{escalation:false,status:'in_progress'})}>Resolve Escalation</button>
            )}
            {canApprove&&(
              <div style={{marginLeft:'auto',display:'flex',flexDirection:'column',gap:6,alignItems:'flex-end'}}>
                {!showDeleteConfirm ? (
                  <button className="btn btn-danger btn-sm" onClick={()=>setShowDeleteConfirm(true)}>🗑 Delete Task</button>
                ) : (
                  <div style={{background:'rgba(239,68,68,.06)',border:'1px solid rgba(239,68,68,.25)',borderRadius:8,padding:12,minWidth:220}}>
                    <div style={{fontSize:12,fontWeight:700,color:'var(--red)',marginBottom:10}}>Delete this task?</div>
                    <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12}}>
                      {[['this','This task only'],['future','This and all future']].map(([v,l])=>(
                        <label key={v} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12}}>
                          <input type="radio" name="deleteScope" value={v} checked={deleteScope===v} onChange={()=>setDeleteScope(v)} style={{accentColor:'var(--red)'}} />
                          {l}
                        </label>
                      ))}
                    </div>
                    <div style={{display:'flex',gap:6}}>
                      <button className="btn btn-secondary btn-sm" onClick={()=>{setShowDeleteConfirm(false);setDeleteScope('')}}>Cancel</button>
                      <button className="btn btn-danger btn-sm" disabled={!deleteScope} onClick={async()=>{
                        if(pushUndo) pushUndo('Deleted: '+sel.title, tasks)
                        setTasks(prev=>prev.filter(t=>t.id!==sel.id))
                        if(isConfigured()) await supabase.from('tasks').delete().eq('id',sel.id)
                        setShowDeleteConfirm(false); setDeleteScope(''); setSelected(null)
                      }}>Confirm Delete</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="ph">
            <div className="ph-top">
              <div><div className="ph-title">Tasks</div><div className="ph-sub">{visible.length} tasks · {visible.filter(t=>t.compliance).length} compliance-critical</div></div>
              {canCreate&&<button className="btn btn-primary" onClick={()=>setShowCreate(true)}><IC n="plus" s={13}/> New Task</button>}
            </div>
          </div>
          <div className="filter-bar">
            {['all','pending','in_progress','awaiting_review','completed','overdue','escalated'].map(f=>(
              <button key={f} className={`fb ${filter===f?'active':''}`} onClick={()=>setFilter(f)}>
                {f==='all'?'All':(STATUS_CFG[f]?.label||f)} <span style={{opacity:.6}}>({f==='all'?visible.length:f==='escalated'?visible.filter(t=>t.escalation).length:visible.filter(t=>t.status===f).length})</span>
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

// ─── ESCALATIONS ──────────────────────────────────────────────────────────────
function EscalationsView({ tasks, setTasks, user }) {
  const esc = tasks.filter(t=>t.escalation||t.status==='overdue'||t.status==='escalated')
  const resolve = id => setTasks(prev=>prev.map(t=>t.id===id?{...t,escalation:false,status:'in_progress'}:t))
  return (
    <div className="anim">
      <div className="ph"><div className="ph-title">Escalations</div><div className="ph-sub">{esc.length} issues requiring attention</div></div>
      {esc.length===0
        ? <div className="empty"><div className="empty-icon">🎉</div><div className="empty-text">No active escalations</div></div>
        : esc.map(t=>(
          <div key={t.id} style={{background:'rgba(239,68,68,.04)',border:'1px solid rgba(239,68,68,.15)',borderRadius:10,padding:14,marginBottom:10}}>
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:10}}>
              <div>
                <div style={{fontSize:14,fontWeight:700}}>{t.title}</div>
                <div style={{fontSize:11,color:'var(--t2)',marginTop:3}}>Due: {t.due_date} · {ROLE_LABELS[t.assigned_role]}</div>
                <div style={{marginTop:7}}><PriBadge priority={t.priority}/></div>
              </div>
              <span className="badge" style={{background:'rgba(239,68,68,.1)',color:'var(--red)',flexShrink:0}}>🚨 {t.status==='overdue'?'Overdue':'Escalated'}</span>
            </div>
            {['super_admin','client_admin','manager','supervisor'].includes(user.role)&&(
              <div style={{marginTop:10}}><button className="btn btn-secondary btn-sm" onClick={()=>resolve(t.id)}>Mark Acknowledged</button></div>
            )}
          </div>
        ))
      }
    </div>
  )
}

// ─── EVIDENCE ─────────────────────────────────────────────────────────────────
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
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:10}}>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:600}}>{t.title}</div>
                <div style={{fontSize:11,color:'var(--t2)',marginTop:3}}>{ROLE_LABELS[t.assigned_role]} · {t.due_date}</div>
                {fmtDuration(t.started_at,t.completed_at)&&<div style={{fontSize:11,color:'var(--t2)',marginTop:3}}>⏱ Duration: {fmtDuration(t.started_at,t.completed_at)}</div>}
                <div style={{display:'flex',gap:5,marginTop:7,flexWrap:'wrap'}}><StatusBadge status={t.status}/>{t.compliance&&<span className="badge" style={{background:'rgba(139,92,246,.1)',color:'#8B5CF6'}}>🔒 Compliance</span>}</div>
              </div>
              <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                {t.evidence?.length>0?t.evidence.map((e,i)=>(
                  <div key={i} className="ev-thumb" style={{width:48,height:48,overflow:'hidden'}}>
                    {e.startsWith('data:image')||e.startsWith('http')
                      ? <img src={e} alt="evidence" style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'var(--rs)'}}/>
                      : <span style={{fontSize:16}}>📷</span>
                    }
                  </div>
                )):<span style={{fontSize:11,color:'var(--t2)'}}>No photos</span>}
              </div>
            </div>
            <div className="pb-bg" style={{marginTop:8}}><div className="pb-fill" style={{width:`${taskPct(t)}%`}}/></div>
            {['super_admin','client_admin','manager','supervisor'].includes(user.role)&&t.status==='awaiting_review'&&(
              <div style={{display:'flex',gap:7,marginTop:10}}><button className="btn btn-primary btn-sm" onClick={()=>approve(t.id)}>✅ Approve</button><button className="btn btn-danger btn-sm" onClick={()=>reject(t.id)}>✗ Reject</button></div>
            )}
          </div>
        ))
      }
    </div>
  )
}

// ─── REPORTS ──────────────────────────────────────────────────────────────────
function ReportsView({ tasks, user }) {
  const [tab, setTab] = useState('overview')
  const [period, setPeriod] = useState('weekly')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const getDateRange = () => {
    const now = new Date()
    const end = new Date(now); end.setHours(23,59,59,999)
    const start = new Date(now)
    if (period==='weekly') { start.setDate(now.getDate()-7) }
    else if (period==='monthly') { start.setMonth(now.getMonth()-1) }
    else if (period==='quarterly') { start.setMonth(now.getMonth()-3) }
    else if (period==='annual') { start.setFullYear(now.getFullYear()-1) }
    else if (period==='custom') { 
      return { start: customStart ? new Date(customStart) : null, end: customEnd ? new Date(customEnd) : null }
    }
    return { start, end }
  }

  const { start: rangeStart, end: rangeEnd } = getDateRange()
  const filteredByPeriod = tasks.filter(t => {
    if (!rangeStart || !rangeEnd) return true
    const taskDate = new Date(t.created_at || t.due_date)
    return taskDate >= rangeStart && taskDate <= rangeEnd
  })
  const pt = filteredByPeriod
  const total = pt.length
  const done = pt.filter(t=>['completed','approved'].includes(t.status)).length
  const approved = pt.filter(t=>t.status==='approved').length
  const rejected = pt.filter(t=>t.status==='rejected').length
  const overdue = pt.filter(t=>t.status==='overdue').length
  const notOnTime = pt.filter(t=>t.due_date && t.completed_at && new Date(t.completed_at) > new Date(t.due_date)).length
  const esc = pt.filter(t=>t.escalation).length
  const compT = pt.filter(t=>t.compliance), compDone = compT.filter(t=>['completed','approved'].includes(t.status)).length

  const byCat = {}
  pt.forEach(t=>{ if(!byCat[t.category]) byCat[t.category]={total:0,done:0}; byCat[t.category].total++; if(['completed','approved'].includes(t.status)) byCat[t.category].done++ })

  // Duration stats
  const tasksWithDuration = pt.filter(t=>t.started_at&&t.completed_at)
  const avgMins = tasksWithDuration.length ? Math.round(tasksWithDuration.reduce((sum,t)=>(new Date(t.completed_at)-new Date(t.started_at))/60000+sum,0)/tasksWithDuration.length) : 0

  // Awards
  const awards = computeAwards(tasks)

  // Weekly chart data — last 7 days
  const last7 = Array.from({length:7},(_,i)=>{
    const d = new Date(); d.setDate(d.getDate()-6+i)
    const dateStr = d.toISOString().split('T')[0]
    const dayTasks = tasks.filter(t=>t.completed_at?.startsWith(dateStr)||t.due_date===dateStr)
    const dayDone = tasks.filter(t=>t.completed_at?.startsWith(dateStr)&&['completed','approved','awaiting_review'].includes(t.status))
    return { label:d.toLocaleDateString([],{weekday:'short'}), total:dayTasks.length, done:dayDone.length }
  })
  const maxBar = Math.max(...last7.map(d=>d.total),1)

  // PDF Export — with logo, detailed stats, period
  const exportPDF = () => {
    const periodLabel = {weekly:'Last 7 Days',monthly:'Last Month',quarterly:'Last 3 Months',annual:'Last Year',custom:`${customStart} to ${customEnd}`}[period]
    const rows = pt.map(t=>`
      <tr>
        <td>${t.id}</td>
        <td><strong>${t.title}</strong></td>
        <td>${t.category}</td>
        <td style="color:${t.status==='approved'?'#10B981':t.status==='rejected'?'#EF4444':t.status==='overdue'?'#F59E0B':'#1a2033'}">${t.status.replace('_',' ').toUpperCase()}</td>
        <td>${t.compliance?'✓ Yes':'—'}</td>
        <td>${t.due_date||'—'}</td>
        <td>${t.completed_at?new Date(t.completed_at).toLocaleDateString():'—'}</td>
        <td>${fmtDuration(t.started_at,t.completed_at)||'—'}</td>
        <td>${t.assigned_user_name||ROLE_LABELS[t.assigned_role]||'—'}</td>
      </tr>`).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Taksyn Compliance Report</title>
    <style>
      *{box-sizing:border-box}
      body{font-family:'Helvetica Neue',sans-serif;padding:40px;color:#1a2033;font-size:13px}
      .header{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;padding-bottom:16px;border-bottom:2px solid #00A87E}
      .logo-area{display:flex;align-items:center;gap:12px}
      .logo-text{font-size:24px;font-weight:800;color:#00A87E;letter-spacing:-1px}
      .report-info{text-align:right;font-size:11px;color:#5a6478}
      .report-info strong{display:block;font-size:14px;color:#1a2033;margin-bottom:2px}
      h2{font-size:12px;color:#5a6478;font-weight:400;margin:8px 0 20px}
      .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
      .stat{background:#f4f6f9;border-radius:8px;padding:14px;text-align:center;border:1px solid #e8ebf0}
      .stat-val{font-size:22px;font-weight:800;color:#00A87E;line-height:1}
      .stat-val.red{color:#EF4444}.stat-val.amber{color:#F59E0B}.stat-val.green{color:#10B981}.stat-val.blue{color:#3B82F6}
      .stat-lbl{font-size:10px;color:#5a6478;margin-top:5px;text-transform:uppercase;letter-spacing:.5px}
      .section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#5a6478;margin:20px 0 8px;padding-bottom:6px;border-bottom:1px solid #e8ebf0}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th{text-align:left;padding:7px 8px;background:#f4f6f9;font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#5a6478;border-bottom:1px solid #e8ebf0}
      td{padding:7px 8px;border-bottom:1px solid #f0f2f5;vertical-align:top}
      tr:hover td{background:#fafbfc}
      .footer{margin-top:28px;padding-top:14px;border-top:1px solid #e8ebf0;font-size:10px;color:#9aa3b2;display:flex;justify-content:space-between}
      @media print{body{padding:20px}.summary{grid-template-columns:repeat(4,1fr)}}
    </style>
    </head><body>
    <div class="header">
      <div class="logo-area">
        <img src="https://taksyn.vercel.app/logo.jpeg" height="40" style="object-fit:contain" onerror="this.style.display='none'" />
        <div class="logo-text">Taksyn</div>
      </div>
      <div class="report-info">
        <strong>Compliance Report</strong>
        ${user.org}<br/>
        Period: ${periodLabel}<br/>
        Generated: ${new Date().toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'})}
      </div>
    </div>
    <h2>Task compliance and accountability summary for ${periodLabel.toLowerCase()}</h2>

    <div class="summary">
      <div class="stat"><div class="stat-val">${total}</div><div class="stat-lbl">Total Tasks</div></div>
      <div class="stat"><div class="stat-val green">${done}</div><div class="stat-lbl">Completed</div></div>
      <div class="stat"><div class="stat-val amber">${total-done}</div><div class="stat-lbl">Not Completed</div></div>
      <div class="stat"><div class="stat-val red">${overdue}</div><div class="stat-lbl">Overdue</div></div>
      <div class="stat"><div class="stat-val green">${approved}</div><div class="stat-lbl">Approved</div></div>
      <div class="stat"><div class="stat-val red">${rejected}</div><div class="stat-lbl">Rejected</div></div>
      <div class="stat"><div class="stat-val amber">${notOnTime}</div><div class="stat-lbl">Not On Time</div></div>
      <div class="stat"><div class="stat-val blue">${pct(compDone,compT.length)}%</div><div class="stat-lbl">Compliance Rate</div></div>
    </div>

    <div class="section-title">Full Task Audit Log (${total} tasks)</div>
    <table>
      <thead><tr><th>ID</th><th>Task</th><th>Category</th><th>Status</th><th>Compliance</th><th>Due Date</th><th>Completed</th><th>Duration</th><th>Assigned To</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="footer">
      <span>Taksyn — Task Compliance & Accountability Platform</span>
      <span>taksyn.vercel.app</span>
    </div>
    </body></html>`
    const w = window.open('','_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(()=>w.print(),800) }
    else { const a=document.createElement('a'); a.href='data:text/html;charset=utf-8,'+encodeURIComponent(html); a.download='taksyn-report.html'; a.click() }
  }

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-top">
          <div><div className="ph-title">Reports & Analytics</div><div className="ph-sub">Audit-ready compliance documentation</div></div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <button className="btn btn-secondary btn-sm" onClick={()=>{
              const csv = ['ID,Title,Category,Status,Priority,Compliance,Evidence,Due Date,Completed,Duration,Assigned To'].join(',') + '\n' +
                pt.map(t=>[t.id,`"${t.title}"`,t.category,t.status,t.priority,t.compliance,t.evidence?.length||0,t.due_date,t.completed_at||'',fmtDuration(t.started_at,t.completed_at)||'',t.assigned_user_name||''].join(',')).join('\n')
              const a = document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv); a.download='taksyn-report.csv'; a.click()
            }}>📥 CSV</button>
            <button className="btn btn-primary btn-sm" onClick={exportPDF}>📄 PDF Report</button>
          </div>
        </div>
      </div>

      {/* PERIOD SELECTOR */}
      <div className="section" style={{marginBottom:14}}>
        <div className="section-title">Reporting Period</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom: period==='custom'?12:0}}>
          {[['weekly','Weekly'],['monthly','Monthly'],['quarterly','3 Months'],['annual','Annual'],['custom','Custom']].map(([k,l])=>(
            <button key={k} className={`fb ${period===k?'active':''}`} onClick={()=>setPeriod(k)}>{l}</button>
          ))}
        </div>
        {period==='custom' && (
          <div style={{display:'flex',gap:10,marginTop:12,flexWrap:'wrap'}}>
            <div className="form-field" style={{marginBottom:0}}>
              <label className="form-label">From</label>
              <input className="form-input" type="date" value={customStart} onChange={e=>setCustomStart(e.target.value)} style={{width:160}} />
            </div>
            <div className="form-field" style={{marginBottom:0}}>
              <label className="form-label">To</label>
              <input className="form-input" type="date" value={customEnd} onChange={e=>setCustomEnd(e.target.value)} style={{width:160}} />
            </div>
          </div>
        )}
      </div>

      <div className="stat-grid" style={{gridTemplateColumns:'repeat(4,1fr)'}}>
        <Stat label="Total Tasks" val={total} sub={`for this period`} icon="📋"/>
        <Stat label="Completed" val={done} sub={`${pct(done,total)}% rate`} color="#10B981" bg="rgba(16,185,129,.1)" icon="✅"/>
        <Stat label="Approved" val={approved} sub="by supervisor" color="#10B981" bg="rgba(16,185,129,.1)" icon="👍"/>
        <Stat label="Rejected" val={rejected} sub="sent back" color={rejected>0?'#EF4444':'#6B7280'} bg="rgba(239,68,68,.1)" icon="✗"/>
      </div>
      <div className="stat-grid" style={{gridTemplateColumns:'repeat(4,1fr)',marginTop:-6}}>
        <Stat label="Overdue" val={overdue} sub="past due date" color={overdue>0?'#EF4444':'#10B981'} bg={overdue>0?'rgba(239,68,68,.1)':'rgba(16,185,129,.1)'} icon="⏰"/>
        <Stat label="Not On Time" val={notOnTime} sub="completed late" color={notOnTime>0?'#F59E0B':'#10B981'} bg="rgba(245,158,11,.1)" icon="⏱"/>
        <Stat label="Compliance" val={`${pct(compDone,compT.length)}%`} sub={`${compDone}/${compT.length}`} color="#8B5CF6" bg="rgba(139,92,246,.1)" icon="🛡️"/>
        <Stat label="Avg Duration" val={avgMins>0?`${avgMins}m`:'—'} sub="per task" color="#3B82F6" bg="rgba(59,130,246,.1)" icon="⏱"/>
      </div>

      {/* WEEKLY BAR CHART */}
      <div className="section" style={{marginBottom:16}}>
        <div className="section-title">Task Activity — Last 7 Days</div>
        <div style={{display:'flex',alignItems:'flex-end',gap:8,height:100,paddingBottom:4}}>
          {last7.map((d,i)=>(
            <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
              <div style={{width:'100%',display:'flex',flexDirection:'column',justifyContent:'flex-end',height:80,gap:2}}>
                {d.total>0&&<div style={{width:'100%',height:`${pct(d.done,d.total)*80/100}px`,background:'var(--green)',borderRadius:'3px 3px 0 0',minHeight:d.done>0?4:0,transition:'height .3s'}}/>}
                {d.total>0&&<div style={{width:'100%',height:`${pct(d.total-d.done,d.total)*80/100}px`,background:'var(--s4)',borderRadius:d.done>0?'0':'3px 3px 0 0',minHeight:d.total-d.done>0?2:0}}/>}
                {d.total===0&&<div style={{width:'100%',height:4,background:'var(--s4)',borderRadius:3}}/>}
              </div>
              <div style={{fontSize:10,color:'var(--t2)',fontWeight:600}}>{d.label}</div>
            </div>
          ))}
        </div>
        <div style={{display:'flex',gap:16,marginTop:8}}>
          <div style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:'var(--t2)'}}><div style={{width:10,height:10,borderRadius:2,background:'var(--green)'}}/> Completed</div>
          <div style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:'var(--t2)'}}><div style={{width:10,height:10,borderRadius:2,background:'var(--s4)'}}/> Pending</div>
        </div>
      </div>

      <div className="tabs">
        {[['overview','By Category'],['performance','Staff Performance'],['audit','Audit Log'],['awards','Awards']].map(([k,l])=>(
          <button key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>

      {tab==='overview' && (
        <div className="section">
          <div className="section-title">Completion by Category</div>
          <div className="tbl-scroll">
            <table className="tbl">
              <thead><tr><th>Category</th><th>Total</th><th>Done</th><th>Rate</th><th>Status</th></tr></thead>
              <tbody>
                {Object.entries(byCat).map(([cat,d])=>{
                  const r = pct(d.done,d.total)
                  return <tr key={cat}><td><span className="cat-tag">{CAT_ICONS[cat]||'📋'} {cat}</span></td><td style={{fontSize:13}}>{d.total}</td><td style={{fontSize:13}}>{d.done}</td><td><div className="mini-prog"><div className="mini-prog-bar"><div className="mini-prog-fill" style={{width:`${r}%`,background:r>=80?'var(--green)':r>=50?'var(--amber)':'var(--red)'}}/></div><span style={{fontSize:11,color:'var(--t2)'}}>{r}%</span></div></td><td><span style={{fontSize:11,color:r===100?'var(--green)':r>=50?'var(--amber)':'var(--red)',fontWeight:600}}>{r===100?'✅ Complete':r>=50?'🔄 In Progress':'⚠️ Behind'}</span></td></tr>
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab==='performance' && (
        <div className="section">
          <div className="section-title">Staff Task Duration Performance</div>
          {tasksWithDuration.length===0
            ? <div style={{fontSize:13,color:'var(--t2)'}}>No timing data yet. Workers need to use Start Task to record durations.</div>
            : <div className="tbl-scroll"><table className="tbl">
                <thead><tr><th>Task</th><th>Worker</th><th>Started</th><th>Completed</th><th>Duration</th><th>GPS</th></tr></thead>
                <tbody>
                  {tasksWithDuration.map(t=>(
                    <tr key={t.id}>
                      <td style={{fontSize:12,fontWeight:500,maxWidth:140}}>{t.title}</td>
                      <td style={{fontSize:12}}>{t.completed_by||'—'}</td>
                      <td style={{fontSize:11,color:'var(--t2)'}}>{fmtTime(t.started_at)}</td>
                      <td style={{fontSize:11,color:'var(--t2)'}}>{fmtTime(t.completed_at)}</td>
                      <td><span style={{fontSize:12,fontWeight:600,color:'var(--brand)'}}>{fmtDuration(t.started_at,t.completed_at)}</span></td>
                      <td>{t.gps_start 
                        ? <a href={`https://www.google.com/maps?q=${t.gps_start}`} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:'var(--blue)',textDecoration:'none'}}>📍 View ↗</a>
                        : <span style={{fontSize:11,color:'var(--t3)'}}>—</span>
                      }</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
          }
        </div>
      )}

      {tab==='audit' && (
        <div className="section">
          <div className="section-title">Full Audit Log</div>
          <div className="tbl-scroll">
            <table className="tbl">
              <thead><tr><th>ID</th><th>Task</th><th>Role</th><th>Status</th><th>Compliance</th><th>Evidence</th><th>Due</th></tr></thead>
              <tbody>
                {tasks.map(t=>(
                  <tr key={t.id}>
                    <td><span className="mono">{t.id}</span></td>
                    <td style={{fontSize:12,fontWeight:500,maxWidth:160}}>{t.title}</td>
                    <td><RolePill role={t.assigned_role}/></td>
                    <td><StatusBadge status={t.status}/></td>
                    <td>{t.compliance?<span style={{color:'#8B5CF6',fontSize:11,fontWeight:700}}>🔒 Yes</span>:<span style={{color:'var(--t2)',fontSize:11}}>—</span>}</td>
                    <td style={{fontSize:11,color:'var(--t2)'}}>{t.evidence?.length||0} files</td>
                    <td style={{fontSize:11,color:'var(--t2)'}}>{t.due_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab==='awards' && (
        <div>
          <div className="section">
            <div className="section-title">🏆 Staff Recognition Awards</div>
            {awards.week ? <>
              <div className="award-card"><div className="award-icon">🥇</div><div className="award-info"><div className="award-title">Worker of the Week</div><div className="award-name">{awards.week.name}</div><div className="award-sub">{awards.week.count} tasks completed</div></div></div>
              <div className="award-card" style={{background:'linear-gradient(135deg,#F0F4FF,#E8EEFF)',borderColor:'#3B82F6'}}><div className="award-icon">🌟</div><div className="award-info"><div className="award-title" style={{color:'#1E40AF'}}>Worker of the Month</div><div className="award-name" style={{color:'#1E3A8A'}}>{awards.month.name}</div><div className="award-sub" style={{color:'#1E40AF'}}>{awards.month.count} tasks completed this month</div></div></div>
              <div className="award-card" style={{background:'linear-gradient(135deg,#F5F0FF,#EDE8FF)',borderColor:'#8B5CF6'}}><div className="award-icon">👑</div><div className="award-info"><div className="award-title" style={{color:'#5B21B6'}}>Worker of the Year</div><div className="award-name" style={{color:'#4C1D95'}}>{awards.year.name}</div><div className="award-sub" style={{color:'#5B21B6'}}>{awards.year.count} tasks completed this year</div></div></div>
            </> : <div style={{fontSize:13,color:'var(--t2)'}}>Awards will appear automatically once workers start completing tasks.</div>}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── USERS ────────────────────────────────────────────────────────────────────
function UsersView({ user }) {
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('worker')
  const [inviteName, setInviteName] = useState('')
  const [inviteMethod, setInviteMethod] = useState('email')
  const [realUsers, setRealUsers] = useState([])

  useEffect(()=>{
    if (isConfigured()) {
      supabase.from('profiles').select('*').then(({data})=>{ if(data) setRealUsers(data) })
    }
  },[])

  const deleteUser = async (id) => {
    if (!confirm('Deactivate this user?')) return
    if (isConfigured()) await supabase.from('profiles').delete().eq('id',id)
    setRealUsers(prev=>prev.filter(u=>u.id!==id))
  }

  const sendInvite = () => {
    if (inviteMethod==='whatsapp') {
      const msg = encodeURIComponent(`Hi ${inviteName}! You've been invited to join Taksyn as ${ROLE_LABELS[inviteRole]}.\n\nSign up here: https://taksyn.vercel.app\n\nUse your email: ${inviteEmail}`)
      window.open(`https://wa.me/?text=${msg}`, '_blank')
    } else {
      alert(`Invite email sent to ${inviteEmail} (simulated)`)
    }
    setShowInvite(false)
    setInviteEmail(''); setInviteName(''); setInviteRole('worker')
  }

  const displayUsers = realUsers.length > 0 ? realUsers : []

  return (
    <div className="anim">
      {showInvite && (
        <div className="modal-overlay" onClick={()=>setShowInvite(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr"><div className="modal-title">Invite Team Member</div><button className="modal-close" onClick={()=>setShowInvite(false)}>×</button></div>
            <div className="modal-body">
              <div className="form-field"><label className="form-label">Full Name</label><input className="form-input" value={inviteName} onChange={e=>setInviteName(e.target.value)} placeholder="Emma Wilson" /></div>
              <div className="form-field"><label className="form-label">Email Address</label><input className="form-input" type="email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="emma@yourorg.com" /></div>
              <div className="form-field"><label className="form-label">Role</label><select className="form-select" value={inviteRole} onChange={e=>setInviteRole(e.target.value)}>{ROLES.filter(r=>r!=='super_admin').map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></div>
              <div className="form-field">
                <label className="form-label">Send Invite Via</label>
                <div style={{display:'flex',gap:8}}>
                  <button className={`btn btn-sm ${inviteMethod==='email'?'btn-primary':'btn-secondary'}`} onClick={()=>setInviteMethod('email')}>📧 Email</button>
                  <button className={`btn btn-sm ${inviteMethod==='whatsapp'?'btn-primary':'btn-secondary'}`} onClick={()=>setInviteMethod('whatsapp')}>💬 WhatsApp</button>
                </div>
              </div>
              {inviteMethod==='whatsapp' && <div style={{background:'rgba(0,168,126,.08)',border:'1px solid rgba(0,168,126,.2)',borderRadius:8,padding:10,fontSize:12,color:'var(--brand)',marginBottom:12}}>Opens WhatsApp with a pre-written invite message including the sign-up link.</div>}
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className="btn btn-secondary" onClick={()=>setShowInvite(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={sendInvite}>{inviteMethod==='whatsapp'?'💬 Send via WhatsApp':'📧 Send Invite'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="ph">
        <div className="ph-top">
          <div><div className="ph-title">Team Members</div><div className="ph-sub">Manage staff access and roles</div></div>
          <button className="btn btn-primary" onClick={()=>setShowInvite(true)}><IC n="plus" s={13}/> Invite</button>
        </div>
      </div>

      <div className="section">
        <div className="section-title">Active Users ({displayUsers.length})</div>
        {displayUsers.length===0 ? (
          <div style={{fontSize:13,color:'var(--t2)'}}>
            No users yet. Invite staff or ask them to sign up at taksyn.vercel.app — they'll appear here automatically.
          </div>
        ) : displayUsers.map((u,i)=>(
          <div key={i} className="user-row">
            <Avatar name={u.name} role={u.role} size={34}/>
            <div className="user-info"><div className="user-name">{u.name}</div><div className="user-email">{u.email||u.org}</div></div>
            <RolePill role={u.role}/>
            <button className="btn btn-danger btn-sm" onClick={()=>deleteUser(u.id)}>Remove</button>
          </div>
        ))}
      </div>

      <div className="section">
        <div className="section-title">Invite Options</div>
        <div style={{fontSize:13,color:'var(--t2)',marginBottom:12}}>Share access with your team via email or WhatsApp:</div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button className="btn btn-primary" onClick={()=>{setInviteMethod('email');setShowInvite(true)}}>📧 Invite via Email</button>
          <button className="btn btn-green" onClick={()=>{setInviteMethod('whatsapp');setShowInvite(true)}}>💬 Invite via WhatsApp</button>
        </div>
        <div style={{marginTop:14,padding:12,background:'var(--s3)',borderRadius:8,fontSize:12,color:'var(--t2)'}}>
          Staff sign up at <span style={{color:'var(--brand)',fontWeight:600}}>taksyn.vercel.app</span> and choose their role. You can then update their role in Supabase → Table Editor → profiles.
        </div>
      </div>
    </div>
  )
}

// ─── TIERS ────────────────────────────────────────────────────────────────────
function TiersView({ user }) {
  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-title">Subscription Plans</div>
        <div className="ph-sub">Hybrid pricing — base subscription + per user. Current: <span style={{color:TIERS[user.tier]?.color,fontWeight:700}}>{user.tier}</span></div>
      </div>

      {/* PRICING EXPLANATION */}
      <div className="section" style={{marginBottom:16,background:'var(--brand-lt)',border:'1px solid rgba(0,168,126,.2)'}}>
        <div style={{display:'flex',gap:16,flexWrap:'wrap',alignItems:'center'}}>
          <div style={{flex:1}}>
            <div style={{fontSize:14,fontWeight:700,color:'var(--brand)',marginBottom:4}}>How pricing works</div>
            <div style={{fontSize:13,color:'var(--t2)',lineHeight:1.6}}>
              Each plan has a <strong>base monthly fee</strong> for the organisation, plus a <strong>per user fee</strong> for each staff member you add. This keeps costs fair — you only pay for the team size you have.
            </div>
          </div>
          <div style={{background:'#fff',borderRadius:8,padding:'10px 16px',fontSize:12,color:'var(--t2)',textAlign:'center',flexShrink:0}}>
            <div style={{fontSize:11,marginBottom:2}}>Example: Growth plan, 20 users</div>
            <div style={{fontWeight:700,color:'var(--text)',fontSize:14}}>$39 + (20 × $8) = <span style={{color:'var(--brand)'}}>$199/mo</span></div>
          </div>
        </div>
      </div>

      {/* TIER CARDS */}
      <div className="tier-grid">
        {Object.entries(TIERS).map(([name,tier])=>(
          <div key={name} className={`tier-card ${user.tier===name?'active':''}`} style={{borderColor:user.tier===name?tier.color:'var(--border)'}}>
            <div>
              <div className="tier-name" style={{color:tier.color}}>{name}</div>
              <div style={{fontSize:10,color:'var(--t2)',marginTop:1}}>{tier.users} users</div>
            </div>
            {/* BASE PRICE */}
            <div style={{background:'var(--s3)',borderRadius:6,padding:'8px 10px'}}>
              <div style={{fontSize:10,color:'var(--t2)',fontWeight:600,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:4}}>Base / month</div>
              <div style={{fontSize:18,fontWeight:800,color:tier.color,letterSpacing:'-1px'}}>{tier.base}</div>
            </div>
            {/* PER USER */}
            <div style={{background:'var(--s3)',borderRadius:6,padding:'8px 10px'}}>
              <div style={{fontSize:10,color:'var(--t2)',fontWeight:600,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:4}}>Per user / month</div>
              <div style={{fontSize:18,fontWeight:800,color:tier.color,letterSpacing:'-1px'}}>{tier.perUser}</div>
            </div>
            {user.tier===name&&<span className="badge" style={{background:`${tier.color}22`,color:tier.color,width:'fit-content'}}>✓ Current Plan</span>}
            {/* LIMITS */}
            <div style={{fontSize:11,color:'var(--t2)',display:'flex',flexDirection:'column',gap:3}}>
              <div>💾 Storage: {tier.storage}</div>
              <div>📷 Images: {tier.images}</div>
              <div>🗓 Retention: {tier.retention}</div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:4,borderTop:'1px solid var(--border)',paddingTop:8}}>
              {tier.features.map(f=><div key={f} className="tier-feat"><div className="tier-dot" style={{background:tier.color}}/>{f}</div>)}
              {tier.locked.map(f=><div key={f} className="tier-feat locked"><div className="tier-dot" style={{background:'var(--t3)'}}/> 🔒 {f}</div>)}
            </div>
            {user.tier!==name&&<button className="btn btn-secondary btn-sm" style={{marginTop:'auto'}}>Upgrade</button>}
          </div>
        ))}
      </div>


    </div>
  )
}

// ─── SIDEBAR NAV CONFIG ───────────────────────────────────────────────────────
const NAV = {
  super_admin:  [['dashboard','Dashboard','home'],['tasks','Tasks','tasks'],['evidence','Evidence','img'],['escalations','Escalations','alert'],['reports','Reports','chart'],['users','Team','users'],['tiers','Plans','tier']],
  client_admin: [['dashboard','Dashboard','home'],['tasks','Tasks','tasks'],['evidence','Evidence','img'],['escalations','Escalations','alert'],['reports','Reports','chart'],['users','Team','users'],['tiers','Plans','tier']],
  manager:      [['dashboard','Dashboard','home'],['tasks','Tasks','tasks'],['evidence','Evidence','img'],['escalations','Escalations','alert'],['reports','Reports','chart']],
  supervisor:   [['dashboard','Dashboard','home'],['tasks','Tasks','tasks'],['evidence','Evidence','img'],['escalations','Escalations','alert']],
  worker:       [['dashboard','Today','home'],['tasks','My Tasks','tasks']],
}

// Role hierarchy — what each role can access
const ROLE_LEVEL = { super_admin:5, client_admin:4, manager:3, supervisor:2, worker:1 }
const hasAccess = (userRole, requiredLevel) => (ROLE_LEVEL[userRole]||0) >= requiredLevel

// Pages each role can access
const PAGE_ACCESS = {
  dashboard:   1, // all roles
  tasks:       1, // all roles
  evidence:    2, // supervisor and above
  escalations: 2, // supervisor and above
  reports:     3, // manager and above
  users:       4, // client_admin and above
  tiers:       4, // client_admin and above
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null)
  const [page, setPage] = useState('dashboard')
  const [tasks, setTasks] = useState(DEMO_TASKS)
  const [loading, setLoading] = useState(false) // Don't show loading by default
  const [tasksLoading, setTasksLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [undoStack, setUndoStack] = useState([]) // [{tasks, label}]
  const [showUndo, setShowUndo] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [profileName, setProfileName] = useState('')
  const [profileMsg, setProfileMsg] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const undoTimer = useRef(null)

  const pushUndo = (label, prevTasks) => {
    setUndoStack(prev=>[...prev.slice(-9), {tasks:prevTasks, label}])
    setShowUndo(true)
    if (undoTimer.current) clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(()=>setShowUndo(false), 5000)
  }
  const doUndo = () => {
    setUndoStack(prev=>{
      if (!prev.length) return prev
      const last = prev[prev.length-1]
      setTasks(last.tasks)
      setShowUndo(false)
      return prev.slice(0,-1)
    })
  }

  // ── LOAD TASKS FROM SUPABASE ──
  const loadTasks = async () => {
    if (!isConfigured()) return
    setTasksLoading(true)
    const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false })
    if (data) {
      // Parse JSONB fields
      const parsed = data.map(t => ({
        ...t,
        subtasks: typeof t.subtasks === 'string' ? JSON.parse(t.subtasks) : (t.subtasks || []),
        evidence: typeof t.evidence === 'string' ? JSON.parse(t.evidence) : (t.evidence || []),
        comments: typeof t.comments === 'string' ? JSON.parse(t.comments) : (t.comments || []),
      }))
      setTasks(parsed)
    }
    setTasksLoading(false)
  }

  // ── SAVE TASK TO SUPABASE ──
  const saveTask = async (task) => {
    if (!isConfigured()) return
    const { id, ...rest } = task
    const payload = {
      ...rest,
      subtasks: JSON.stringify(task.subtasks || []),
      evidence: JSON.stringify(task.evidence || []),
      comments: JSON.stringify(task.comments || []),
    }
    if (id && id.startsWith('T')) {
      // New task with generated ID — insert
      await supabase.from('tasks').insert({ id, ...payload })
    } else {
      await supabase.from('tasks').upsert({ id, ...payload })
    }
  }

  // ── UPDATE TASK IN SUPABASE ──
  const updateTaskRemote = async (id, changes) => {
    if (!isConfigured()) return
    const payload = { ...changes }
    if (changes.subtasks) payload.subtasks = JSON.stringify(changes.subtasks)
    if (changes.evidence) payload.evidence = JSON.stringify(changes.evidence)
    if (changes.comments) payload.comments = JSON.stringify(changes.comments)
    await supabase.from('tasks').update(payload).eq('id', id)
  }

  // Auto-hide topbar on scroll — works everywhere
  const [topbarVisible, setTopbarVisible] = useState(true)
  const lastScrollY = useRef(0)
  useEffect(()=>{
    const handleScroll = (y) => {
      setTopbarVisible(y < lastScrollY.current || y < 60)
      lastScrollY.current = y
    }
    const onWindowScroll = () => handleScroll(window.scrollY)
    const onContentScroll = (e) => handleScroll(e.target.scrollTop)

    window.addEventListener('scroll', onWindowScroll, {passive:true})

    // Also attach to content div when it mounts
    const attachContent = () => {
      const el = document.querySelector('.content')
      if (el) el.addEventListener('scroll', onContentScroll, {passive:true})
    }
    attachContent()
    const t = setTimeout(attachContent, 500)

    return ()=>{
      window.removeEventListener('scroll', onWindowScroll)
      const el = document.querySelector('.content')
      if (el) el.removeEventListener('scroll', onContentScroll)
      clearTimeout(t)
    }
  },[user])

  useEffect(()=>{
    if (!isConfigured()) { setLoading(false); return }

    // Check localStorage first for instant load
    const cachedUser = localStorage.getItem('taksyn-user')
    if (cachedUser) {
      try {
        setUser(JSON.parse(cachedUser))
        setLoading(false)
      } catch(e) { localStorage.removeItem('taksyn-user') }
    } else {
      setLoading(false)
    }

    // Then verify/refresh from Supabase in background
    supabase.auth.getSession().then(({data:{session}})=>{
      if (session?.user) {
        supabase.from('profiles').select('*').eq('id',session.user.id).single()
          .then(({data})=>{
            if(data) {
              const userData = {...data, email:session.user.email}
              setUser(userData)
              localStorage.setItem('taksyn-user', JSON.stringify(userData))
            }
          }).catch(()=>{})
      } else {
        // No session — clear cache
        localStorage.removeItem('taksyn-user')
        setUser(null)
      }
    }).catch(()=>{})

    const {data:{subscription}} = supabase.auth.onAuthStateChange(async(_event, session)=>{
      if (!session) {
        setUser(null)
        localStorage.removeItem('taksyn-user')
      } else {
        try {
          const {data} = await supabase.from('profiles').select('*').eq('id',session.user.id).single()
          const userData = data
            ? {...data, email:session.user.email}
            : { id:session.user.id, email:session.user.email, name:session.user.email.split('@')[0], role:'worker', tier:'Growth', org:'My Organisation' }
          setUser(userData)
          localStorage.setItem('taksyn-user', JSON.stringify(userData))
        } catch(e) {}
      }
    })
    return ()=>subscription.unsubscribe()
  },[])

  // Load tasks when user logs in
  useEffect(()=>{ if(user && isConfigured()) loadTasks() },[user])

  const [showOnboarding, setShowOnboarding] = useState(false)
  const handleAuth = (userData) => {
    setUser(userData)
    setPage('dashboard')
    // Show onboarding for new users (check localStorage)
    const key = `taksyn_onboarded_${userData.id}`
    if (!localStorage.getItem(key)) setShowOnboarding(true)
  }
  const completeOnboarding = () => {
    if (user) localStorage.setItem(`taksyn_onboarded_${user.id}`, '1')
    setShowOnboarding(false)
  }
  const logout = async () => {
    if(isConfigured()) await supabase.auth.signOut()
    localStorage.removeItem('taksyn-user')
    setUser(null); setTasks(DEMO_TASKS); setPage('dashboard')
  }
  useEffect(()=>setPage('dashboard'),[user?.role])

  if (loading) return (
    <>
      <style>{CSS}</style>
      <div className="loading" style={{flexDirection:'column',gap:16}}>
        <img src="/logo.jpeg" alt="Taksyn" style={{height:48,objectFit:'contain'}} />
        <div style={{display:'flex',alignItems:'center',gap:10,color:'var(--t2)',fontSize:14}}>
          <div className="spinner"/>
          <span>Loading Taksyn…</span>
        </div>
        <div style={{fontSize:12,color:'var(--t3)'}}>If this takes too long, <span style={{color:'var(--brand)',cursor:'pointer'}} onClick={()=>setLoading(false)}>click here</span></div>
      </div>
    </>
  )
  if (!user) return <AuthView onAuth={handleAuth} />
  if (showOnboarding) return <OnboardingView user={user} onComplete={completeOnboarding} />

  const escalationCount = tasks.filter(t=>t.escalation||t.status==='overdue').length
  const reviewCount = tasks.filter(t=>t.status==='awaiting_review').length
  const rejectedCount = tasks.filter(t=>t.status==='rejected' && visibleTasks([t],user).length>0).length
  const navItems = NAV[user.role]||NAV.worker
  const pageProps = { tasks, setTasks, user, setPage, saveTask, updateTaskRemote, loadTasks, search, pushUndo }

  const navigate = (key) => { setPage(key); setSidebarOpen(false) }

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        {/* TOPBAR */}
        {/* UNDO TOAST */}
        {showUndo && undoStack.length>0 && (
          <div className="undo-toast">
            <span>↩ {undoStack[undoStack.length-1]?.label}</span>
            <button className="undo-btn" onClick={doUndo}>Undo</button>
            <span style={{cursor:'pointer',opacity:.6,fontSize:16}} onClick={()=>setShowUndo(false)}>×</span>
          </div>
        )}

        <div className="topbar sticky" style={{transform:topbarVisible?'translateY(0)':'translateY(-100%)',transition:'transform .25s ease'}}>
          <button className="tb-menu-btn" onClick={()=>{ if(window.innerWidth<=768) setSidebarOpen(!sidebarOpen); else setSidebarCollapsed(!sidebarCollapsed) }}>
            <IC n="menu" s={18}/>
          </button>
          <img src="/logo.jpeg" alt="Taksyn" className="tb-logo" onClick={()=>navigate('dashboard')} />
          <div className="tb-sep"/>
          <span className="tb-org">{user.org}</span>
          <div className="tb-space"/>
          <div className="tb-search"><IC n="search" s={12}/><input placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
          <button className="tb-icon-btn" onClick={()=>navigate('escalations')}>
            <IC n="bell" s={16}/>
            {escalationCount>0&&<div className="tb-badge">{escalationCount}</div>}
          </button>
          <div className="tb-user" onClick={()=>{ setShowProfile(true); setProfileName(user.name); setProfileMsg('') }} title="My Profile" style={{cursor:'pointer'}}>
            <Avatar name={user.name} role={user.role} size={26} avatarUrl={user.avatar_url}/>
            <div><div className="tb-user-name">{user.name.split(' ')[0]}</div><div className="tb-user-role">{ROLE_LABELS[user.role]}</div></div>
          </div>
        </div>

        {/* PROFILE MODAL */}
        {showProfile && (
          <div className="modal-overlay" onClick={()=>setShowProfile(false)}>
            <div className="modal" onClick={e=>e.stopPropagation()}>
              <div className="modal-hdr">
                <div className="modal-title">My Profile</div>
                <button className="modal-close" onClick={()=>setShowProfile(false)}>×</button>
              </div>
              <div className="modal-body">
                {/* PROFILE INFO */}
                <div style={{display:'flex',alignItems:'center',gap:14,padding:'4px 0 16px',borderBottom:'1px solid var(--border)',marginBottom:16}}>
                  <div style={{position:'relative',flexShrink:0}}>
                    {user.avatar_url
                      ? <img src={user.avatar_url} alt={user.name} style={{width:56,height:56,borderRadius:'50%',objectFit:'cover',border:'2px solid var(--border)'}} />
                      : <Avatar name={user.name} role={user.role} size={56}/>
                    }
                    <button
                      style={{position:'absolute',bottom:-2,right:-2,width:22,height:22,borderRadius:'50%',background:'var(--brand)',border:'2px solid #fff',color:'#fff',fontSize:11,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}
                      onClick={()=>document.getElementById('avatar-input').click()}
                      title="Change photo"
                    >✏️</button>
                    <input id="avatar-input" type="file" accept="image/*" style={{display:'none'}} onChange={async(e)=>{
                      const file = e.target.files[0]
                      if (!file) return
                      const reader = new FileReader()
                      reader.onload = async(ev)=>{
                        const dataUrl = ev.target.result
                        setUser(prev=>({...prev, avatar_url:dataUrl}))
                        if (isConfigured()) {
                          await supabase.from('profiles').update({avatar_url:dataUrl}).eq('id',user.id)
                        }
                        setProfileMsg('✓ Profile photo updated')
                      }
                      reader.readAsDataURL(file)
                      e.target.value=''
                    }}/>
                  </div>
                  <div>
                    <div style={{fontSize:15,fontWeight:700}}>{user.name}</div>
                    <div style={{fontSize:12,color:'var(--t2)',marginTop:2}}>{user.email}</div>
                    <div style={{marginTop:4}}><RolePill role={user.role}/></div>
                    <div style={{fontSize:11,color:'var(--brand)',marginTop:4,cursor:'pointer'}} onClick={()=>document.getElementById('avatar-input').click()}>📷 Change photo</div>
                  </div>
                </div>

                {profileMsg && <div style={{background:'rgba(16,185,129,.08)',border:'1px solid rgba(16,185,129,.2)',borderRadius:6,padding:'8px 12px',fontSize:13,color:'var(--green)',marginBottom:14}}>{profileMsg}</div>}

                {/* UPDATE NAME */}
                <div className="form-field">
                  <label className="form-label">Display Name</label>
                  <input className="form-input" value={profileName} onChange={e=>setProfileName(e.target.value)} placeholder="Your name" />
                </div>
                <button className="btn btn-secondary btn-sm" style={{marginBottom:20}} onClick={async()=>{
                  if (!profileName.trim()) return
                  if (isConfigured()) {
                    await supabase.from('profiles').update({name:profileName.trim()}).eq('id',user.id)
                    setUser(prev=>({...prev,name:profileName.trim()}))
                  }
                  setProfileMsg('✓ Name updated successfully')
                }}>Update Name</button>

                {/* RESET PASSWORD */}
                <div style={{borderTop:'1px solid var(--border)',paddingTop:16,marginTop:4}}>
                  <div style={{fontSize:12,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:12}}>Reset Password</div>
                  <div className="form-field">
                    <label className="form-label">New Password</label>
                    <input className="form-input" type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="Min 6 characters" />
                  </div>
                  <div className="form-field">
                    <label className="form-label">Confirm Password</label>
                    <input className="form-input" type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="Repeat new password" />
                  </div>
                  <button className="btn btn-secondary btn-sm" style={{marginBottom:20}} disabled={!newPassword||newPassword!==confirmPassword||newPassword.length<6} onClick={async()=>{
                    if (isConfigured()) {
                      const {error} = await supabase.auth.updateUser({password:newPassword})
                      if (error) setProfileMsg('❌ '+error.message)
                      else { setProfileMsg('✓ Password updated successfully'); setNewPassword(''); setConfirmPassword('') }
                    } else setProfileMsg('✓ Password reset (demo mode)')
                  }}>
                    {newPassword && confirmPassword && newPassword!==confirmPassword ? '⚠️ Passwords do not match' : 'Update Password'}
                  </button>
                </div>

                {/* SIGN OUT */}
                <div style={{borderTop:'1px solid var(--border)',paddingTop:16}}>
                  <button className="btn btn-danger" style={{width:'100%'}} onClick={()=>{ setShowProfile(false); logout() }}>
                    Sign Out
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="main">
          {/* MOBILE OVERLAY */}
          <div className={`sidebar-overlay ${sidebarOpen?'open':''}`} onClick={()=>setSidebarOpen(false)} />

          {/* SIDEBAR */}
          <div className={`sidebar ${sidebarCollapsed?'collapsed':''} ${sidebarOpen?'mobile-open':''}`}>
            <div className="sb-section">
              <div className="sb-label">Navigation</div>
              {navItems.map(([key,label,icon])=>(
                <button key={key} className={`nav-item ${page===key?'active':''}`} onClick={()=>navigate(key)} title={label}>
                  <IC n={icon} s={15}/>
                  <span className="nav-item-label">{label}</span>
                  {key==='escalations'&&escalationCount>0&&<span className="nav-badge">{escalationCount}</span>}
                  {key==='evidence'&&reviewCount>0&&<span className="nav-badge amber">{reviewCount}</span>}
                  {key==='tasks'&&rejectedCount>0&&user.role==='worker'&&<span className="nav-badge">{rejectedCount}</span>}
                </button>
              ))}
            </div>
            <div className="sb-bottom">
              <div className="sb-user-card">
                <Avatar name={user.name} role={user.role} size={28} avatarUrl={user.avatar_url}/>
                <div className="sb-user-info">
                  <div style={{fontSize:11,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{user.name}</div>
                  <div style={{fontSize:9,color:TIERS[user.tier]?.color,fontWeight:600}}>{user.tier}</div>
                </div>
              </div>
              <button className="sb-logout" onClick={logout}>Sign Out</button>
            </div>
          </div>

          {/* CONTENT */}
          <div className="content">
            {/* Access denied component */}
            {PAGE_ACCESS[page] && !hasAccess(user.role, PAGE_ACCESS[page]) ? (
              <div className="empty" style={{marginTop:60}}>
                <div className="empty-icon">🔒</div>
                <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>Access Restricted</div>
                <div className="empty-text">Your role ({ROLE_LABELS[user.role]}) does not have access to this section.</div>
              </div>
            ) : (
              <>
                {page==='dashboard'   && <DashboardView   {...pageProps}/>}
                {page==='tasks'       && <TasksView        {...pageProps}/>}
                {page==='evidence'    && hasAccess(user.role,2) && <EvidenceView     {...pageProps}/>}
                {page==='escalations' && hasAccess(user.role,2) && <EscalationsView  {...pageProps}/>}
                {page==='reports'     && hasAccess(user.role,3) && <ReportsView      {...pageProps}/>}
                {page==='users'       && hasAccess(user.role,4) && <UsersView        {...pageProps}/>}
                {page==='tiers'       && hasAccess(user.role,4) && <TiersView        {...pageProps}/>}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
