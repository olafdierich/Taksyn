import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase.js'

const ROLES = ['super_admin','client_admin','manager','supervisor','worker']
const ROLE_LABELS = { super_admin:'Super Admin', client_admin:'Client Admin', manager:'Manager', supervisor:'Supervisor', worker:'Worker' }
const ROLE_COLORS = { super_admin:'#F59E0B', client_admin:'#8B5CF6', manager:'#3B82F6', supervisor:'#10B981', worker:'#6B7280' }
const TIERS = {
  Personal:     { color:'#6B7280', base:'$4',   perUser:'$2', users:'Max 4',    storage:'0.5GB', images:'—',     retention:'30 days',  features:['Basic task tracking','Simple checklists','Reminders'], locked:['Photo evidence','Escalation','Compliance reporting'] },
  Starter:      { color:'#3B82F6', base:'$19',  perUser:'$9', users:'1-10',     storage:'5GB',   images:'2/task',retention:'6 months', features:['Task assignment','Photo evidence','Basic reporting'], locked:['Escalation'] },
  Growth:       { color:'#10B981', base:'$39',  perUser:'$8', users:'11-30',    storage:'15GB',  images:'3/task',retention:'12 months',features:['Escalation cascade','GPS tracking','Performance tracking'], locked:[] },
  Professional: { color:'#8B5CF6', base:'$149', perUser:'$7', users:'31-100',   storage:'50GB',  images:'5/task',retention:'24 months',features:['Multi-site support','Advanced escalation','Audit-ready reporting'], locked:[] },
  Enterprise:   { color:'#F59E0B', base:'$399', perUser:'$6', users:'Unlimited',storage:'100GB+',images:'5/task',retention:'Custom',   features:['Full compliance suite','API integrations','White-labelling','SLA'], locked:[] },
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
const RECURRENCE_LABELS = { once:'One-off', daily:'Daily', weekdays:'Weekdays (Mon-Fri)', weekly:'Weekly', fortnightly:'Fortnightly', monthly:'Monthly', quarterly:'Quarterly', annually:'Annually' }
const DEMO_TASKS = []
const ROLE_LEVEL = { super_admin:5, client_admin:4, manager:3, supervisor:2, worker:1 }
const hasAccess = (userRole, requiredLevel) => (ROLE_LEVEL[userRole]||0) >= requiredLevel
const PAGE_ACCESS = { dashboard:1, tasks:1, evidence:2, escalations:2, reports:3, users:4, tiers:4, orgs:5 }
const pct = (a,b) => b ? Math.round(a/b*100) : 0
const initials = name => name ? name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) : '??'
const avatarColor = role => ROLE_COLORS[role] || '#6B7280'
const isConfigured = () => { const u = import.meta.env.VITE_SUPABASE_URL; return u && !u.includes('placeholder') }
const fmtTime = ts => ts ? new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '—'
const fmtDuration = (start, end) => {
  if (!start || !end) return null
  const mins = Math.round((new Date(end) - new Date(start)) / 60000)
  if (mins < 60) return mins + 'm'
  return Math.floor(mins/60) + 'h ' + (mins%60) + 'm'
}
const clearAuthCache = () => {
  try { indexedDB.deleteDatabase('supabase') } catch(e) {}
  localStorage.removeItem('taksyn-auth')
  localStorage.removeItem('taksyn-user')
  sessionStorage.clear()
}
const parseSafe = (val, fallback=[]) => {
  if (Array.isArray(val)) return val
  if (typeof val === 'string') { try { return JSON.parse(val) } catch(e) { return fallback } }
  return fallback
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#F4F6F9;color:#1A2033;font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased}
:root{--brand:#00A87E;--brand-dk:#008A68;--brand-lt:rgba(0,168,126,.1);--s3:#F0F2F5;--s4:#E8EBF0;--border:rgba(0,0,0,.08);--border2:rgba(0,0,0,.14);--text:#1A2033;--t2:#5A6478;--t3:#9AA3B2;--red:#EF4444;--amber:#F59E0B;--blue:#3B82F6;--green:#10B981;--r:10px;--rs:6px;--shadow:0 4px 20px rgba(0,0,0,.08);--sidebar-w:214px}
.auth-bg{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#F0F7F4,#E8F4F0);padding:20px}
.auth-card{background:#fff;border:1px solid var(--border2);border-radius:16px;padding:36px;width:100%;max-width:420px;box-shadow:var(--shadow)}
.auth-logo{display:flex;align-items:center;justify-content:center;margin-bottom:28px}
.auth-title{font-size:20px;font-weight:700;margin-bottom:6px;text-align:center}
.auth-sub{font-size:13px;color:var(--t2);margin-bottom:24px;text-align:center}
.auth-field{margin-bottom:14px}
.auth-label{font-size:11px;font-weight:600;color:var(--t2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px;display:block}
.auth-input{width:100%;background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);padding:11px 14px;color:var(--text);font-size:14px;font-family:inherit;outline:none;transition:border-color .2s}
.auth-input:focus{border-color:var(--brand)}
.auth-btn{width:100%;padding:12px;background:var(--brand);border:none;border-radius:var(--rs);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:4px}
.auth-btn:hover{background:var(--brand-dk)}
.auth-btn:disabled{opacity:.5;cursor:not-allowed}
.auth-error{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:var(--rs);padding:10px 14px;font-size:13px;color:var(--red);margin-bottom:14px}
.auth-success{background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.2);border-radius:var(--rs);padding:10px 14px;font-size:13px;color:var(--green);margin-bottom:14px}
.auth-toggle{text-align:center;font-size:13px;color:var(--t2);margin-top:14px}
.auth-toggle a{color:var(--brand);cursor:pointer;font-weight:600}
.app{display:flex;flex-direction:column;height:100vh;overflow:hidden}
.topbar{display:flex;align-items:center;gap:12px;padding:0 16px;height:52px;background:#fff;border-bottom:1px solid var(--border);flex-shrink:0;z-index:200;position:sticky;top:0}
.tb-menu-btn{background:none;border:none;cursor:pointer;padding:6px;border-radius:6px;color:var(--t2);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.tb-logo{height:30px;object-fit:contain;cursor:pointer}
.tb-sep{width:1px;height:18px;background:var(--border);margin:0 2px}
.tb-org{font-size:13px;color:var(--text);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px}
.tb-space{flex:1}
.tb-search{display:flex;align-items:center;gap:7px;background:var(--s3);border:1px solid var(--border);border-radius:8px;padding:5px 10px;width:180px}
.tb-search input{background:none;border:none;outline:none;color:var(--text);font-size:13px;width:100%;font-family:inherit}
@media(max-width:600px){.tb-search{display:none}.tb-org{max-width:80px}}
.tb-icon-btn{position:relative;background:none;border:none;color:var(--t2);cursor:pointer;padding:6px;border-radius:6px;display:flex;align-items:center}
.tb-badge{position:absolute;top:1px;right:1px;width:15px;height:15px;border-radius:50%;background:var(--red);font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;color:#fff}
.tb-user{display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 8px;border-radius:8px;transition:all .15s;border:1px solid transparent;flex-shrink:0}
.tb-user:hover{background:var(--s3);border-color:var(--border)}
.tb-avatar{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0}
.tb-user-name{font-size:12px;font-weight:600}
.tb-user-role{font-size:10px;color:var(--t2)}
@media(max-width:480px){.tb-user-name,.tb-user-role{display:none}}
.main{display:flex;flex:1;overflow:hidden}
.sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:150}
.sidebar-overlay.open{display:block}
.sidebar{width:var(--sidebar-w);flex-shrink:0;background:#fff;border-right:1px solid var(--border);display:flex;flex-direction:column;overflow-y:auto;overflow-x:hidden;transition:transform .25s,width .25s;z-index:160}
.sidebar.collapsed{width:52px}
@media(max-width:768px){.sidebar{position:fixed;top:52px;left:0;bottom:0;transform:translateX(-100%);width:var(--sidebar-w) !important}.sidebar.mobile-open{transform:translateX(0)}}
.sb-section{padding:14px 8px 6px}
.sb-label{font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:1px;padding:0 8px 6px}
.nav-item{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:var(--rs);cursor:pointer;color:var(--t2);font-size:13px;font-weight:500;transition:all .15s;border:none;background:none;width:100%;text-align:left;font-family:inherit;white-space:nowrap;overflow:hidden}
.nav-item:hover{background:var(--s3);color:var(--text)}
.nav-item.active{background:var(--brand-lt);color:var(--brand)}
.nav-item svg{width:15px;height:15px;flex-shrink:0}
.nav-item-label{transition:opacity .2s,width .2s}
.sidebar.collapsed .nav-item-label{opacity:0;width:0;overflow:hidden}
.nav-badge{margin-left:auto;background:var(--red);color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:10px;min-width:16px;text-align:center}
.nav-badge.amber{background:var(--amber);color:#000}
.sb-bottom{margin-top:auto;padding:10px 8px;border-top:1px solid var(--border)}
.sb-user-card{display:flex;align-items:center;gap:8px;padding:8px;border-radius:var(--rs);background:var(--s3);overflow:hidden}
.sb-user-info{overflow:hidden;transition:opacity .2s,width .2s}
.sidebar.collapsed .sb-user-info{opacity:0;width:0}
.sb-logout{width:100%;margin-top:6px;padding:7px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.15);border-radius:var(--rs);color:var(--red);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
.content{flex:1;overflow-y:auto;padding:20px}
@media(max-width:768px){.content{padding:14px}}
.ph{margin-bottom:20px}
.ph-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ph-title{font-size:20px;font-weight:800;letter-spacing:-.5px}
.ph-sub{font-size:12px;color:var(--t2);margin-top:3px}
.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
@media(max-width:900px){.stat-grid{grid-template-columns:repeat(2,1fr)}}
.stat-card{background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:14px}
.sc-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.sc-label{font-size:10px;color:var(--t2);font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.sc-icon{width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:13px}
.sc-val{font-size:22px;font-weight:800;letter-spacing:-1px;line-height:1}
.sc-sub{font-size:11px;color:var(--t2);margin-top:2px}
.section{background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:16px;margin-bottom:12px}
.section-title{font-size:10px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:640px){.two-col{grid-template-columns:1fr}}
.filter-bar{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px}
.fb{padding:4px 10px;border-radius:var(--rs);border:1px solid var(--border);background:transparent;color:var(--t2);font-size:11px;font-weight:500;cursor:pointer;font-family:inherit}
.fb.active{background:var(--brand-lt);border-color:var(--brand);color:var(--brand)}
.task-card{background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:14px;margin-bottom:8px;cursor:pointer;transition:all .15s;position:relative;overflow:hidden}
.task-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px}
.task-card.critical::before{background:var(--red)}.task-card.high::before{background:#F97316}.task-card.medium::before{background:var(--amber)}.task-card.low::before{background:var(--green)}
.task-card:hover{border-color:var(--border2);transform:translateY(-1px);box-shadow:0 2px 12px rgba(0,0,0,.06)}
.tc-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.tc-title{font-size:14px;font-weight:600;flex:1}
.tc-meta{display:flex;align-items:center;gap:6px;margin-top:7px;flex-wrap:wrap}
.pb-bg{height:3px;background:var(--s3);border-radius:2px;overflow:hidden;margin-top:3px}
.pb-fill{height:100%;border-radius:2px;background:var(--brand);transition:width .3s}
.esc-flag{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--red);font-weight:600;margin-top:5px}
.recurrence-tag{display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--brand);background:var(--brand-lt);padding:2px 7px;border-radius:10px;font-weight:600}
.badge{display:inline-flex;align-items:center;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600;white-space:nowrap}
.cat-tag{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--t2);background:var(--s3);padding:2px 7px;border-radius:4px}
.role-pill{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700}
.back-btn{display:inline-flex;align-items:center;gap:6px;color:var(--t2);font-size:13px;font-weight:500;cursor:pointer;background:none;border:none;font-family:inherit;margin-bottom:14px;padding:0}
.detail-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.checkbox{width:18px;height:18px;border-radius:4px;border:2px solid var(--border2);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s}
.checkbox.checked{background:var(--brand);border-color:var(--brand)}
.evidence-zone{border:2px dashed var(--border);border-radius:var(--r);padding:22px;text-align:center;cursor:pointer}
.ev-thumbs{display:flex;gap:8px;flex-wrap:wrap}
.ev-thumb{width:60px;height:60px;border-radius:var(--rs);background:var(--s3);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:18px;position:relative;overflow:hidden}
.ev-rm{position:absolute;top:-5px;right:-5px;width:16px;height:16px;border-radius:50%;background:var(--red);color:#fff;font-size:9px;display:flex;align-items:center;justify-content:center;cursor:pointer}
.comment-box{width:100%;background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);padding:9px 11px;color:var(--text);font-size:13px;font-family:inherit;resize:vertical;min-height:52px;outline:none}
.comment-item{padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--t2)}
.timing-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.timing-chip{display:flex;align-items:center;gap:5px;background:var(--s3);border:1px solid var(--border);border-radius:6px;padding:5px 10px;font-size:12px;color:var(--t2)}
.timing-chip.active{background:var(--brand-lt);border-color:var(--brand);color:var(--brand);font-weight:600}
.gps-chip{display:flex;align-items:center;gap:5px;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:6px;padding:5px 10px;font-size:11px;color:var(--blue);cursor:pointer}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:var(--rs);font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;border:none;font-family:inherit;white-space:nowrap}
.btn-primary{background:var(--brand);color:#fff}.btn-primary:hover{background:var(--brand-dk)}
.btn-secondary{background:var(--s3);color:var(--text);border:1px solid var(--border)}.btn-secondary:hover{background:var(--s4)}
.btn-danger{background:rgba(239,68,68,.08);color:var(--red);border:1px solid rgba(239,68,68,.2)}.btn-danger:hover{background:rgba(239,68,68,.15)}
.btn-amber{background:rgba(245,158,11,.08);color:var(--amber);border:1px solid rgba(245,158,11,.2)}
.btn-green{background:rgba(16,185,129,.1);color:var(--green);border:1px solid rgba(16,185,129,.25)}
.btn-sm{padding:5px 10px;font-size:12px}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn-row{display:flex;gap:7px;flex-wrap:wrap;margin-top:14px}
.esc-banner{background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.2);border-radius:var(--r);padding:12px 14px;display:flex;align-items:center;gap:10px;margin-bottom:14px}
.esc-banner-body{flex:1}
.esc-banner-title{font-size:13px;font-weight:700;color:var(--red)}
.esc-banner-sub{font-size:11px;color:var(--t2);margin-top:2px}
.tbl{width:100%;border-collapse:collapse;font-size:13px}
.tbl th{text-align:left;padding:8px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--t2);border-bottom:1px solid var(--border)}
.tbl td{padding:10px;border-bottom:1px solid var(--border);vertical-align:middle}
.tbl-scroll{overflow-x:auto}
.mini-prog{display:flex;align-items:center;gap:7px}
.mini-prog-bar{width:60px;height:3px;background:var(--s3);border-radius:2px;overflow:hidden}
.mini-prog-fill{height:100%;border-radius:2px}
.score-ring{width:70px;height:70px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;border:3px solid var(--brand);flex-shrink:0}
.score-val{font-size:17px;font-weight:800;color:var(--brand);line-height:1}
.score-lbl{font-size:9px;color:var(--t2);margin-top:1px}
.tier-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:20px}
@media(max-width:1000px){.tier-grid{grid-template-columns:repeat(3,1fr)}}
@media(max-width:600px){.tier-grid{grid-template-columns:repeat(2,1fr)}}
.tier-card{background:#fff;border:2px solid var(--border);border-radius:var(--r);padding:16px;display:flex;flex-direction:column;gap:8px;transition:all .2s}
.tier-card:hover{transform:translateY(-2px)}
.tier-card.active{box-shadow:0 0 0 2px var(--brand)}
.tier-name{font-size:14px;font-weight:800}
.tier-feat{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t2)}
.tier-feat.locked{opacity:.35}
.tier-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
.user-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)}
.user-info{flex:1;overflow:hidden}
.user-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.user-email{font-size:11px;color:var(--t2);margin-top:1px}
.notif-item{background:var(--s3);border-radius:var(--rs);padding:10px;border-left:3px solid var(--brand);margin-bottom:7px}
.notif-item.urgent{border-left-color:var(--red)}.notif-item.amber{border-left-color:var(--amber)}
.notif-title{font-size:13px;font-weight:600}
.notif-sub{font-size:11px;color:var(--t2);margin-top:2px}
.form-field{margin-bottom:12px}
.form-label{font-size:11px;font-weight:600;color:var(--t2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px;display:block}
.form-input{width:100%;background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);padding:9px 11px;color:var(--text);font-size:13px;font-family:inherit;outline:none}
.form-input:focus{border-color:var(--brand)}
.form-select{width:100%;background:var(--s3);border:1px solid var(--border);border-radius:var(--rs);padding:9px 11px;color:var(--text);font-size:13px;font-family:inherit;outline:none;appearance:none;cursor:pointer}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:300;display:flex;align-items:flex-end;justify-content:center;padding:0;backdrop-filter:blur(3px)}
@media(min-width:600px){.modal-overlay{align-items:center;padding:20px}}
.modal{background:#fff;border-radius:16px 16px 0 0;width:100%;max-width:520px;max-height:92vh;overflow-y:auto;box-shadow:0 -4px 40px rgba(0,0,0,.15)}
@media(min-width:600px){.modal{border-radius:14px;max-height:85vh}}
.modal-hdr{display:flex;align-items:center;justify-content:space-between;padding:18px 20px 0;position:sticky;top:0;background:#fff;z-index:1}
.modal-title{font-size:15px;font-weight:700}
.modal-close{background:none;border:none;color:var(--t2);cursor:pointer;font-size:22px;line-height:1;padding:2px}
.modal-body{padding:16px 20px 20px}
@keyframes celebrate{0%{transform:scale(0) rotate(-10deg);opacity:0}50%{transform:scale(1.3) rotate(5deg);opacity:1}100%{transform:scale(1);opacity:1}}
@keyframes float-up{0%{transform:translateY(0);opacity:1}100%{transform:translateY(-80px);opacity:0}}
.celebration-overlay{position:fixed;inset:0;z-index:400;display:flex;align-items:center;justify-content:center;pointer-events:none}
.celebration-card{background:#fff;border-radius:20px;padding:28px 36px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.15);animation:celebrate .4s ease;pointer-events:auto}
.celebration-emoji{font-size:56px;margin-bottom:12px;display:block}
.celebration-title{font-size:20px;font-weight:800;color:var(--text);margin-bottom:4px}
.celebration-sub{font-size:13px;color:var(--t2)}
.confetti-piece{position:fixed;pointer-events:none;animation:float-up 1.5s ease forwards;font-size:20px;z-index:401}
.award-card{background:linear-gradient(135deg,#FFF8E7,#FFF3CD);border:2px solid #F59E0B;border-radius:var(--r);padding:14px;display:flex;align-items:center;gap:12px;margin-bottom:10px}
.award-icon{font-size:28px;flex-shrink:0}
.award-title{font-size:13px;font-weight:700;color:#92400E}
.award-name{font-size:15px;font-weight:800;color:#78350F;margin-top:2px}
.award-sub{font-size:11px;color:#92400E;margin-top:2px}
.empty{text-align:center;padding:40px 20px;color:var(--t2)}
.empty-icon{font-size:32px;margin-bottom:8px}
.empty-text{font-size:13px}
.tabs{display:flex;gap:2px;background:var(--s3);border-radius:8px;padding:3px;margin-bottom:16px}
.tab{flex:1;padding:6px 8px;border-radius:6px;border:none;background:transparent;color:var(--t2);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
.tab.active{background:#fff;color:var(--text);box-shadow:0 1px 4px rgba(0,0,0,.1)}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.anim{animation:fadeUp .18s ease}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--s4);border-radius:2px}
.loading{display:flex;align-items:center;justify-content:center;height:100%;color:var(--t2);font-size:14px;gap:10px;flex-direction:column}
.undo-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1A2033;color:#fff;border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:12px;font-size:13px;font-weight:500;z-index:500;box-shadow:0 8px 32px rgba(0,0,0,.25)}
.undo-btn{background:var(--brand);color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
@keyframes spin{to{transform:rotate(360deg)}}
.spinner{width:18px;height:18px;border:2px solid var(--border);border-top-color:var(--brand);border-radius:50%;animation:spin .7s linear infinite}
`

const IC = ({ n, s=16 }) => {
  const paths = {
    home:'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    tasks:'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
    users:'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
    alert:'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
    chart:'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    img:'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
    tier:'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z',
    search:'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0',
    bell:'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
    check:'M5 13l4 4L19 7',plus:'M12 4v16m8-8H4',menu:'M4 6h16M4 12h16M4 18h16',x:'M6 18L18 6M6 6l12 12',
    clock:'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0',
    gps:'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z',
    audit:'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    org:'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  }
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d={paths[n]||paths.check} /></svg>
}

const StatusBadge = ({ status }) => { const c = STATUS_CFG[status]||STATUS_CFG.pending; return <span className="badge" style={{color:c.color,background:c.bg}}>{c.label}</span> }
const PriBadge = ({ priority }) => { const c = PRIORITY_CFG[priority]||PRIORITY_CFG.medium; return <span className="badge" style={{color:c.color,background:c.color+'22'}}>{c.label}</span> }
const RolePill = ({ role }) => <span className="role-pill" style={{color:avatarColor(role),background:avatarColor(role)+'22'}}>{ROLE_LABELS[role]||role}</span>
const Avatar = ({ name, role, size=28, avatarUrl=null }) => avatarUrl
  ? <img src={avatarUrl} alt={name} style={{width:size,height:size,borderRadius:'50%',objectFit:'cover',flexShrink:0}} />
  : <div className="tb-avatar" style={{width:size,height:size,background:avatarColor(role)+'22',color:avatarColor(role)}}>{initials(name)}</div>
const Stat = ({ label, val, sub, icon, color='#00A87E', bg='rgba(0,168,126,.1)' }) => (
  <div className="stat-card">
    <div className="sc-top"><span className="sc-label">{label}</span><div className="sc-icon" style={{background:bg,color}}>{icon}</div></div>
    <div className="sc-val" style={{color}}>{val}</div>
    <div className="sc-sub">{sub}</div>
  </div>
)

function Celebration({ onClose }) {
  const emojis = ['🎉','❤️','⭐','🌟','💪','✅','🏆','👏']
  const confetti = Array.from({length:12},(_,i)=>({id:i,emoji:emojis[i%emojis.length],x:Math.random()*100,delay:Math.random()*0.5}))
  useEffect(()=>{ const t=setTimeout(onClose,2500); return ()=>clearTimeout(t) },[])
  return (
    <div className="celebration-overlay" onClick={onClose}>
      {confetti.map(c=><div key={c.id} className="confetti-piece" style={{left:c.x+'%',bottom:'20%',animationDelay:c.delay+'s'}}>{c.emoji}</div>)}
      <div className="celebration-card"><span className="celebration-emoji">🎉</span><div className="celebration-title">Task Complete!</div><div className="celebration-sub">Great work! 💪</div></div>
    </div>
  )
}

const TaskCard = ({ task, onClick }) => {
  const dur = fmtDuration(task.started_at, task.completed_at)
  return (
    <div className={"task-card "+task.priority} onClick={onClick}>
      <div className="tc-top">
        <div style={{flex:1}}>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:5}}>
            <span className="cat-tag">{CAT_ICONS[task.category]||'📋'} {task.category}</span>
            {task.recurrence&&task.recurrence!=='once'&&<span className="recurrence-tag">🔁 {RECURRENCE_LABELS[task.recurrence]}</span>}
          </div>
          <div className="tc-title">{task.title}</div>
        </div>
        <StatusBadge status={task.status} />
      </div>
      <div className="tc-meta">
        <PriBadge priority={task.priority} />
        <span style={{fontSize:11,color:'var(--t2)'}}>📅 {task.due_date}</span>
        {task.assigned_user_name&&<span style={{fontSize:11,color:'var(--t2)'}}>👤 {task.assigned_user_name}</span>}
        {task.evidence?.length>0&&<span style={{fontSize:11,color:'var(--t2)'}}>📷 {task.evidence.length}</span>}
        {task.compliance&&<span className="badge" style={{background:'rgba(139,92,246,.1)',color:'#8B5CF6'}}>🔒</span>}
        {dur&&<span style={{fontSize:11,color:'var(--t2)'}}>⏱ {dur}</span>}
        {task.gps_start&&<a href={"https://www.google.com/maps?q="+task.gps_start} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:'var(--blue)',textDecoration:'none'}} onClick={e=>e.stopPropagation()}>📍 GPS ↗</a>}
      </div>

      {task.escalation&&<div className="esc-flag">⚠️ Escalated</div>}
    </div>
  )
}

function AuthView({ onAuth }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [org, setOrg] = useState('')
  const [signupType, setSignupType] = useState('organisation') // 'organisation' or 'staff'
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [orgChoices, setOrgChoices] = useState(null) // [{org, role, tier, name}] for org picker
  const [showPw, setShowPw] = useState(false)
  const [pendingAuthUser, setPendingAuthUser] = useState(null) // auth user waiting for org pick
  const [inviteToken, setInviteToken] = useState(null) // invite token from URL
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Check for invite/recovery token in URL on mount
  useEffect(()=>{
    const hash = window.location.hash
    const params = new URLSearchParams(hash.replace('#','?').replace('#','&'))
    const accessToken = params.get('access_token')
    const type = params.get('type')
    if (accessToken && (type==='invite' || type==='recovery')) {
      window.__taksyn_invite_flow = true
      setInviteToken(accessToken)
      // Clear hash from URL
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  const handleSubmit = async () => {
    setError(''); setSuccess('')
    if (!email||!password) { setError('Please fill in all fields'); return }
    setLoading(true)
    try {
      if (!isConfigured()) {
        onAuth({ id:email, email, name:name||email.split('@')[0], role:'worker', tier:'Growth', org:'My Organisation' })
        return
      }
      if (mode==='register') {
        if (signupType==='organisation' && !org.trim()) { setError('Please enter your organisation name'); setLoading(false); return }
        if (!name.trim()) { setError('Please enter your full name'); setLoading(false); return }
        const orgName = signupType==='organisation' ? org.trim() : inviteCode.trim()
        const assignedRole = signupType==='organisation' ? 'client_admin' : 'worker'
        const { data:signUpData, error:e } = await supabase.auth.signUp({
          email, password,
          options:{ data:{ name:name.trim(), role:assignedRole, org:orgName } }
        })
        if (e) throw e
        // Create profile immediately
        if (signUpData?.user) {
          await supabase.from('profiles').upsert({
            id: signUpData.user.id,
            name: name.trim(),
            role: assignedRole,
            org: orgName,
            tier: 'Growth'
          })
          // Create org_members entry
          await supabase.from('org_members').upsert({
            user_id: signUpData.user.id,
            org: orgName,
            role: assignedRole,
            tier: 'Growth'
          })
        }
        setSuccess(signupType==='organisation'
          ? 'Account created! Check your email to confirm, then sign in as your org admin.'
          : 'Account created! Check your email to confirm, then sign in.')
        setMode('login'); setLoading(false)
      } else {
        const { createClient } = await import('@supabase/supabase-js')
        const freshClient = createClient(
          import.meta.env.VITE_SUPABASE_URL,
          import.meta.env.VITE_SUPABASE_ANON_KEY,
          { auth: { persistSession: false, autoRefreshToken: false } }
        )
        // Race login against 10s timeout
        const loginResult = await Promise.race([
          freshClient.auth.signInWithPassword({ email, password }),
          new Promise((_,reject) => setTimeout(()=>reject(new Error('Login timed out. Please try again.')), 10000))
        ])
        const { data, error:e } = loginResult
        if (e) throw e
        if (data?.user) {
          const { data:profile } = await freshClient.from('profiles').select('*').eq('id',data.user.id).single()
          if (profile) {
            // Check org_members for multiple org memberships
            const { data:memberships } = await freshClient.from('org_members').select('*').eq('user_id',data.user.id)
            if (memberships && memberships.length > 1) {
              // Multiple orgs — show picker
              setPendingAuthUser({...profile, email:data.user.email})
              setOrgChoices(memberships)
              setLoading(false)
              return
            } else if (memberships && memberships.length === 1) {
              // Single org from org_members — use that role/org
              const m = memberships[0]
              const userData = {...profile, email:data.user.email, role:m.role, org:m.org, tier:m.tier||'Growth'}
              localStorage.setItem('taksyn-user', JSON.stringify(userData))
              onAuth(userData)
            } else {
              // No org_members entry — use profile directly (legacy/super_admin)
              const userData = {...profile, email:data.user.email}
              localStorage.setItem('taksyn-user', JSON.stringify(userData))
              onAuth(userData)
            }
          } else {
            const userData = { id:data.user.id, email:data.user.email, name:data.user.email.split('@')[0], role:'worker', tier:'Growth', org:'My Organisation' }
            localStorage.setItem('taksyn-user', JSON.stringify(userData))
            onAuth(userData)
          }
        }
      }
    } catch(e) {
      setError(e.message||'Sign in failed. Please try again.')
      setLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    if (!email) { setError('Enter your email address first'); return }
    setLoading(true); setError('')
    try {
      const { error:e } = await supabase.auth.resetPasswordForEmail(email, { redirectTo:'https://taksyn.vercel.app' })
      if (e) throw e
      setSuccess('Password reset email sent! Check your inbox.')
    } catch(e) { setError(e.message||'Failed to send reset email') }
    finally { setLoading(false) }
  }

  // Invite / password setup screen
  if (inviteToken) {
    return (
      <div className="auth-bg">
        <style>{CSS}</style>
        <div className="auth-card">
          <div className="auth-logo"><img src="/logo.jpeg" alt="Taksyn" style={{height:48,objectFit:'contain'}} /></div>
          <div className="auth-title">Set Your Password</div>
          <div className="auth-sub">Welcome to Taksyn! Please set a password to activate your account.</div>
          {error&&<div className="auth-error">{error}</div>}
          {success&&<div style={{background:'rgba(16,185,129,.08)',border:'1px solid rgba(16,185,129,.2)',borderRadius:8,padding:'10px 14px',fontSize:13,color:'var(--green)',marginBottom:12}}>{success}</div>}
          <div className="auth-field">
            <label className="auth-label">New Password</label>
            <div style={{position:'relative'}}><input className="auth-input" type={showPw1?'text':'password'} placeholder="Min 6 characters" value={newPassword} onChange={e=>setNewPassword(e.target.value)} style={{paddingRight:36}}/><button type="button" onClick={()=>setShowPw1(!showPw1)} style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'var(--t2)',fontSize:16,lineHeight:1,padding:2}}>{showPw1?'👁':'🔒'}</button></div>
          </div>
          <div className="auth-field">
            <label className="auth-label">Confirm Password</label>
            <input className="auth-input" type="password" placeholder="Repeat password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/>
          </div>
          <button className="auth-btn" disabled={loading||!newPassword||newPassword!==confirmPassword} onClick={async()=>{
            if (newPassword.length < 6) { setError('Password must be at least 6 characters'); return }
            if (newPassword !== confirmPassword) { setError('Passwords do not match'); return }
            setLoading(true); setError('')
            try {
              // Set session from invite token first
              const { error: sessionError } = await supabase.auth.setSession({
                access_token: inviteToken,
                refresh_token: inviteToken
              })
              if (sessionError) throw sessionError
              // Update password
              const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
              if (updateError) throw updateError
              // Get profile and sign in
              const { data: { user } } = await supabase.auth.getUser()
              if (user) {
                const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
                if (profile) {
                  const userData = {...profile, email: user.email}
                  localStorage.setItem('taksyn-user', JSON.stringify(userData))
                  onAuth(userData)
                }
              }
            } catch(e) {
              setError(e.message||'Failed to set password')
              setLoading(false)
            }
          }}>
            {loading ? 'Setting up...' : 'Activate Account'}
          </button>
          {newPassword && confirmPassword && newPassword !== confirmPassword && (
            <div style={{fontSize:11,color:'var(--red)',marginTop:4,textAlign:'center'}}>Passwords do not match</div>
          )}
        </div>
      </div>
    )
  }

  // Org picker screen
  if (orgChoices && pendingAuthUser) {
    return (
      <div className="auth-bg">
        <style>{CSS}</style>
        <div className="auth-card">
          <div className="auth-logo"><img src="/logo.jpeg" alt="Taksyn" style={{height:48,objectFit:'contain'}} /></div>
          <div className="auth-title">Select Organisation</div>
          <div className="auth-sub">You are a member of multiple organisations. Choose which one to sign in to.</div>
          <div style={{display:'flex',flexDirection:'column',gap:10,marginTop:16}}>
            {orgChoices.map((m,i)=>(
              <button key={i} onClick={()=>{
                const userData = {...pendingAuthUser, role:m.role, org:m.org, tier:m.tier||'Growth'}
                localStorage.setItem('taksyn-user', JSON.stringify(userData))
                onAuth(userData)
              }} style={{padding:'14px 16px',borderRadius:8,border:'1px solid var(--border)',background:'var(--s3)',cursor:'pointer',textAlign:'left',transition:'all .15s'}}
              onMouseOver={e=>e.currentTarget.style.borderColor='var(--brand)'}
              onMouseOut={e=>e.currentTarget.style.borderColor='var(--border)'}>
                <div style={{fontWeight:700,fontSize:14}}>{m.org}</div>
                <div style={{fontSize:12,color:'var(--t2)',marginTop:3}}>{ROLE_LABELS[m.role]||m.role}</div>
              </button>
            ))}
          </div>
          <div style={{textAlign:'center',marginTop:16}}>
            <a style={{fontSize:12,color:'var(--t2)',cursor:'pointer'}} onClick={()=>{setOrgChoices(null);setPendingAuthUser(null)}}>← Back to sign in</a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-bg">
      <style>{CSS}</style>
      <div className="auth-card">
        <div className="auth-logo"><img src="/logo.jpeg" alt="Taksyn" style={{height:48,objectFit:'contain'}} /></div>
        <div className="auth-title">{mode==='login'?'Sign in to your account':mode==='register'?'Create your account':'Reset your password'}</div>
        <div className="auth-sub">Task compliance & accountability platform</div>
        {error&&<div className="auth-error">{error}</div>}
        {success&&<div className="auth-success">{success}</div>}
        {mode==='register'&&(
          <div style={{display:'flex',gap:8,marginBottom:4}}>
            <button
              onClick={()=>setSignupType('organisation')}
              style={{flex:1,padding:'8px',borderRadius:6,border:'2px solid '+(signupType==='organisation'?'var(--brand)':'var(--border)'),background:signupType==='organisation'?'var(--brand-lt)':'none',color:signupType==='organisation'?'var(--brand)':'var(--t2)',cursor:'pointer',fontSize:12,fontWeight:600}}>
              🏢 New Organisation
            </button>
            <button
              onClick={()=>setSignupType('staff')}
              style={{flex:1,padding:'8px',borderRadius:6,border:'2px solid '+(signupType==='staff'?'var(--brand)':'var(--border)'),background:signupType==='staff'?'var(--brand-lt)':'none',color:signupType==='staff'?'var(--brand)':'var(--t2)',cursor:'pointer',fontSize:12,fontWeight:600}}>
              👤 Join Organisation
            </button>
          </div>
        )}
        {mode==='register'&&<div className="auth-field"><label className="auth-label">Full Name</label><input className="auth-input" placeholder="Your full name" value={name} onChange={e=>setName(e.target.value)} /></div>}
        <div className="auth-field"><label className="auth-label">Email</label><input className="auth-input" type="email" placeholder="you@organisation.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleSubmit()} /></div>
        {mode!=='forgot'&&<div className="auth-field"><label className="auth-label">Password</label><div style={{position:'relative'}}><input className="auth-input" type={showPw?'text':'password'} placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleSubmit()} style={{paddingRight:36}}/><button type="button" onClick={()=>setShowPw(!showPw)} style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'var(--t2)',fontSize:16,lineHeight:1,padding:2}}>{showPw?'👁':'🔒'}</button></div></div>}
        {mode==='register'&&signupType==='organisation'&&<div className="auth-field"><label className="auth-label">Organisation Name</label><input className="auth-input" placeholder="e.g. Sunrise Aged Care" value={org} onChange={e=>setOrg(e.target.value)} /></div>}
        {mode==='register'&&signupType==='staff'&&<div className="auth-field"><label className="auth-label">Organisation Name</label><input className="auth-input" placeholder="Enter your exact organisation name" value={inviteCode} onChange={e=>setInviteCode(e.target.value)} /><div style={{fontSize:10,color:'var(--t2)',marginTop:4}}>Must match exactly — ask your admin for the organisation name</div></div>}
        {mode==='register'&&<div style={{fontSize:11,color:'var(--t2)',marginBottom:8,padding:'6px 10px',background:'var(--s3)',borderRadius:6}}>{signupType==='organisation'?'🏢 You will be set up as the Client Admin for your organisation':'👤 You will join as a Worker — your admin can change your role'}</div>}
        {mode==='forgot'
          ? <button className="auth-btn" onClick={handleForgotPassword} disabled={loading}>{loading?'Sending…':'Send Reset Email'}</button>
          : <button className="auth-btn" onClick={handleSubmit} disabled={loading}>{loading?'Please wait…':mode==='login'?'Sign In':'Create Account'}</button>
        }
        <div className="auth-toggle">
          {mode==='login'&&<><a onClick={()=>{setMode('register');setError('');setSuccess('')}}>Create account</a> · <a onClick={()=>{setMode('forgot');setError('');setSuccess('')}}>Forgot password?</a></>}
          {mode==='register'&&<a onClick={()=>{setMode('login');setError('');setSuccess('')}}>Already have an account? Sign in</a>}
          {mode==='forgot'&&<a onClick={()=>{setMode('login');setError('');setSuccess('')}}>Back to sign in</a>}
        </div>
        <div style={{textAlign:'center',marginTop:16}}>
          <span style={{fontSize:11,color:'var(--t3)',cursor:'pointer'}} onClick={()=>{clearAuthCache();location.reload()}}>Having trouble signing in? Tap here to reset</span>
        </div>
      </div>
    </div>
  )
}

function visibleTasks(tasks, user) {
  // Super admin sees all orgs
  if (user.role==='super_admin') return tasks
  // All other roles only see their own org's tasks
  const orgTasks = tasks.filter(t => !t.org || t.org===user.org)
  if (['client_admin','manager','supervisor'].includes(user.role)) return orgTasks
  return orgTasks.filter(t=>
    t.assigned_user_id===user.id ||
    t.assigned_user_name===user.name ||
    (!t.assigned_user_id&&!t.assigned_user_name&&t.assigned_role===user.role)
  )
}

function computeAwards(tasks) {
  const stats = {}
  tasks.filter(t=>['completed','approved'].includes(t.status)&&t.completed_by).forEach(t=>{
    if (!stats[t.completed_by]) stats[t.completed_by]={name:t.completed_by,count:0}
    stats[t.completed_by].count++
  })
  const sorted = Object.values(stats).sort((a,b)=>b.count-a.count)
  return { week:sorted[0]||null, month:sorted[0]||null }
}

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
  const isSA=user.role==='super_admin', isCA=user.role==='client_admin', isMgr=user.role==='manager', isSup=user.role==='supervisor', isWkr=user.role==='worker'
  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-title">{isSA?'Platform Overview':isCA?'Organisation Dashboard':isMgr?'Team Dashboard':isSup?'Supervisor Dashboard':'My Tasks Today'}</div>
        <div className="ph-sub">{isWkr?'Hello '+user.name.split(' ')[0]+' — your tasks for today':user.org+' · '+visible.length+' tasks'}</div>
      </div>
      <div className="stat-grid">
        {(isSA||isCA||isMgr)&&<><Stat label="Total Tasks" val={visible.length} sub={pending+" pending"} icon="📋"/><Stat label="Completion" val={rate+"%"} sub={done+" done"} color="#10B981" bg="rgba(16,185,129,.1)" icon="✅"/><Stat label="Overdue" val={overdue} sub={overdue>0?'Action needed':'On track'} color={overdue>0?'#EF4444':'#10B981'} bg={overdue>0?'rgba(239,68,68,.1)':'rgba(16,185,129,.1)'} icon="⏰"/><Stat label="Escalations" val={esc} sub={esc>0?'Active':'Clear'} color={esc>0?'#EF4444':'#6B7280'} bg="rgba(107,114,128,.1)" icon="🚨"/></>}
        {isSup&&<><Stat label="To Review" val={review} sub="Awaiting approval" color="#F59E0B" bg="rgba(245,158,11,.1)" icon="🔍"/><Stat label="Approved" val={done} sub="Validated" color="#10B981" bg="rgba(16,185,129,.1)" icon="✅"/><Stat label="Escalated" val={esc} sub={esc>0?'Active':'None'} color={esc>0?'#EF4444':'#6B7280'} bg="rgba(107,114,128,.1)" icon="⚠️"/><Stat label="Overdue" val={overdue} sub="Needs attention" color={overdue>0?'#EF4444':'#10B981'} bg={overdue>0?'rgba(239,68,68,.1)':'rgba(16,185,129,.1)'} icon="⏰"/></>}
        {isWkr&&<><Stat label="My Tasks" val={visible.filter(t=>!['awaiting_review','approved','completed'].includes(t.status)).length} sub="remaining to do" icon="📋"/><Stat label="Submitted" val={visible.filter(t=>['awaiting_review','approved','completed'].includes(t.status)).length} sub="done or in review" color="#10B981" bg="rgba(16,185,129,.1)" icon="✅"/><Stat label="Overdue" val={overdue} sub={overdue>0?'Complete soon':'All good'} color={overdue>0?'#EF4444':'#10B981'} bg={overdue>0?'rgba(239,68,68,.1)':'rgba(16,185,129,.1)'} icon="⏰"/><Stat label="Rejected" val={rejected} sub={rejected>0?'Action needed':'All good'} color={rejected>0?'#EF4444':'#6B7280'} bg={rejected>0?'rgba(239,68,68,.1)':'rgba(107,114,128,.1)'} icon="✗"/></>}
      </div>
      {overdue>0&&<div className="esc-banner"><span style={{fontSize:18}}>🚨</span><div className="esc-banner-body"><div className="esc-banner-title">{overdue} task{overdue>1?'s':''} overdue</div><div className="esc-banner-sub">Immediate action required</div></div><button className="btn btn-danger btn-sm" onClick={()=>setPage('escalations')}>View</button></div>}
      {(isSA||isCA||isMgr)&&awards.week&&<div className="section"><div className="section-title">🏆 Staff Recognition</div><div className="award-card"><div className="award-icon">🥇</div><div><div className="award-title">Worker of the Week</div><div className="award-name">{awards.week.name}</div><div className="award-sub">{awards.week.count} tasks completed</div></div></div></div>}
      <div className="two-col">
        <div className="section">
          {(isSA||isCA||isMgr)&&<><div className="section-title">Compliance Score</div><div style={{display:'flex',alignItems:'center',gap:16}}><div className="score-ring"><div className="score-val">{pct(compDone,compT.length)}%</div><div className="score-lbl">Score</div></div><div><div style={{fontSize:13,marginBottom:3}}>{compDone}/{compT.length} compliance tasks done</div><div style={{fontSize:12,color:'var(--t2)'}}>{compT.filter(t=>t.status==='overdue').length} critical overdue</div></div></div></>}
          {isSup&&<><div className="section-title">Pending Evidence</div>{visible.filter(t=>t.status==='awaiting_review').slice(0,3).map(t=><div key={t.id} className="notif-item amber" style={{cursor:'pointer'}} onClick={()=>setPage('evidence')}><div className="notif-title">📷 {t.title}</div><div className="notif-sub">Submitted · {t.due_date}</div></div>)}{review===0&&<div style={{fontSize:13,color:'var(--t2)'}}>No evidence pending ✅</div>}</>}
          {isWkr&&<><div className="section-title">My Progress</div><div style={{display:'flex',alignItems:'center',gap:16}}><div className="score-ring"><div className="score-val">{rate}%</div><div className="score-lbl">Done</div></div><div><div style={{fontSize:13,marginBottom:3}}>{done} of {visible.length} tasks done</div><div style={{fontSize:12,color:'var(--t2)'}}>{overdue} overdue · {pending} pending</div></div></div></>}
        </div>
        <div className="section">
          <div className="section-title">Alerts</div>
          {visible.filter(t=>t.status==='overdue').slice(0,2).map(t=><div key={t.id} className="notif-item urgent"><div className="notif-title">⚠️ {t.title}</div><div className="notif-sub">Overdue since {t.due_date}</div></div>)}
          {!isWkr&&visible.filter(t=>t.status==='awaiting_review').slice(0,1).map(t=><div key={t.id} className="notif-item amber"><div className="notif-title">🔍 {t.title}</div><div className="notif-sub">Awaiting review</div></div>)}
          {overdue===0&&review===0&&esc===0&&<div style={{fontSize:13,color:'var(--t2)'}}>No alerts 🎉</div>}
        </div>
      </div>
      <div style={{marginTop:4}}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:10}}>Active Tasks</div>
        {visible.filter(t=>!['completed','approved'].includes(t.status)).slice(0,5).map(t=><TaskCard key={t.id} task={t} onClick={()=>setPage('tasks')}/>)}
        {visible.filter(t=>!['completed','approved'].includes(t.status)).length===0&&<div className="empty"><div className="empty-icon">🎉</div><div className="empty-text">All tasks complete!</div></div>}
      </div>
    </div>
  )
}

function TasksView({ tasks, setTasks, user, loadTasks, search, pushUndo, setAuditLog }) {
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState(null)
  const [comment, setComment] = useState('')
  const [editingComment, setEditingComment] = useState(null) // {taskId, commentId, text}
  const [interventionModal, setInterventionModal] = useState(null) // {action, label, changes, taskId}
  const [interventionReason, setInterventionReason] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editTask, setEditTask] = useState({})
  const [showReject, setShowReject] = useState(null)
  const [rejectNote, setRejectNote] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteScope, setDeleteScope] = useState('')
  const [celebration, setCelebration] = useState(false)
  const [teamUsers, setTeamUsers] = useState([])
  const [userSearch, setUserSearch] = useState('')
  const [newTask, setNewTask] = useState({ title:'', category:'Housekeeping', priority:'medium', due_date:'', compliance:false, recurrence:'once', assigned_role:'worker', assigned_user_id:'', assigned_user_name:'', assigned_user_email:'' })

  useEffect(()=>{ if(isConfigured()) supabase.from('profiles').select('*').then(({data})=>{ if(data) setTeamUsers(user.role==='super_admin'?data:data.filter(u=>u.org===user.org)) }) },[])

  const visible = visibleTasks(tasks, user)
  const searchFiltered = search ? visible.filter(t=>t.title?.toLowerCase().includes(search.toLowerCase())||t.category?.toLowerCase().includes(search.toLowerCase())||t.assigned_user_name?.toLowerCase().includes(search.toLowerCase())) : visible
  const filtered = filter==='all'?searchFiltered:filter==='escalated'?searchFiltered.filter(t=>t.escalation):searchFiltered.filter(t=>t.status===filter)

  const update = async (id, changes, _interventionReason=null) => {
    // If super admin acting on another org's data, require reason
    if (user?.role==='super_admin' && !_interventionReason) {
      const task = tasks.find(t=>t.id===id)
      const actionLabel = changes.status ? 'Change status to '+changes.status.replace(/_/g,' ') : 'Edit task'
      setInterventionModal({ action: actionLabel, changes, taskId: id })
      setInterventionReason('')
      return
    }
    if (changes.status) {
      const prev = tasks.find(t=>t.id===id)
      const task = tasks.find(t=>t.id===id)
      const entry = {
        id: Date.now()+'',
        taskId: id,
        taskTitle: prev?.title||id,
        fromStatus: prev?.status||'—',
        toStatus: changes.status,
        by: user?.name||'System',
        byRole: user?.role||'',
        org: task?.org||user?.org||'',
        isIntervention: user?.role==='super_admin',
        interventionReason: _interventionReason||null,
        at: new Date().toISOString()
      }
      setAuditLog(log=>[entry,...log])
      if (isConfigured()) {
        await supabase.from('audit_log').insert(entry).then(()=>{})
      }
    }
    const interventionTag = user?.role==='super_admin' ? { lastIntervention: { by: user.name, reason: _interventionReason, at: new Date().toISOString() } } : {}
    setTasks(prev=>prev.map(t=>t.id===id?{...t,...changes,...interventionTag}:t))
    if (isConfigured()) {
      const payload = {...changes}
      if (changes.subtasks) payload.subtasks = JSON.stringify(changes.subtasks)
      if (changes.evidence) payload.evidence = JSON.stringify(changes.evidence)
      if (changes.comments) payload.comments = JSON.stringify(changes.comments)
      await supabase.from('tasks').update(payload).eq('id', id)
    }
  }

  const toggleSub = (tid, idx) => {
    const task = tasks.find(t=>t.id===tid)
    const subs = parseSafe(task.subtasks)
    update(tid, { subtasks: subs.map((s,i)=>i===idx?{...s,done:!s.done}:s) })
  }

  const startTask = (tid) => {
    if (!navigator.geolocation) { alert("GPS is required to start a task but your device does not support location services."); return }
    navigator.geolocation.getCurrentPosition(
      pos => update(tid, { status:"in_progress", started_at:new Date().toISOString(), gps_start:pos.coords.latitude.toFixed(4)+","+pos.coords.longitude.toFixed(4) }),
      () => alert("GPS location is required to start a task. Please enable location permissions and try again.")
    )
  }

  const submitTask = (tid) => {
    const task = tasks.find(t=>t.id===tid)
    const updatedComments = comment.trim() ? [...(task.comments||[]), user.name+': '+comment.trim()] : task.comments||[]
    const doSubmit = (extra={}) => {
      update(tid, { status:'awaiting_review', completed_by:user.name, submitted_at:new Date().toISOString(), comments:updatedComments, ...extra })
      setCelebration(true); setComment(''); setSelected(null)
    }
    if (!navigator.geolocation) { alert("GPS is required to complete a task but your device does not support location services."); return }
    navigator.geolocation.getCurrentPosition(
      pos => doSubmit({ gps_end:pos.coords.latitude.toFixed(4)+","+pos.coords.longitude.toFixed(4) }),
      () => alert("GPS location is required to complete a task. Please enable location permissions and try again.")
    )
  }

  const addComment = (tid) => {
    if (!comment.trim()) return
    const task = tasks.find(t=>t.id===tid)
    const entry = { id: Date.now()+'', author: user.name, authorId: user.id, text: comment.trim(), timestamp: new Date().toISOString(), edits: [] }
    update(tid, { comments:[...(parseSafe(task.comments)||[]), entry] })
    setComment('')
  }

  const createTask = async () => {
    if (!newTask.title.trim()) return
    const t = { id:'T'+Date.now(), ...newTask, status:'pending', subtasks:[], evidence:[], comments:[], escalation:false, created_by:user.name, org:user.org, created_at:new Date().toISOString() }
    if (isConfigured()) {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      const assigned_user_id = authUser?.id ?? null
      const { error } = await supabase.from('tasks').insert({ ...t, subtasks:'[]', evidence:'[]', comments:'[]', assigned_user_id })
      if (error) console.error('Task save error:', error)
    }
    setTasks(prev=>[...prev,t])
    if (loadTasks) { await loadTasks(); await loadAuditLog() }
    setShowCreate(false); setUserSearch('')
    setNewTask({title:'',category:'Housekeeping',priority:'medium',due_date:'',compliance:false,recurrence:'once',assigned_role:'worker',assigned_user_id:'',assigned_user_name:'',assigned_user_email:''})
  }

  const canCreate = hasAccess(user.role, 2)
  const canApprove = hasAccess(user.role, 2)
  const sel = selected ? tasks.find(t=>t.id===selected) : null

  const AssignField = ({ value, onChange, compact=false }) => (
    teamUsers.length > 0 ? (
      <div>
        {!compact&&<input className="form-input" placeholder="Search staff…" value={userSearch} onChange={e=>setUserSearch(e.target.value)} style={{marginBottom:6}}/>}
        <select className="form-select" value={value} onChange={onChange}>
          <option value="">— Select a staff member —</option>
          {teamUsers.filter(u=>!userSearch||u.name?.toLowerCase().includes(userSearch.toLowerCase())).map(u=><option key={u.id} value={u.id}>{u.name} ({ROLE_LABELS[u.role]||u.role})</option>)}
        </select>
      </div>
    ) : (
      <select className="form-select" value={newTask.assigned_role} onChange={e=>setNewTask({...newTask,assigned_role:e.target.value})}>
        {ROLES.filter(r=>r!=='super_admin').map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
      </select>
    )
  )

  return (
    <div className="anim">
      {celebration&&<Celebration onClose={()=>setCelebration(false)}/>}

      {showEdit&&sel&&(
        <div className="modal-overlay" onClick={()=>setShowEdit(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr"><div className="modal-title">Edit Task</div><button className="modal-close" onClick={()=>setShowEdit(false)}>×</button></div>
            <div className="modal-body">
              <div className="form-field"><label className="form-label">Title</label><input className="form-input" value={editTask.title||''} onChange={e=>setEditTask({...editTask,title:e.target.value})}/></div>
              <div className="two-col">
                <div className="form-field"><label className="form-label">Category</label><select className="form-select" value={editTask.category||''} onChange={e=>setEditTask({...editTask,category:e.target.value})}>{Object.keys(CAT_ICONS).map(c=><option key={c}>{c}</option>)}</select></div>
                <div className="form-field"><label className="form-label">Priority</label><select className="form-select" value={editTask.priority||''} onChange={e=>setEditTask({...editTask,priority:e.target.value})}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
              </div>
              <div className="two-col">
                <div className="form-field"><label className="form-label">Due Date</label><input className="form-input" type="date" value={editTask.due_date||''} onChange={e=>setEditTask({...editTask,due_date:e.target.value})}/></div>
                <div className="form-field"><label className="form-label">Schedule</label><select className="form-select" value={editTask.recurrence||'once'} onChange={e=>setEditTask({...editTask,recurrence:e.target.value})}>{RECURRENCE_OPTS.map(r=><option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>)}</select></div>
              </div>
              <div className="form-field">
                <label className="form-label">Assign To</label>
                {teamUsers.length>0 ? (
                  <select className="form-select" value={editTask.assigned_user_id||''} onChange={e=>{ const u=teamUsers.find(u=>u.id===e.target.value); if(u) setEditTask({...editTask,assigned_user_id:u.id,assigned_user_name:u.name,assigned_role:u.role}) }}>
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
                <input type="checkbox" id="edit-comp" checked={editTask.compliance||false} onChange={e=>setEditTask({...editTask,compliance:e.target.checked})} style={{width:16,height:16,accentColor:'var(--brand)',cursor:'pointer'}}/>
                <label htmlFor="edit-comp" style={{fontSize:13,cursor:'pointer'}}>Compliance-critical task</label>
              </div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className="btn btn-secondary" onClick={()=>setShowEdit(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={()=>{ update(sel.id,editTask); setShowEdit(false) }}>Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showReject&&(
        <div className="modal-overlay" onClick={()=>{setShowReject(null);setRejectNote('')}}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr"><div className="modal-title">Reject Task</div><button className="modal-close" onClick={()=>{setShowReject(null);setRejectNote('')}}>×</button></div>
            <div className="modal-body">
              <div style={{fontSize:13,color:'var(--t2)',marginBottom:14}}>The task will be sent back as <span style={{color:'var(--red)',fontWeight:600}}>Rejected</span> with your instructions.</div>
              <div className="form-field"><label className="form-label">Instructions for Worker</label><textarea className="comment-box" style={{minHeight:80}} placeholder="e.g. Please re-clean the bathroom…" value={rejectNote} onChange={e=>setRejectNote(e.target.value)}/></div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className="btn btn-secondary" onClick={()=>{setShowReject(null);setRejectNote('')}}>Cancel</button>
                <button className="btn btn-danger" disabled={!rejectNote.trim()} onClick={()=>{
                  const task=tasks.find(t=>t.id===showReject)
                  const rejectEntry = { id: Date.now()+'', author: user.name, authorId: user.id, text: '⚠️ Rejected: '+rejectNote.trim(), timestamp: new Date().toISOString(), edits: [], isRejection: true }
                  const existingComments = Array.isArray(task.comments) ? task.comments : parseSafe(task.comments,[])
                  update(showReject,{status:'rejected',reviewed_at:new Date().toISOString(),comments:[...existingComments, rejectEntry]})
                  setShowReject(null); setRejectNote('')
                }}>Reject Task</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {interventionModal&&(
        <div className="modal-overlay" onClick={()=>{setInterventionModal(null);setInterventionReason('')}}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{borderTop:'4px solid #F59E0B'}}>
            <div className="modal-hdr">
              <div className="modal-title" style={{color:'#F59E0B'}}>🔧 Platform Admin Intervention</div>
              <button className="modal-close" onClick={()=>{setInterventionModal(null);setInterventionReason('')}}>×</button>
            </div>
            <div className="modal-body">
              <div style={{background:'rgba(245,158,11,.08)',border:'1px solid rgba(245,158,11,.25)',borderRadius:8,padding:12,marginBottom:14,fontSize:12,color:'var(--text)'}}>
                <div style={{fontWeight:700,marginBottom:4}}>⚠️ You are about to modify an organisation data</div>
                <div style={{color:'var(--t2)'}}>Action: <strong>{interventionModal?.action}</strong></div>
                <div style={{color:'var(--t2)',marginTop:4}}>This will be permanently recorded in the audit log as a Platform Admin Intervention and will be visible to the organisation.</div>
              </div>
              <div className="form-field">
                <label className="form-label">Reason for Intervention <span style={{color:'var(--red)'}}>*</span></label>
                <textarea className="comment-box" style={{minHeight:80}} placeholder="e.g. Fixing incorrect status after system error reported by client…" value={interventionReason} onChange={e=>setInterventionReason(e.target.value)}/>
              </div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
                <button className="btn btn-secondary" onClick={()=>{setInterventionModal(null);setInterventionReason('')}}>Cancel</button>
                <button className="btn btn-amber" disabled={!interventionReason.trim()} onClick={()=>{
                  const {taskId, changes} = interventionModal
                  update(taskId, changes, interventionReason.trim())
                  setInterventionModal(null); setInterventionReason('')
                }}>🔧 Confirm Intervention</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCreate&&(
        <div className="modal-overlay" onClick={()=>setShowCreate(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr"><div className="modal-title">Create New Task</div><button className="modal-close" onClick={()=>setShowCreate(false)}>×</button></div>
            <div className="modal-body">
              <div className="form-field"><label className="form-label">Task Title</label><input className="form-input" value={newTask.title} onChange={e=>setNewTask({...newTask,title:e.target.value})} placeholder="e.g. Daily Safety Inspection"/></div>
              <div className="two-col">
                <div className="form-field"><label className="form-label">Category</label><select className="form-select" value={newTask.category} onChange={e=>setNewTask({...newTask,category:e.target.value})}>{Object.keys(CAT_ICONS).map(c=><option key={c}>{c}</option>)}</select></div>
                <div className="form-field"><label className="form-label">Priority</label><select className="form-select" value={newTask.priority} onChange={e=>setNewTask({...newTask,priority:e.target.value})}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
              </div>
              <div className="two-col">
                <div className="form-field"><label className="form-label">Due Date</label><input className="form-input" type="date" value={newTask.due_date} onChange={e=>setNewTask({...newTask,due_date:e.target.value})}/></div>
                <div className="form-field"><label className="form-label">Schedule</label><select className="form-select" value={newTask.recurrence} onChange={e=>setNewTask({...newTask,recurrence:e.target.value})}>{RECURRENCE_OPTS.map(r=><option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>)}</select></div>
              </div>
              <div className="form-field">
                <label className="form-label">Assign To</label>
                {teamUsers.length>0 ? (
                  <div>
                    <input className="form-input" placeholder="Search staff by name…" value={userSearch} onChange={e=>setUserSearch(e.target.value)} style={{marginBottom:6}}/>
                    <select className="form-select" value={newTask.assigned_user_id} onChange={e=>{ const u=teamUsers.find(u=>u.id===e.target.value); if(u) setNewTask({...newTask,assigned_user_id:u.id,assigned_user_name:u.name,assigned_user_email:u.email||'',assigned_role:u.role}); else setNewTask({...newTask,assigned_user_id:'',assigned_user_name:'',assigned_user_email:''}) }}>
                      <option value="">— Select a staff member —</option>
                      {teamUsers.filter(u=>!userSearch||u.name?.toLowerCase().includes(userSearch.toLowerCase())).map(u=><option key={u.id} value={u.id}>{u.name} ({ROLE_LABELS[u.role]||u.role})</option>)}
                    </select>
                    {newTask.assigned_user_name&&<div style={{fontSize:11,color:'var(--brand)',marginTop:4,fontWeight:600}}>✓ Assigned to: {newTask.assigned_user_name}</div>}
                  </div>
                ) : (
                  <select className="form-select" value={newTask.assigned_role} onChange={e=>setNewTask({...newTask,assigned_role:e.target.value})}>
                    {ROLES.filter(r=>r!=='super_admin').map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                )}
              </div>
              {newTask.recurrence!=='once'&&<div style={{background:'rgba(0,168,126,.08)',border:'1px solid rgba(0,168,126,.2)',borderRadius:8,padding:10,marginBottom:12,fontSize:12,color:'var(--brand)'}}>🔁 This task will repeat {RECURRENCE_LABELS[newTask.recurrence].toLowerCase()}</div>}
              <div className="form-field" style={{display:'flex',alignItems:'center',gap:10}}>
                <input type="checkbox" id="comp" checked={newTask.compliance} onChange={e=>setNewTask({...newTask,compliance:e.target.checked})} style={{width:16,height:16,accentColor:'var(--brand)',cursor:'pointer'}}/>
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
          <button className="back-btn" onClick={()=>{setSelected(null);setShowDeleteConfirm(false);setDeleteScope('')}}><IC n="x" s={14}/> Close</button>
          <div className="detail-header">
            <div style={{flex:1}}>
              <div style={{display:'flex',gap:6,marginBottom:6,flexWrap:'wrap'}}>
                <span className="cat-tag">{CAT_ICONS[sel.category]||'📋'} {sel.category}</span>
                {sel.recurrence&&sel.recurrence!=='once'&&<span className="recurrence-tag">🔁 {RECURRENCE_LABELS[sel.recurrence]}</span>}
              </div>
              <div style={{fontSize:17,fontWeight:800,letterSpacing:'-.5px'}}>{sel.title}</div>
              <div style={{fontSize:11,color:'var(--t2)',marginTop:3}}>{sel.id} · Due {sel.due_date}{sel.created_by&&' · Created by '+sel.created_by}</div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:5,alignItems:'flex-end'}}><StatusBadge status={sel.status}/><PriBadge priority={sel.priority}/></div>
          </div>

          <div className="timing-bar">
            <div className={"timing-chip "+(sel.started_at?'active':'')}>⏱ Time In: {sel.started_at?fmtTime(sel.started_at):'—'}</div>
            <div className={"timing-chip "+(sel.completed_at?'active':'')}>⏹ Time Out: {sel.completed_at?fmtTime(sel.completed_at):'—'}</div>
            {fmtDuration(sel.started_at,sel.completed_at)&&<div className="timing-chip active">⏱ Duration: {fmtDuration(sel.started_at,sel.completed_at)}</div>}
            {sel.gps_start&&<span className="gps-chip" onClick={()=>{ window.location.href='https://maps.google.com/?q='+sel.gps_start }}>📍 Start: {sel.gps_start}</span>}
            {sel.gps_end&&<span className="gps-chip" style={{background:'rgba(16,185,129,.08)',borderColor:'rgba(16,185,129,.2)',color:'var(--green)'}} onClick={()=>{ window.location.href='https://maps.google.com/?q='+sel.gps_end }}>📍 End: {sel.gps_end}</span>}
          </div>

          {sel.status==='rejected'&&(
            <div style={{background:'rgba(239,68,68,.06)',border:'1px solid rgba(239,68,68,.25)',borderRadius:10,padding:14,marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:700,color:'var(--red)',marginBottom:6}}>⚠️ Task Sent Back — Action Required</div>
              {parseSafe(sel.comments,[]).filter(c=>{ const txt=typeof c==='object'?c.text:c; return txt?.startsWith('⚠️') }).slice(-1).map((c,i)=>{ const txt=typeof c==='object'?c.text:c; return <div key={i} style={{fontSize:13,color:'var(--text)',background:'rgba(239,68,68,.04)',borderRadius:6,padding:'8px 10px',lineHeight:1.5}}>{txt.replace('⚠️ ','').split(': ').slice(1).join(': ')}</div> })}
              <div style={{fontSize:11,color:'var(--t2)',marginTop:8}}>Please complete the required changes and resubmit.</div>
            </div>
          )}

          {sel.escalation&&<div className="esc-banner"><span style={{fontSize:18}}>🚨</span><div className="esc-banner-body"><div className="esc-banner-title">Task escalated — supervisor notified</div><div className="esc-banner-sub">Immediate attention required</div></div></div>}
          {sel.lastIntervention&&<div style={{background:'rgba(245,158,11,.08)',border:'1px solid rgba(245,158,11,.3)',borderRadius:8,padding:'10px 14px',marginBottom:12,display:'flex',gap:10,alignItems:'flex-start'}}>
            <span style={{fontSize:16}}>🔧</span>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:'#F59E0B'}}>Platform Admin Intervention</div>
              <div style={{fontSize:11,color:'var(--t2)',marginTop:2}}>Modified by {sel.lastIntervention.by} on {new Date(sel.lastIntervention.at).toLocaleString('en-AU',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
              <div style={{fontSize:11,color:'var(--text)',marginTop:3}}>Reason: {sel.lastIntervention.reason}</div>
            </div>
          </div>}

          <div className="section">
            <div className="section-title">Evidence / Photo Proof {parseSafe(sel.evidence).length>0?'('+parseSafe(sel.evidence).length+'/5)':''}</div>
            {parseSafe(sel.evidence).length>0&&<div className="ev-thumbs" style={{marginBottom:10}}>
              {parseSafe(sel.evidence).map((e,i)=>(
                <div key={i} className="ev-thumb">
                  {e.startsWith('data:image')||e.startsWith('http') ? <img src={e} alt="evidence" style={{width:'100%',height:'100%',objectFit:'cover'}}/> : <span style={{fontSize:18}}>📷</span>}
                  {user.role==='worker'&&<div className="ev-rm" onClick={()=>update(sel.id,{evidence:parseSafe(sel.evidence).filter((_,j)=>j!==i)})}>×</div>}
                </div>
              ))}
            </div>}
            {user.role==='worker'&&parseSafe(sel.evidence).length<5&&(
              <div>
                <div style={{display:'flex',gap:8,marginBottom:10}}>
                  <button className="btn btn-secondary" style={{flex:1}} onClick={()=>document.getElementById('cam-inp').click()}>📷 Take Photo</button>
                  <button className="btn btn-secondary" style={{flex:1}} onClick={()=>document.getElementById('gal-inp').click()}>🖼 Gallery</button>
                </div>
                <input id="cam-inp" type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={async e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=async ev=>{ await update(sel.id,{evidence:[...parseSafe(sel.evidence),ev.target.result]}) }; r.readAsDataURL(f); e.target.value='' }}/>
                <input id="gal-inp" type="file" accept="image/*" style={{display:'none'}} onChange={async e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=async ev=>{ await update(sel.id,{evidence:[...parseSafe(sel.evidence),ev.target.result]}) }; r.readAsDataURL(f); e.target.value='' }}/>
                {parseSafe(sel.evidence).length===0&&<div className="evidence-zone" onClick={()=>document.getElementById('cam-inp').click()}><div style={{fontSize:24,marginBottom:5}}>📷</div><div style={{fontSize:13,color:'var(--t2)'}}>Tap to add photo (max 5)</div></div>}
              </div>
            )}
            {user.role!=='worker'&&!parseSafe(sel.evidence).length&&<div style={{fontSize:13,color:'var(--t2)'}}>No evidence uploaded yet</div>}
          </div>

          <div className="section">
            {/*Comments*/}
            <div className="section-title">Comments & Notes</div>
            {parseSafe(sel.comments,[]).map((c,i)=>{
              const isObj = c && typeof c==='object'
              const cStr = (!isObj && c != null) ? String(c) : ''
              const author = isObj ? c.author : (cStr.split(':')[0]||'')
              const text = isObj ? c.text : cStr.split(':').slice(1).join(':').trim()
              const ts = isObj ? c.timestamp : null
              const edits = isObj ? (c.edits||[]) : []
              const isAmendment = isObj && c.isAmendment
              const isOwn = isObj ? c.authorId===user.id : author===user.name
              const tsDate = ts ? new Date(ts) : null
              const isToday = tsDate ? tsDate.toDateString()===new Date().toDateString() : false
              const fmtTs = (d) => new Date(d).toLocaleString('en-AU',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})
              const commentId = isObj ? c.id : i+''
              const isEditing = editingComment && editingComment.taskId===sel.id && editingComment.commentId===commentId
              return (
                <div key={i} className="comment-item" style={{borderLeft: isAmendment?'3px solid #6366F1':isObj&&c.isRejection?'3px solid var(--red)':'3px solid var(--border)',paddingLeft:10,marginBottom:8,background:'var(--s3)',borderRadius:6,padding:'8px 10px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                    <div style={{flex:1}}>
                      <span style={{fontWeight:700,fontSize:12,color:isAmendment?'#6366F1':isObj&&c.isRejection?'var(--red)':'var(--brand)'}}>{isAmendment?'✏️ Amendment':isObj&&c.isRejection?'⚠️ Rejection':'💬'} {author}</span>
                      {tsDate&&<span style={{fontSize:10,color:'var(--t2)',marginLeft:8}}>{fmtTs(ts)}</span>}
                    </div>
                    {isOwn&&!isEditing&&(
                      <div style={{display:'flex',gap:4,flexShrink:0}}>
                        <button style={{fontSize:10,padding:'2px 7px',borderRadius:4,border:'1px solid var(--border)',background:'none',cursor:'pointer',color:'var(--t2)'}}
                          onClick={()=>setEditingComment({taskId:sel.id,commentId,text})}>✏️</button>
                        {isToday&&<button style={{fontSize:10,padding:'2px 7px',borderRadius:4,border:'1px solid rgba(239,68,68,.3)',background:'none',cursor:'pointer',color:'var(--red)'}}
                          onClick={()=>{
                            const updated=parseSafe(sel.comments,[]).filter((_,j)=>j!==i)
                            update(sel.id,{comments:updated})
                          }}>🗑</button>}
                      </div>
                    )}
                  </div>
                  {isEditing ? (
                    <div style={{marginTop:6}}>
                      <textarea style={{width:'100%',padding:'6px 8px',borderRadius:6,border:'1px solid var(--border)',background:'var(--s2)',color:'var(--text)',fontSize:12,resize:'vertical',minHeight:56,fontFamily:'inherit',boxSizing:'border-box'}}
                        value={editingComment.text} onChange={e=>setEditingComment({...editingComment,text:e.target.value})}/>
                      <div style={{display:'flex',gap:6,marginTop:6}}>
                        <button className="btn btn-primary btn-sm" onClick={()=>{
                          const all=parseSafe(sel.comments,[])
                          const updated=all.map((cm,j)=>{
                            if(j!==i) return cm
                            const orig=typeof cm==='object'?cm:{id:i+'',author:cm.split(':')[0],authorId:user.id,text:cm.split(':').slice(1).join(':').trim(),timestamp:new Date().toISOString(),edits:[]}
                            return {...orig, edits:[...(orig.edits||[]),{text:orig.text,editedAt:new Date().toISOString()}], text:editingComment.text}
                          })
                          update(sel.id,{comments:updated})
                          setEditingComment(null)
                        }}>Save</button>
                        <button className="btn btn-secondary btn-sm" onClick={()=>setEditingComment(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{marginTop:4,fontSize:13}}>{text}</div>
                  )}
                  {edits.length>0&&<div style={{marginTop:6,paddingTop:6,borderTop:'1px dashed var(--border)'}}>
                    {edits.map((ed,ei)=>(
                      <div key={ei} style={{fontSize:11,color:'var(--t2)',marginBottom:2}}>
                        <span style={{color:'#F59E0B'}}>📝 Original{edits.length>1?' v'+(ei+1):''}:</span> {ed.text} <span style={{fontSize:10}}>({fmtTs(ed.editedAt)})</span>
                      </div>
                    ))}
                  </div>}
                </div>
              )
            })}
            <textarea className="comment-box" style={{marginTop:10}} placeholder="Add a note…" value={comment} onChange={e=>setComment(e.target.value)} onBlur={()=>{ if(comment.trim()) addComment(sel.id) }}/>
          </div>

          <div className="section">
            <div className="section-title">Details</div>
            <div className="two-col">
              <div style={{fontSize:13}}><span style={{color:'var(--t2)'}}>Due:</span> {sel.due_date}</div>
              <div style={{fontSize:13}}><span style={{color:'var(--t2)'}}>Compliance:</span> {sel.compliance?'🔒 Yes':'—'}</div>
              <div style={{fontSize:13}}><span style={{color:'var(--t2)'}}>Assigned to:</span> {sel.assigned_user_name||ROLE_LABELS[sel.assigned_role]}</div>
              <div style={{fontSize:13}}><span style={{color:'var(--t2)'}}>Schedule:</span> {RECURRENCE_LABELS[sel.recurrence||'once']}</div>
            </div>
          </div>

          {user.role==='worker'&&(
            <div style={{background:'var(--s3)',border:'1px solid var(--border)',borderRadius:10,padding:14,marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>Task Timer</div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:10}}>
                {!sel.started_at ? (
                  <button className="btn btn-green" style={{flex:1}} onClick={()=>startTask(sel.id)}>▶ Time In</button>
                ) : (
                  <div style={{flex:1,background:'rgba(16,185,129,.1)',border:'1px solid rgba(16,185,129,.25)',borderRadius:6,padding:'8px 12px',fontSize:12,color:'var(--green)',fontWeight:600,textAlign:'center'}}>✓ Time In: {fmtTime(sel.started_at)}</div>
                )}
                {sel.started_at&&!sel.completed_at ? (
                  <button className="btn btn-amber" style={{flex:1}} onClick={()=>{ if(!navigator.geolocation){alert("GPS is required but your device does not support location services.");return} navigator.geolocation.getCurrentPosition(pos=>update(sel.id,{completed_at:new Date().toISOString(),gps_end:pos.coords.latitude.toFixed(4)+","+pos.coords.longitude.toFixed(4)}),()=>alert("GPS location is required to complete a task. Please enable location permissions and try again.")) }}>⏹ Time Out</button>
                ) : sel.completed_at ? (
                  <div style={{flex:1,background:'rgba(245,158,11,.1)',border:'1px solid rgba(245,158,11,.25)',borderRadius:6,padding:'8px 12px',fontSize:12,color:'var(--amber)',fontWeight:600,textAlign:'center'}}>✓ Time Out: {fmtTime(sel.completed_at)}</div>
                ) : null}
              </div>
              {sel.started_at&&sel.completed_at&&<div style={{fontSize:12,color:'var(--t2)',marginBottom:10,textAlign:'center'}}>⏱ Duration: <span style={{fontWeight:700,color:'var(--brand)'}}>{fmtDuration(sel.started_at,sel.completed_at)}</span></div>}
              {sel.started_at&&sel.completed_at&&!['awaiting_review','approved'].includes(sel.status)&&<button className="btn btn-primary" style={{width:'100%'}} onClick={()=>submitTask(sel.id)}>✅ Submit Task for Review</button>}
              {sel.status==='awaiting_review'&&<div style={{background:'rgba(245,158,11,.1)',border:'1px solid rgba(245,158,11,.25)',borderRadius:6,padding:'8px 12px',fontSize:12,color:'var(--amber)',fontWeight:600,textAlign:'center'}}>📋 Submitted — awaiting supervisor review</div>}
              {sel.status==='awaiting_review'&&user.role==='worker'&&<button className="btn btn-primary" style={{width:'100%',marginTop:8,background:'#6366F1',borderColor:'#6366F1'}} onClick={()=>update(sel.id,{submitted_at:new Date().toISOString()})}>🔄 Resubmit for Supervisor Review</button>}
              {sel.status==='awaiting_review'&&user.role==='worker'&&(
                <AmendmentPanel sel={sel} user={user} update={update} parseSafe={parseSafe} />
              )}
              {sel.status==='approved'&&<div style={{background:'rgba(16,185,129,.1)',border:'1px solid rgba(16,185,129,.25)',borderRadius:6,padding:'8px 12px',fontSize:12,color:'var(--green)',fontWeight:600,textAlign:'center'}}>✅ Task approved by supervisor</div>}
            </div>
          )}

          <div className="btn-row">
            {canApprove&&sel.status!=='approved'&&user.role!=='super_admin'&&<button className="btn btn-secondary" onClick={()=>{setEditTask({...sel,subtasks:parseSafe(sel.subtasks)});setShowEdit(true)}}>✏️ Edit Task</button>}}
            {canApprove&&['awaiting_review','rejected'].includes(sel.status)&&<><button className="btn btn-primary" onClick={()=>update(sel.id,{status:'approved',reviewed_at:new Date().toISOString()})}>✅ Approve</button><button className="btn btn-danger" onClick={()=>setShowReject(sel.id)}>✗ Reject</button></>}
            {canApprove&&!sel.escalation&&!['completed','approved'].includes(sel.status)&&<button className="btn btn-amber" onClick={()=>update(sel.id,{escalation:true,status:'escalated'})}>⚠️ Escalate</button>}
            {canApprove&&sel.escalation&&<button className="btn btn-secondary" onClick={()=>update(sel.id,{escalation:false,status:'in_progress'})}>Resolve Escalation</button>}
            {canApprove&&(
              <div style={{marginLeft:'auto'}}>
                {!showDeleteConfirm ? (
                  <button className="btn btn-danger btn-sm" onClick={()=>setShowDeleteConfirm(true)}>🗑 Delete</button>
                ) : (
                  <div style={{background:'rgba(239,68,68,.06)',border:'1px solid rgba(239,68,68,.25)',borderRadius:8,padding:12,minWidth:220}}>
                    <div style={{fontSize:12,fontWeight:700,color:'var(--red)',marginBottom:10}}>Delete this task?</div>
                    <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12}}>
                      {[['this','This task only'],['future','This and all future']].map(([v,l])=>(
                        <label key={v} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12}}>
                          <input type="radio" name="deleteScope" value={v} checked={deleteScope===v} onChange={()=>setDeleteScope(v)} style={{accentColor:'var(--red)'}}/>
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
              {canCreate&&(user.role==='super_admin' ? <div style={{fontSize:11,color:'#F59E0B',padding:'6px 10px',background:'rgba(245,158,11,.08)',borderRadius:6,border:'1px solid rgba(245,158,11,.2)'}}>🔧 View only — use intervention to edit</div> : <button className="btn btn-primary" onClick={()=>setShowCreate(true)}><IC n="plus" s={13}/> New Task</button>)}}
            </div>
          </div>
          <div className="filter-bar">
            {['all','pending','in_progress','awaiting_review','rejected','completed','overdue','escalated'].map(f=>(
              <button key={f} className={"fb "+(filter===f?'active':'')} onClick={()=>setFilter(f)}>
                {f==='all'?'All':(STATUS_CFG[f]?.label||f)} <span style={{opacity:.6}}>({f==='all'?visible.length:f==='escalated'?visible.filter(t=>t.escalation).length:visible.filter(t=>t.status===f).length})</span>
              </button>
            ))}
          </div>
          {filtered.length===0
            ? <div className="empty"><div className="empty-icon">✅</div><div className="empty-text">No tasks here</div></div>
            : filtered.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)
          }
        </>
      )}
    </div>
  )
}

function EscalationsView({ tasks, setTasks, user }) {
  const esc = tasks.filter(t=>t.escalation||t.status==='overdue'||t.status==='escalated')
  const resolve = async (id) => {
    setTasks(prev=>prev.map(t=>t.id===id?{...t,escalation:false,status:'in_progress'}:t))
    if(isConfigured()) await supabase.from('tasks').update({escalation:false,status:'in_progress'}).eq('id',id)
  }
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
                <div style={{fontSize:11,color:'var(--t2)',marginTop:3}}>Due: {t.due_date} · {t.assigned_user_name||ROLE_LABELS[t.assigned_role]}</div>
                <div style={{marginTop:7}}><PriBadge priority={t.priority}/></div>
              </div>
              <span className="badge" style={{background:'rgba(239,68,68,.1)',color:'var(--red)',flexShrink:0}}>🚨 {t.status==='overdue'?'Overdue':'Escalated'}</span>
            </div>
            {hasAccess(user.role,2)&&<div style={{marginTop:10}}><button className="btn btn-secondary btn-sm" onClick={()=>resolve(t.id)}>Mark Acknowledged</button></div>}
          </div>
        ))
      }
    </div>
  )
}

function EvidenceView({ tasks, setTasks, user }) {
  const relevant = tasks.filter(t=>t.evidence?.length>0||t.status==='awaiting_review')
  const approve = async (id) => { setTasks(prev=>prev.map(t=>t.id===id?{...t,status:'approved',reviewed_at:new Date().toISOString()}:t)); if(isConfigured()) await supabase.from('tasks').update({status:'approved',reviewed_at:new Date().toISOString()}).eq('id',id) }
  const reject = async (id) => { setTasks(prev=>prev.map(t=>t.id===id?{...t,status:'rejected',reviewed_at:new Date().toISOString()}:t)); if(isConfigured()) await supabase.from('tasks').update({status:'rejected',reviewed_at:new Date().toISOString()}).eq('id',id) }
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
                <div style={{fontSize:11,color:'var(--t2)',marginTop:3}}>{t.assigned_user_name||ROLE_LABELS[t.assigned_role]} · {t.due_date}</div>
                {fmtDuration(t.started_at,t.completed_at)&&<div style={{fontSize:11,color:'var(--t2)',marginTop:3}}>⏱ Duration: {fmtDuration(t.started_at,t.completed_at)}</div>}
                <div style={{display:'flex',gap:5,marginTop:7,flexWrap:'wrap'}}><StatusBadge status={t.status}/>{t.compliance&&<span className="badge" style={{background:'rgba(139,92,246,.1)',color:'#8B5CF6'}}>🔒 Compliance</span>}</div>
              </div>
              <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                {parseSafe(t.evidence).length>0 ? parseSafe(t.evidence).map((e,i)=>(
                  <div key={i} className="ev-thumb" style={{width:48,height:48}}>
                    {e.startsWith('data:image')||e.startsWith('http') ? <img src={e} alt="evidence" style={{width:'100%',height:'100%',objectFit:'cover'}}/> : <span style={{fontSize:16}}>📷</span>}
                  </div>
                )) : <span style={{fontSize:11,color:'var(--t2)'}}>No photos</span>}
              </div>
            </div>
            {hasAccess(user.role,2)&&t.status==='awaiting_review'&&(
              <div style={{display:'flex',gap:7,marginTop:10}}>
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

function AmendmentPanel({ sel, user, update, parseSafe }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [hasAmendment, setHasAmendment] = useState(false)

  const fmtTs = (d) => new Date(d).toLocaleString('en-AU',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})

  const saveAmendment = () => {
    if (!note.trim()) return
    const entry = { id: Date.now()+'', author: user.name, authorId: user.id, text: note.trim(), timestamp: new Date().toISOString(), edits: [], isAmendment: true }
    update(sel.id, { comments: [...(parseSafe(sel.comments)||[]), entry] })
    setNote('')
    setHasAmendment(true)
  }

  const resubmit = () => {
    if (note.trim()) saveAmendment()
    update(sel.id, { status: 'awaiting_review', submitted_at: new Date().toISOString() })
    setOpen(false)
    setHasAmendment(false)
  }

  return (
    <div style={{marginTop:10}}>
      {!open ? (
        <button className="btn btn-secondary" style={{width:'100%',fontSize:13,borderColor:'#6366F1',color:'#6366F1'}} onClick={()=>setOpen(true)}>
          ✏️ Add Amendment
        </button>
      ) : (
        <div style={{background:'rgba(99,102,241,.08)',border:'1px solid rgba(99,102,241,.25)',borderRadius:8,padding:12}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <div style={{fontSize:11,fontWeight:700,color:'#6366F1',textTransform:'uppercase',letterSpacing:'.8px'}}>✏️ Amendment</div>
            <button style={{background:'none',border:'none',cursor:'pointer',color:'var(--t2)',fontSize:16,lineHeight:1}} onClick={()=>setOpen(false)}>×</button>
          </div>
          <div style={{fontSize:11,color:'var(--t2)',marginBottom:10}}>Each amendment is date & time stamped and cannot be edited once saved. Use Resubmit to notify your supervisor.</div>
          <textarea
            placeholder="Describe your amendment..."
            value={note}
            onChange={e=>setNote(e.target.value)}
            style={{width:'100%',padding:'8px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--s2)',color:'var(--text)',fontSize:12,resize:'vertical',minHeight:72,fontFamily:'inherit',boxSizing:'border-box'}}
          />
          <div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap'}}>
            <button className="btn btn-secondary" style={{flex:1,fontSize:12,minWidth:120}} onClick={()=>document.getElementById('amend-img-'+sel.id).click()}>
              📎 Attach Photo
            </button>
            <button className="btn btn-secondary" style={{flex:1,fontSize:12,minWidth:120}} onClick={saveAmendment} disabled={!note.trim()}>
              💾 Save Amendment
            </button>

          </div>
          {hasAmendment&&<div style={{marginTop:8,fontSize:11,color:'var(--green)',fontWeight:600}}>✓ Amendment saved — press Resubmit to notify supervisor</div>}
          <input id={'amend-img-'+sel.id} type="file" accept="image/*" style={{display:'none'}} onChange={async e=>{
            const f=e.target.files[0]; if(!f) return
            const r=new FileReader()
            r.onload=async ev=>{
              const curr=parseSafe(sel.evidence)
              if(curr.length>=5){ alert('Maximum 5 images reached'); return }
              await update(sel.id,{evidence:[...curr,ev.target.result]})
              const photoEntry={ id: Date.now()+'', author: user.name, authorId: user.id, text:'📎 Amendment photo attached', timestamp: new Date().toISOString(), edits:[], isAmendment:true }
              update(sel.id,{comments:[...(parseSafe(sel.comments)||[]),photoEntry]})
              setHasAmendment(true)
            }
            r.readAsDataURL(f); e.target.value=''
          }}/>
        </div>
      )}
    </div>
  )
}


function ReportsView({ tasks, user }) {
  const [reportType, setReportType] = useState('compliance')
  const [period, setPeriod] = useState('weekly')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [chartTab, setChartTab] = useState('overview')

  const isClientAdmin = ['client_admin','super_admin'].includes(user.role)
  const isSupervisorUp = ['supervisor','manager','client_admin','super_admin'].includes(user.role)

  const reportOptions = [
    ...(isSupervisorUp ? [{ value:'compliance', label:'📋 Compliance Report' }] : []),
    ...(isClientAdmin ? [
      { value:'worker', label:'👷 Worker Performance Report' },
      { value:'org', label:'🏢 Organisation Overview Report' },
    ] : []),
  ]

  const getRange = () => {
    const now = new Date(), end = new Date(now)
    if (period==='weekly') { const s=new Date(now); s.setDate(s.getDate()-6); return [s,end] }
    if (period==='monthly') { const s=new Date(now); s.setDate(s.getDate()-29); return [s,end] }
    if (period==='quarterly') { const s=new Date(now); s.setDate(s.getDate()-89); return [s,end] }
    if (period==='annual') { const s=new Date(now); s.setDate(s.getDate()-364); return [s,end] }
    if (period==='custom' && customStart && customEnd) return [new Date(customStart), new Date(customEnd)]
    return [new Date(0), end]
  }
  const [rs,re] = getRange()
  const pt = tasks.filter(t => { const d = new Date(t.created_at||t.due_date||0); return d>=rs && d<=re })

  // --- Shared stats helpers ---
  const pct = (a,b) => b>0 ? Math.round((a/b)*100) : 0
  const fmtDur = (s,e) => { if(!s||!e) return '—'; const m=Math.round((new Date(e)-new Date(s))/60000); return m<60?m+'m':Math.floor(m/60)+'h '+(m%60)+'m' }
  const pl = {weekly:'Last 7 Days',monthly:'Last Month',quarterly:'Last 3 Months',annual:'Last Year',custom:customStart+' to '+customEnd}[period]

  // --- Compliance report stats ---
  const total=pt.length, done=pt.filter(t=>['completed','approved'].includes(t.status)).length
  const approved=pt.filter(t=>t.status==='approved').length, rejected=pt.filter(t=>t.status==='rejected').length
  const overdue=pt.filter(t=>t.status==='overdue').length
  const notOnTime=pt.filter(t=>t.due_date&&t.completed_at&&new Date(t.completed_at)>new Date(t.due_date)).length
  const compT=pt.filter(t=>t.compliance), compDone=compT.filter(t=>['completed','approved'].includes(t.status)).length
  const pendingReview=pt.filter(t=>t.status==='awaiting_review').length
  const reviewed=pt.filter(t=>['approved','rejected'].includes(t.status)).length
  const totalToReview=pt.filter(t=>['awaiting_review','approved','rejected'].includes(t.status)).length
  const reviewedInTime=pt.filter(t=>t.reviewed_at&&t.submitted_at&&(new Date(t.reviewed_at)-new Date(t.submitted_at))<=86400000).length
  const reviewedInTimePct=pct(reviewedInTime,totalToReview)
  const doneOnDay=pt.filter(t=>t.due_date&&t.completed_at&&new Date(t.completed_at).toDateString()===new Date(t.due_date).toDateString()).length
  const tasksDueToday=pt.filter(t=>t.due_date).length
  const doneOnDayPct=pct(doneOnDay,tasksDueToday)
  const reviewWithin1Day=pt.filter(t=>t.reviewed_at&&t.submitted_at&&(new Date(t.reviewed_at)-new Date(t.submitted_at))<=86400000).length
  const reviewWithin1DayPct=pct(reviewWithin1Day,totalToReview)
  const reportWithinWeek=pt.filter(t=>t.reviewed_at&&t.created_at&&(new Date(t.reviewed_at)-new Date(t.created_at))<=604800000).length
  const reportWithinWeekPct=pct(reportWithinWeek,pt.length)

  // --- Worker performance stats ---
  const workerRoles = ['worker','supervisor','manager']
  const workerMap = {}
  pt.forEach(t => {
    const key = t.assigned_user_name || t.assigned_user_id || 'Unassigned'
    const role = t.assigned_role || 'worker'
    if (!workerMap[key]) workerMap[key] = { name:key, role, total:0, done:0, onTime:0, reviewedInTime:0, toReview:0, avgMins:[] }
    workerMap[key].total++
    if (['completed','approved'].includes(t.status)) {
      workerMap[key].done++
      if (t.due_date && t.completed_at && new Date(t.completed_at) <= new Date(t.due_date)) workerMap[key].onTime++
      if (t.started_at && t.completed_at) workerMap[key].avgMins.push((new Date(t.completed_at)-new Date(t.started_at))/60000)
    }
    if (['awaiting_review','approved','rejected'].includes(t.status)) workerMap[key].toReview++
    if (t.reviewed_at && t.submitted_at && (new Date(t.reviewed_at)-new Date(t.submitted_at))<=86400000) workerMap[key].reviewedInTime++
  })
  const workerRows = Object.values(workerMap).sort((a,b) => b.total-a.total)

  // --- Org overview stats ---
  const uniqueWorkers = new Set(pt.map(t=>t.assigned_user_id||t.assigned_user_name).filter(Boolean))
  const byRole = {}
  workerRoles.forEach(r => {
    const roleTasks = pt.filter(t=>t.assigned_role===r)
    const compRoleTasks = roleTasks.filter(t=>t.compliance)
    byRole[r] = {
      tasks: roleTasks.length,
      done: roleTasks.filter(t=>['completed','approved'].includes(t.status)).length,
      compRate: pct(compRoleTasks.filter(t=>['completed','approved'].includes(t.status)).length, compRoleTasks.length),
    }
  })

  const baseStyle = `*{box-sizing:border-box}body{font-family:Helvetica Neue,sans-serif;padding:40px;color:#1a2033;font-size:13px}.hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:16px;border-bottom:2px solid #2D3180}.lt{font-size:24px;font-weight:800;color:#2D3180}.ri{text-align:right;font-size:11px;color:#5a6478}.ri strong{display:block;font-size:14px;color:#1a2033;margin-bottom:2px}.sg{display:grid;gap:12px;margin-bottom:24px}.st{background:#f4f6f9;border-radius:8px;padding:14px;text-align:center}.sv{font-size:22px;font-weight:800;color:#5BC8C0;line-height:1}.sv.r{color:#EF4444}.sv.g{color:#10B981}.sv.a{color:#F59E0B}.sl{font-size:10px;color:#5a6478;margin-top:5px;text-transform:uppercase}table{width:100%;border-collapse:collapse;font-size:11px}th{text-align:left;padding:7px 8px;background:#f4f6f9;font-size:9px;text-transform:uppercase;color:#5a6478;border-bottom:1px solid #e8ebf0}td{padding:7px 8px;border-bottom:1px solid #f0f2f5}.ft{margin-top:28px;padding-top:14px;border-top:1px solid #e8ebf0;font-size:10px;color:#9aa3b2;display:flex;justify-content:space-between}.sec{margin-bottom:24px}.sec-title{font-size:13px;font-weight:700;color:#2D3180;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #e8ebf0}`

  const reportHeader = (title) => `<div class="hdr"><div><img src="https://taksyn.vercel.app/logo.jpeg" height="40" style="object-fit:contain"/></div><div class="ri"><strong>${title}</strong>${user.org}<br/>Period: ${pl}<br/>Generated: ${new Date().toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'})}</div></div>`
  const reportFooter = `<div class="ft"><span>Taksyn — Task Compliance & Accountability Platform</span><span>taksyn.vercel.app</span></div>`

  const openReport = (html) => {
    const w = window.open('','_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(()=>w.print(),800) }
    else { const a=document.createElement('a'); a.href='data:text/html;charset=utf-8,'+encodeURIComponent(html); a.download='taksyn-report.html'; a.click() }
  }

  const exportCompliancePDF = () => {
    const rows = pt.map(t=>'<tr><td>'+t.id+'</td><td><strong>'+t.title+'</strong></td><td>'+t.category+'</td><td style="color:'+(t.status==='approved'?'#10B981':t.status==='rejected'?'#EF4444':'#1a2033')+'">'+t.status.replace('_',' ').toUpperCase()+'</td><td>'+(t.compliance?'✓ Yes':'—')+'</td><td>'+(t.due_date||'—')+'</td><td>'+(t.completed_at?new Date(t.completed_at).toLocaleDateString():'—')+'</td><td>'+(fmtDur(t.started_at,t.completed_at))+'</td><td>'+(t.assigned_user_name||ROLE_LABELS[t.assigned_role]||'—')+'</td></tr>').join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Taksyn Compliance Report</title><style>${baseStyle}.sg{grid-template-columns:repeat(5,1fr)}</style></head><body>${reportHeader('Compliance Report')}<div class="sg"><div class="st"><div class="sv" style="color:#3B82F6">${total}</div><div class="sl">Total Tasks</div></div><div class="st"><div class="sv g">${done}</div><div class="sl">Completed</div></div><div class="st"><div class="sv a">${total-done}</div><div class="sl">Not Completed</div></div><div class="st"><div class="sv r">${overdue}</div><div class="sl">Overdue</div></div><div class="st"><div class="sv" style="color:#8B5CF6">${pct(compDone,compT.length)}%</div><div class="sl">Compliance Rate</div></div><div class="st"><div class="sv" style="color:#3B82F6">${totalToReview}</div><div class="sl">Total for Review</div></div><div class="st"><div class="sv g">${reviewed}</div><div class="sl">Reviewed</div></div><div class="st"><div class="sv a">${pendingReview}</div><div class="sl">Pending Reviews</div></div><div class="st"><div class="sv" style="color:#8B5CF6">${reviewedInTimePct}%</div><div class="sl">Reviewed in Time</div></div><div class="st"><div class="sv g">${doneOnDayPct}%</div><div class="sl">Tasks Done Same Day</div></div><div class="st"><div class="sv g">${reportWithinWeekPct}%</div><div class="sl">Report Reviewed in Time</div></div></div><table><thead><tr><th>ID</th><th>Task</th><th>Category</th><th>Status</th><th>Compliance</th><th>Due Date</th><th>Completed</th><th>Duration</th><th>Assigned To</th></tr></thead><tbody>${rows}</tbody></table>${reportFooter}</body></html>`
    openReport(html)
  }

  const exportWorkerPDF = () => {
    const rows = workerRows.map(w => {
      const compPct = pct(w.done,w.total)
      const onTimePct = pct(w.onTime,w.done)
      const avg = w.avgMins.length ? Math.round(w.avgMins.reduce((a,b)=>a+b,0)/w.avgMins.length) : 0
      const avgStr = avg<60?avg+'m':Math.floor(avg/60)+'h '+(avg%60)+'m'
      return '<tr><td><strong>'+w.name+'</strong></td><td>'+ROLE_LABELS[w.role]+'</td><td>'+w.total+'</td><td>'+w.done+'</td><td style="color:'+(compPct>=80?'#10B981':compPct>=50?'#F59E0B':'#EF4444')+'">'+compPct+'%</td><td>'+onTimePct+'%</td><td>'+avgStr+'</td><td>'+w.reviewedInTime+'</td></tr>'
    }).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Taksyn Worker Performance</title><style>${baseStyle}.sg{grid-template-columns:repeat(4,1fr)}</style></head><body>${reportHeader('Worker Performance Report')}<div class="sg"><div class="st"><div class="sv">${uniqueWorkers.size}</div><div class="sl">Total Workers</div></div><div class="st"><div class="sv">${pt.length}</div><div class="sl">Total Tasks</div></div><div class="st"><div class="sv g">${done}</div><div class="sl">Completed</div></div><div class="st"><div class="sv" style="color:#8B5CF6">${pct(compDone,compT.length)}%</div><div class="sl">Overall Compliance</div></div></div><table><thead><tr><th>Name</th><th>Role</th><th>Assigned</th><th>Completed</th><th>Completion Rate</th><th>On Time %</th><th>Avg Duration</th><th>Reviews in 24h</th></tr></thead><tbody>${rows}</tbody></table>${reportFooter}</body></html>`
    openReport(html)
  }

  const exportOrgPDF = () => {
    const roleRows = workerRoles.map(r => '<tr><td><strong>'+ROLE_LABELS[r]+'</strong></td><td>'+byRole[r].tasks+'</td><td>'+byRole[r].done+'</td><td style="color:'+(pct(byRole[r].done,byRole[r].tasks)>=80?'#10B981':pct(byRole[r].done,byRole[r].tasks)>=50?'#F59E0B':'#EF4444')+'">'+pct(byRole[r].done,byRole[r].tasks)+'%</td><td style="color:'+(byRole[r].compRate>=80?'#10B981':byRole[r].compRate>=50?'#F59E0B':'#EF4444')+'">'+byRole[r].compRate+'%</td></tr>').join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Taksyn Organisation Overview</title><style>${baseStyle}.sg{grid-template-columns:repeat(4,1fr)}</style></head><body>${reportHeader('Organisation Overview Report')}<div class="sg"><div class="st"><div class="sv">${uniqueWorkers.size}</div><div class="sl">Active Workers</div></div><div class="st"><div class="sv">${pt.length}</div><div class="sl">Total Tasks</div></div><div class="st"><div class="sv g">${done}</div><div class="sl">Tasks Completed</div></div><div class="st"><div class="sv" style="color:#8B5CF6">${pct(compDone,compT.length)}%</div><div class="sl">Overall Compliance</div></div></div><div class="sec"><div class="sec-title">Compliance Rate by Role</div><table><thead><tr><th>Role</th><th>Tasks Assigned</th><th>Completed</th><th>Completion Rate</th><th>Compliance Rate</th></tr></thead><tbody>${roleRows}</tbody></table></div><div class="sec"><div class="sec-title">All Tasks Summary</div><table><thead><tr><th>ID</th><th>Title</th><th>Assigned To</th><th>Role</th><th>Status</th><th>Due</th><th>Compliance</th></tr></thead><tbody>${pt.map(t=>'<tr><td>'+t.id+'</td><td>'+t.title+'</td><td>'+(t.assigned_user_name||'—')+'</td><td>'+(ROLE_LABELS[t.assigned_role]||'—')+'</td><td>'+t.status.replace('_',' ').toUpperCase()+'</td><td>'+(t.due_date||'—')+'</td><td>'+(t.compliance?'✓':'—')+'</td></tr>').join('')}</tbody></table></div>${reportFooter}</body></html>`
    openReport(html)
  }

  const handleExport = () => {
    if (reportType==='compliance') exportCompliancePDF()
    else if (reportType==='worker') exportWorkerPDF()
    else if (reportType==='org') exportOrgPDF()
  }

  // Summary stats for screen preview
  const tab = reportType
  const last7=Array.from({length:7},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()-6+i); const ds=d.toISOString().split('T')[0]; return { label:d.toLocaleDateString([],{weekday:'short'}), total:tasks.filter(t=>t.completed_at?.startsWith(ds)||t.due_date===ds).length, done:tasks.filter(t=>t.completed_at?.startsWith(ds)&&['completed','approved','awaiting_review'].includes(t.status)).length } })
  const maxBar=Math.max(...last7.map(d=>d.total),1)

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-title">Reports</div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <select
            value={reportType}
            onChange={e=>setReportType(e.target.value)}
            className="form-input"
            style={{fontSize:13,padding:'6px 10px',minWidth:240}}
          >
            {reportOptions.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" onClick={handleExport}>📄 Generate PDF</button>
          <button className="btn btn-secondary btn-sm" onClick={()=>{ const csv='ID,Title,Category,Status,Priority,Compliance,Evidence,Due Date,Completed,Duration,Assigned To\n'+pt.map(t=>[t.id,t.title,t.category,t.status,t.priority,t.compliance,parseSafe(t.evidence).length,t.due_date,t.completed_at||'',fmtDur(t.started_at,t.completed_at)||'',t.assigned_user_name||''].join(',')).join('\n'); const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='taksyn-report.csv';a.click() }}>📥 CSV</button>
        </div>
      </div>

      <div className="section" style={{marginBottom:14}}>
        <div className="section-title">Reporting Period</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:period==='custom'?12:0}}>
          {[['weekly','Weekly'],['monthly','Monthly'],['quarterly','3 Months'],['annual','Annual'],['custom','Custom']].map(([v,l])=>(
            <button key={v} className={'btn btn-sm '+(period===v?'btn-primary':'btn-secondary')} onClick={()=>setPeriod(v)}>{l}</button>
          ))}
        </div>
        {period==='custom'&&<div style={{display:'flex',gap:8,marginTop:8}}><input type="date" className="form-input" style={{fontSize:12}} value={customStart} onChange={e=>setCustomStart(e.target.value)}/><input type="date" className="form-input" style={{fontSize:12}} value={customEnd} onChange={e=>setCustomEnd(e.target.value)}/></div>}
      </div>

      {/* Compliance Report Preview */}
      {reportType==='compliance' && (
        <>
          <div className="section">
            <div className="section-title">Compliance Overview — {pt.length} tasks</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(110px,1fr))',gap:10,marginTop:10}}>
              {[['Total',total,'b'],['Completed',done,'g'],['Not Completed',total-done,'a'],['Overdue',overdue,'r'],['Compliance Rate',pct(compDone,compT.length)+'%','p'],['Total for Review',totalToReview,'b'],['Reviewed',reviewed,'g'],['Pending Reviews',pendingReview,'a'],['Reviewed in Time',reviewedInTimePct+'%','p'],['Tasks Done Same Day',doneOnDayPct+'%','g'],['Report Reviewed in Time',reportWithinWeekPct+'%','g']].map(([l,v,c])=>(
                <div key={l} className="st" style={{background:'var(--s3)',borderRadius:8,padding:12,textAlign:'center'}}>
                  <div style={{fontSize:20,fontWeight:800,color:c==='g'?'var(--green)':c==='r'?'var(--red)':c==='a'?'#F59E0B':c==='p'?'#8B5CF6':c==='b'?'#3B82F6':'#5BC8C0',lineHeight:1}}>{v}</div>
                  <div style={{fontSize:10,color:'var(--t2)',marginTop:4,textTransform:'uppercase'}}>{l}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="section">
            <div className="section-title">Activity — Last 7 Days</div>
            <div style={{display:'flex',gap:4,alignItems:'flex-end',height:80,marginTop:10}}>
              {last7.map((d,i)=>(
                <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
                  <div style={{width:'100%',background:'var(--s3)',borderRadius:3,position:'relative',height:60,display:'flex',alignItems:'flex-end'}}>
                    <div style={{width:'100%',background:'var(--brand)',borderRadius:3,height:(d.total/maxBar*56)+'px',opacity:.3}}/>
                    <div style={{position:'absolute',bottom:0,width:'100%',background:'var(--brand)',borderRadius:3,height:(d.done/maxBar*56)+'px'}}/>
                  </div>
                  <div style={{fontSize:9,color:'var(--t2)'}}>{d.label}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Worker Performance Preview */}
      {reportType==='worker' && isClientAdmin && (
        <div className="section">
          <div className="section-title">Worker Performance — {pl}</div>
          <div style={{overflowX:'auto',marginTop:10}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead>
                <tr style={{background:'var(--s3)'}}>
                  {['Name','Role','Tasks','Done','Rate','On Time %','Avg Duration','Reviews 24h'].map(h=>(
                    <th key={h} style={{padding:'7px 10px',textAlign:'left',fontSize:10,textTransform:'uppercase',color:'var(--t2)',fontWeight:600,whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workerRows.length===0 && <tr><td colSpan={8} style={{padding:20,textAlign:'center',color:'var(--t2)'}}>No worker data for this period</td></tr>}
                {workerRows.map((w,i)=>{
                  const cp=pct(w.done,w.total)
                  const avg=w.avgMins.length?Math.round(w.avgMins.reduce((a,b)=>a+b,0)/w.avgMins.length):0
                  return (
                    <tr key={i} style={{borderBottom:'1px solid var(--border)'}}>
                      <td style={{padding:'8px 10px',fontWeight:600}}>{w.name}</td>
                      <td style={{padding:'8px 10px',color:'var(--t2)',fontSize:11}}>{ROLE_LABELS[w.role]||w.role}</td>
                      <td style={{padding:'8px 10px'}}>{w.total}</td>
                      <td style={{padding:'8px 10px'}}>{w.done}</td>
                      <td style={{padding:'8px 10px',fontWeight:700,color:cp>=80?'var(--green)':cp>=50?'#F59E0B':'var(--red)'}}>{cp}%</td>
                      <td style={{padding:'8px 10px'}}>{pct(w.onTime,w.done)}%</td>
                      <td style={{padding:'8px 10px',color:'var(--t2)'}}>{avg<60?avg+'m':Math.floor(avg/60)+'h '+(avg%60)+'m'}</td>
                      <td style={{padding:'8px 10px'}}>{w.reviewedInTime}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Org Overview Preview */}
      {reportType==='org' && isClientAdmin && (
        <>
          <div className="section">
            <div className="section-title">Organisation Summary — {pl}</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:10,marginTop:10}}>
              {[['Active Workers',uniqueWorkers.size,''],['Total Tasks',pt.length,''],['Completed',done,'g'],['Compliance Rate',pct(compDone,compT.length)+'%','p']].map(([l,v,c])=>(
                <div key={l} className="st" style={{background:'var(--s3)',borderRadius:8,padding:14,textAlign:'center'}}>
                  <div style={{fontSize:22,fontWeight:800,color:c==='g'?'var(--green)':c==='p'?'#8B5CF6':'#5BC8C0',lineHeight:1}}>{v}</div>
                  <div style={{fontSize:10,color:'var(--t2)',marginTop:5,textTransform:'uppercase'}}>{l}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="section">
            <div className="section-title">Compliance Rate by Role</div>
            <div style={{overflowX:'auto',marginTop:10}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead>
                  <tr style={{background:'var(--s3)'}}>
                    {['Role','Tasks Assigned','Completed','Completion Rate','Compliance Rate'].map(h=>(
                      <th key={h} style={{padding:'7px 10px',textAlign:'left',fontSize:10,textTransform:'uppercase',color:'var(--t2)',fontWeight:600}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {workerRoles.map(r=>{
                    const cp=pct(byRole[r].done,byRole[r].tasks)
                    return (
                      <tr key={r} style={{borderBottom:'1px solid var(--border)'}}>
                        <td style={{padding:'8px 10px',fontWeight:600}}>{ROLE_LABELS[r]}</td>
                        <td style={{padding:'8px 10px'}}>{byRole[r].tasks}</td>
                        <td style={{padding:'8px 10px'}}>{byRole[r].done}</td>
                        <td style={{padding:'8px 10px',fontWeight:700,color:cp>=80?'var(--green)':cp>=50?'#F59E0B':'var(--red)'}}>{cp}%</td>
                        <td style={{padding:'8px 10px',fontWeight:700,color:byRole[r].compRate>=80?'var(--green)':byRole[r].compRate>=50?'#F59E0B':'var(--red)'}}>{byRole[r].compRate}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function UsersView({ user }) {
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('worker')
  const [inviteName, setInviteName] = useState('')
  const [inviteMethod, setInviteMethod] = useState('email')
  const [inviteOrg, setInviteOrg] = useState('')
  const [realUsers, setRealUsers] = useState([])

  useEffect(()=>{ if(isConfigured()) supabase.from('profiles').select('*').then(({data})=>{ if(data) setRealUsers(user.role==='super_admin'?data:data.filter(u=>u.org===user.org)) }) },[])

  const deleteUser = async (id) => {
    if (!confirm('Remove this user from your organisation?')) return
    if(isConfigured()) {
      // Remove from org_members for this org only — preserves their account in other orgs
      await supabase.from('org_members').delete().eq('user_id',id).eq('org',user.org)
    }
    setRealUsers(prev=>prev.filter(u=>u.id!==id))
  }

  const addExistingUserToOrg = async (email, role) => {
    if (!isConfigured()) { alert('Supabase not configured'); return }
    const { data:profiles } = await supabase.from('profiles').select('*')
    const profile = profiles?.find(p=>p.email===email||p.id===email)
    if (!profile) { alert('No user found with that email. They need to sign up to Taksyn first.'); return }
    const { data:existing } = await supabase.from('org_members').select('*').eq('user_id',profile.id).eq('org',user.org)
    if (existing?.length) { alert('This user is already in your organisation.'); return }
    await supabase.from('org_members').insert({ user_id:profile.id, org:user.org, role, tier:user.tier||'Growth' })
    setRealUsers(prev=>[...prev,{...profile,role,org:user.org}])
    alert(profile.name+' added to your organisation as '+ROLE_LABELS[role])
  }

  const sendInvite = async () => {
    const targetOrg = user.role==='super_admin' ? inviteOrg.trim() : user.org
    if (user.role==='super_admin' && !targetOrg) { alert('Please enter the organisation name'); return }
    if (!inviteEmail.trim() || !inviteName.trim()) { alert('Please enter name and email'); return }

    if (inviteMethod==='whatsapp') {
      const msg=encodeURIComponent('Hi '+inviteName+'! You have been invited to join Taksyn as '+ROLE_LABELS[inviteRole]+' at '+targetOrg+'.\n\nSign up here: https://taksyn.vercel.app\n\nUse your email: '+inviteEmail+'\n\nOrganisation name to enter: '+targetOrg)
      window.open('https://wa.me/?text='+msg,'_blank')
      setShowInvite(false); setInviteEmail(''); setInviteName(''); setInviteRole('worker'); setInviteOrg('')
      return
    }

    // Email invite via Supabase Edge Function
    if (!isConfigured()) { alert('Supabase not configured'); return }
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || supabase.supabaseUrl
      const res = await fetch(supabaseUrl+'/functions/v1/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), name: inviteName.trim(), role: inviteRole, org: targetOrg, secret: import.meta.env.VITE_INVITE_SECRET || '' })
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error||result.message||'Invite failed ('+res.status+')')
      alert('Invite email sent to '+inviteEmail+'!')
      setShowInvite(false); setInviteEmail(''); setInviteName(''); setInviteRole('worker'); setInviteOrg('')
    } catch(e) {
      alert('Failed to send invite: '+e.message)
    }
  }

  return (
    <div className="anim">
      {showInvite&&(
        <div className="modal-overlay" onClick={()=>setShowInvite(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr"><div className="modal-title">Invite Team Member</div><button className="modal-close" onClick={()=>setShowInvite(false)}>×</button></div>
            <div className="modal-body">
              <div className="form-field"><label className="form-label">Full Name</label><input className="form-input" value={inviteName} onChange={e=>setInviteName(e.target.value)} placeholder="Emma Wilson"/></div>
              <div className="form-field"><label className="form-label">Email Address</label><input className="form-input" type="email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="emma@yourorg.com"/></div>
              <div className="form-field"><label className="form-label">Role</label><select className="form-select" value={inviteRole} onChange={e=>setInviteRole(e.target.value)}>{ROLES.filter(r=>r!=='super_admin').map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></div>
              {user.role==='super_admin'&&<div className="form-field"><label className="form-label">Organisation <span style={{color:'var(--red)'}}>*</span></label><input className="form-input" value={inviteOrg} onChange={e=>setInviteOrg(e.target.value)} placeholder="Exact organisation name"/></div>}
              <div className="form-field">
                <label className="form-label">Send Via</label>
                <div style={{display:'flex',gap:8}}>
                  <button className={"btn btn-sm "+(inviteMethod==='email'?'btn-primary':'btn-secondary')} onClick={()=>setInviteMethod('email')}>📧 Email</button>
                  <button className={"btn btn-sm "+(inviteMethod==='whatsapp'?'btn-primary':'btn-secondary')} onClick={()=>setInviteMethod('whatsapp')}>💬 WhatsApp</button>
                </div>
              </div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className="btn btn-secondary" onClick={()=>setShowInvite(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={sendInvite}>{inviteMethod==='whatsapp'?'💬 Send via WhatsApp':'📧 Send Invite'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="ph"><div className="ph-top"><div><div className="ph-title">Team Members</div><div className="ph-sub">Manage staff access and roles</div></div><button className="btn btn-primary" onClick={()=>setShowInvite(true)}><IC n="plus" s={13}/> Invite</button></div></div>
      <div className="section">
        <div className="section-title">Active Users ({realUsers.length})</div>
        {realUsers.length===0
          ? <div style={{fontSize:13,color:'var(--t2)'}}>No users yet. Invite staff or ask them to sign up at taksyn.vercel.app</div>
          : realUsers.map((u,i)=>(
            <div key={i} className="user-row">
              <Avatar name={u.name} role={u.role} size={34} avatarUrl={u.avatar_url}/>
              <div className="user-info"><div className="user-name">{u.name}</div><div className="user-email">{u.email||u.org||'—'}</div></div>
              <RolePill role={u.role}/>
              <button className="btn btn-danger btn-sm" onClick={()=>deleteUser(u.id)}>Remove</button>
            </div>
          ))
        }
      </div>
      <div className="section">
        <div className="section-title">Invite Options</div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button className="btn btn-primary" onClick={()=>{setInviteMethod('email');setShowInvite(true)}}>📧 Invite via Email</button>
          <button className="btn btn-green" onClick={()=>{setInviteMethod('whatsapp');setShowInvite(true)}}>💬 Invite via WhatsApp</button>
        </div>
      </div>
    </div>
  )
}

function TiersView({ user }) {
  return (
    <div className="anim">
      <div className="ph"><div className="ph-title">Subscription Plans</div><div className="ph-sub">Hybrid pricing — base + per user. Current: <span style={{color:TIERS[user.tier]?.color,fontWeight:700}}>{user.tier}</span></div></div>
      <div className="section" style={{marginBottom:16,background:'var(--brand-lt)',border:'1px solid rgba(0,168,126,.2)'}}>
        <div style={{display:'flex',gap:16,flexWrap:'wrap',alignItems:'center'}}>
          <div style={{flex:1}}><div style={{fontSize:14,fontWeight:700,color:'var(--brand)',marginBottom:4}}>How pricing works</div><div style={{fontSize:13,color:'var(--t2)',lineHeight:1.6}}>Each plan has a <strong>base monthly fee</strong> plus a <strong>per user fee</strong>.</div></div>
          <div style={{background:'#fff',borderRadius:8,padding:'10px 16px',fontSize:12,color:'var(--t2)',textAlign:'center',flexShrink:0}}><div style={{fontSize:11,marginBottom:2}}>Example: Growth plan, 20 users</div><div style={{fontWeight:700,color:'var(--text)',fontSize:14}}>$39 + (20 × $8) = <span style={{color:'var(--brand)'}}>$199/mo</span></div></div>
        </div>
      </div>
      <div className="tier-grid">
        {Object.entries(TIERS).map(([name,tier])=>(
          <div key={name} className={"tier-card "+(user.tier===name?'active':'')} style={{borderColor:user.tier===name?tier.color:'var(--border)'}}>
            <div><div className="tier-name" style={{color:tier.color}}>{name}</div><div style={{fontSize:10,color:'var(--t2)',marginTop:1}}>{tier.users} users</div></div>
            <div style={{background:'var(--s3)',borderRadius:6,padding:'8px 10px'}}><div style={{fontSize:10,color:'var(--t2)',fontWeight:600,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:4}}>Base / month</div><div style={{fontSize:18,fontWeight:800,color:tier.color}}>{tier.base}</div></div>
            <div style={{background:'var(--s3)',borderRadius:6,padding:'8px 10px'}}><div style={{fontSize:10,color:'var(--t2)',fontWeight:600,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:4}}>Per user / month</div><div style={{fontSize:18,fontWeight:800,color:tier.color}}>{tier.perUser}</div></div>
            {user.tier===name&&<span className="badge" style={{background:tier.color+'22',color:tier.color,width:'fit-content'}}>✓ Current Plan</span>}
            <div style={{fontSize:11,color:'var(--t2)',display:'flex',flexDirection:'column',gap:3}}><div>💾 {tier.storage}</div><div>📷 {tier.images}</div><div>🗓 {tier.retention}</div></div>
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

const NAV = {
  super_admin:  [['dashboard','Dashboard','home'],['orgs','Organisations','users'],['tasks','Tasks','tasks'],['escalations','Escalations','alert'],['reports','Reports','chart'],['audit','Audit Log','audit'],['users','Team','users'],['tiers','Plans','tier']],
  client_admin: [['dashboard','Dashboard','home'],['tasks','Tasks','tasks'],['escalations','Escalations','alert'],['reports','Reports','chart'],['audit','Audit Log','audit'],['users','Team','users'],['tiers','Plans','tier']],
  manager:      [['dashboard','Dashboard','home'],['tasks','Tasks','tasks'],['escalations','Escalations','alert'],['reports','Reports','chart'],['audit','Audit Log','audit']],
  supervisor:   [['dashboard','Dashboard','home'],['tasks','Tasks','tasks'],['escalations','Escalations','alert'],['audit','Audit Log','audit']],
  worker:       [['dashboard','Today','home'],['tasks','My Tasks','tasks']],
}

function PasswordSetupView({ onDone }) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPw1, setShowPw1] = useState(false)
  const [showPw2, setShowPw2] = useState(false)

  const handleSetPassword = async () => {
    if (newPassword.length < 6) { setError('Password must be at least 6 characters'); return }
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return }
    setLoading(true); setError('')
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) throw updateError
      onDone()
    } catch(e) {
      setError(e.message || 'Failed to set password')
      setLoading(false)
    }
  }

  return (
    <div className="auth-bg">
      <style>{CSS}</style>
      <div className="auth-card">
        <div className="auth-logo"><img src="/logo.jpeg" alt="Taksyn" style={{height:48,objectFit:'contain'}}/></div>
        <div className="auth-title">Set Your Password</div>
        <div className="auth-sub">Welcome to Taksyn! Please set a password to activate your account.</div>
        {error&&<div className="auth-error">{error}</div>}
        <div className="auth-field">
          <label className="auth-label">New Password</label>
          <div style={{position:'relative'}}><input className="auth-input" type={showPw1?'text':'password'} placeholder="Min 6 characters" value={newPassword} onChange={e=>setNewPassword(e.target.value)} style={{paddingRight:36}}/><button type="button" onClick={()=>setShowPw1(!showPw1)} style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'var(--t2)',fontSize:16,lineHeight:1,padding:2}}>{showPw1?'👁':'🔒'}</button></div>
        </div>
        <div className="auth-field">
          <label className="auth-label">Confirm Password</label>
          <div style={{position:'relative'}}><input className="auth-input" type={showPw2?'text':'password'} placeholder="Repeat password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleSetPassword()} style={{paddingRight:36}}/><button type="button" onClick={()=>setShowPw2(!showPw2)} style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'var(--t2)',fontSize:16,lineHeight:1,padding:2}}>{showPw2?'👁':'🔒'}</button></div>
        </div>
        {newPassword&&confirmPassword&&newPassword!==confirmPassword&&(
          <div style={{fontSize:11,color:'var(--red)',marginBottom:8}}>Passwords do not match</div>
        )}
        <button className="auth-btn" disabled={loading||!newPassword||!confirmPassword||newPassword!==confirmPassword} onClick={handleSetPassword}>
          {loading?'Activating...':'Activate Account'}
        </button>
      </div>
    </div>
  )
}


function OrganisationsView({ user }) {
  const [orgs, setOrgs] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [showInvite, setShowInvite] = useState(null) // org object
  const [loading, setLoading] = useState(false)
  const [newOrg, setNewOrg] = useState({ name:'', industry:'', tier:'Growth', notes:'' })
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [search, setSearch] = useState('')

  const INDUSTRIES = ['Hospitality','Aged Care','Disability Care','Healthcare / Clinic','Wedding & Events','Facilities Management','Other']

  useEffect(()=>{
    if(isConfigured()) loadOrgs()
  },[])

  const loadOrgs = async () => {
    const { data } = await supabase.from('organisations').select('*').order('created_at',{ascending:false})
    if (data) setOrgs(data)
  }

  const createOrg = async () => {
    if (!newOrg.name.trim()) return
    setLoading(true)
    const entry = {
      id: 'ORG'+Date.now(),
      name: newOrg.name.trim(),
      industry: newOrg.industry||'Other',
      tier: newOrg.tier||'Growth',
      notes: newOrg.notes.trim(),
      status: 'active',
      created_at: new Date().toISOString(),
      created_by: user.name
    }
    if (isConfigured()) {
      const { error } = await supabase.from('organisations').insert(entry)
      if (error) { alert('Error: '+error.message); setLoading(false); return }
    }
    setOrgs(prev=>[entry,...prev])
    setShowCreate(false)
    setNewOrg({ name:'', industry:'', tier:'Growth', notes:'' })
    setLoading(false)
  }

  const toggleStatus = async (org) => {
    const newStatus = org.status==='active' ? 'inactive' : 'active'
    if (!confirm((newStatus==='inactive'?'Deactivate':'Reactivate')+' '+org.name+'?')) return
    await supabase.from('organisations').update({status:newStatus}).eq('id',org.id)
    setOrgs(prev=>prev.map(o=>o.id===org.id?{...o,status:newStatus}:o))
  }

  const sendInviteToOrg = async () => {
    if (!inviteEmail.trim()||!inviteName.trim()) { alert('Please enter name and email'); return }
    if (!showInvite) return
    setLoading(true)
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || supabase.supabaseUrl
      const inviteSecret = import.meta.env.VITE_INVITE_SECRET || ''
      const res = await fetch(supabaseUrl+'/functions/v1/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email:inviteEmail.trim(), name:inviteName.trim(), role:'client_admin', org:showInvite.name, secret:inviteSecret })
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error||result.message||'Invite failed ('+res.status+')')
      // Update org user count
      await supabase.from('organisations').update({admin_email:inviteEmail.trim(),admin_name:inviteName.trim()}).eq('id',showInvite.id)
      setOrgs(prev=>prev.map(o=>o.id===showInvite.id?{...o,admin_email:inviteEmail.trim(),admin_name:inviteName.trim()}:o))
      alert('Invite sent to '+inviteEmail+'!')
      setShowInvite(null); setInviteEmail(''); setInviteName('')
    } catch(e) {
      alert('Failed: '+e.message)
    }
    setLoading(false)
  }

  const filtered = orgs.filter(o=>!search||o.name.toLowerCase().includes(search.toLowerCase())||o.industry?.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="anim">
      <div className="ph">
        <div>
          <div className="ph-title">Organisations</div>
          <div className="ph-sub">{orgs.length} organisations · {orgs.filter(o=>o.status==='active').length} active</div>
        </div>
        <button className="btn btn-primary" onClick={()=>setShowCreate(true)}>+ New Organisation</button>
      </div>

      <div className="section" style={{marginBottom:14}}>
        <input className="form-input" placeholder="Search organisations..." value={search} onChange={e=>setSearch(e.target.value)} style={{fontSize:13}}/>
      </div>

      {filtered.length===0 ? (
        <div className="empty">
          <div className="empty-icon">🏢</div>
          <div style={{fontSize:15,fontWeight:700,marginBottom:6}}>No organisations yet</div>
          <div className="empty-text">Create your first organisation to get started.</div>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {filtered.map(org=>(
            <div key={org.id} style={{background:'var(--s2)',border:'1px solid var(--border)',borderRadius:10,padding:16,borderLeft:'4px solid '+(org.status==='active'?'var(--green)':'var(--border)')}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
                <div style={{flex:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                    <div style={{fontWeight:700,fontSize:15}}>{org.name}</div>
                    <span style={{fontSize:10,padding:'2px 8px',borderRadius:10,fontWeight:600,
                      background:org.status==='active'?'rgba(16,185,129,.12)':'var(--s3)',
                      color:org.status==='active'?'var(--green)':'var(--t2)'
                    }}>{org.status?.toUpperCase()}</span>
                    <span style={{fontSize:10,padding:'2px 8px',borderRadius:10,background:'var(--s3)',color:TIERS[org.tier]?.color||'var(--t2)',fontWeight:600}}>{org.tier}</span>
                  </div>
                  <div style={{fontSize:12,color:'var(--t2)',display:'flex',gap:16,flexWrap:'wrap'}}>
                    <span>🏭 {org.industry||'—'}</span>
                    {org.admin_name&&<span>👤 {org.admin_name}</span>}
                    {org.admin_email&&<span>✉️ {org.admin_email}</span>}
                    <span>📅 {new Date(org.created_at).toLocaleDateString('en-AU')}</span>
                  </div>
                  {org.notes&&<div style={{fontSize:11,color:'var(--t2)',marginTop:6,fontStyle:'italic'}}>{org.notes}</div>}
                </div>
                <div style={{display:'flex',gap:6,flexShrink:0}}>
                  <button className="btn btn-primary btn-sm" onClick={()=>{ setShowInvite(org); setInviteEmail(''); setInviteName('') }}>✉️ Invite Admin</button>
                  <button className="btn btn-secondary btn-sm" style={{color:org.status==='active'?'var(--red)':'var(--green)'}} onClick={()=>toggleStatus(org)}>
                    {org.status==='active'?'Deactivate':'Reactivate'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Organisation Modal */}
      {showCreate&&(
        <div className="modal-overlay" onClick={()=>setShowCreate(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr">
              <div className="modal-title">New Organisation</div>
              <button className="modal-close" onClick={()=>setShowCreate(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-field">
                <label className="form-label">Organisation Name <span style={{color:'var(--red)'}}>*</span></label>
                <input className="form-input" placeholder="e.g. Sunrise Aged Care" value={newOrg.name} onChange={e=>setNewOrg({...newOrg,name:e.target.value})}/>
              </div>
              <div className="form-field">
                <label className="form-label">Industry</label>
                <select className="form-input" value={newOrg.industry} onChange={e=>setNewOrg({...newOrg,industry:e.target.value})}>
                  <option value="">Select industry...</option>
                  {INDUSTRIES.map(i=><option key={i} value={i}>{i}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">Plan / Tier</label>
                <select className="form-input" value={newOrg.tier} onChange={e=>setNewOrg({...newOrg,tier:e.target.value})}>
                  {Object.keys(TIERS).map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">Notes</label>
                <textarea className="comment-box" placeholder="Any notes about this organisation..." value={newOrg.notes} onChange={e=>setNewOrg({...newOrg,notes:e.target.value})}/>
              </div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className="btn btn-secondary" onClick={()=>setShowCreate(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={!newOrg.name.trim()||loading} onClick={createOrg}>
                  {loading?'Creating...':'Create Organisation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invite Admin Modal */}
      {showInvite&&(
        <div className="modal-overlay" onClick={()=>setShowInvite(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr">
              <div className="modal-title">Invite Client Admin</div>
              <button className="modal-close" onClick={()=>setShowInvite(null)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{background:'var(--s3)',borderRadius:8,padding:'10px 14px',marginBottom:14,fontSize:13}}>
                <span style={{color:'var(--t2)'}}>Organisation: </span>
                <strong>{showInvite.name}</strong>
              </div>
              <div className="form-field">
                <label className="form-label">Full Name <span style={{color:'var(--red)'}}>*</span></label>
                <input className="form-input" placeholder="Admin full name" value={inviteName} onChange={e=>setInviteName(e.target.value)}/>
              </div>
              <div className="form-field">
                <label className="form-label">Email <span style={{color:'var(--red)'}}>*</span></label>
                <input className="form-input" type="email" placeholder="admin@organisation.com" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)}/>
              </div>
              <div style={{fontSize:11,color:'var(--t2)',marginBottom:14}}>They will receive an email invite and be set up as Client Admin for {showInvite.name}.</div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className="btn btn-secondary" onClick={()=>setShowInvite(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={!inviteEmail.trim()||!inviteName.trim()||loading} onClick={sendInviteToOrg}>
                  {loading?'Sending...':'✉️ Send Invite'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


function AuditLogView({ tasks, user, auditLog }) {
  const [filter, setFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')

  const STATUS_COLORS = {
    pending:'#6B7280', in_progress:'#3B82F6', awaiting_review:'#F59E0B',
    completed:'#10B981', approved:'#10B981', rejected:'#EF4444',
    overdue:'#EF4444', escalated:'#EF4444'
  }

  const fmtTs = (d) => new Date(d).toLocaleString('en-AU',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})

  const filtered = auditLog.filter(e => {
    const matchText = !filter || e.taskTitle?.toLowerCase().includes(filter.toLowerCase()) || e.by?.toLowerCase().includes(filter.toLowerCase())
    const matchRole = roleFilter==='all' || e.byRole===roleFilter
    return matchText && matchRole
  })

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-title">Audit Log</div>
        <div className="ph-sub">{auditLog.length} status changes recorded — read only</div>
      </div>

      <div className="section" style={{marginBottom:14}}>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <input
            className="form-input"
            placeholder="Search task or person..."
            value={filter}
            onChange={e=>setFilter(e.target.value)}
            style={{flex:1,minWidth:180,fontSize:13}}
          />
          <select className="form-input" value={roleFilter} onChange={e=>setRoleFilter(e.target.value)} style={{fontSize:13,padding:'6px 10px'}}>
            <option value="all">All Roles</option>
            {ROLES.map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>
      </div>

      {filtered.length===0 ? (
        <div className="empty"><div className="empty-icon">📋</div><div style={{fontSize:15,fontWeight:700,marginBottom:6}}>No audit entries yet</div><div className="empty-text">Status changes will appear here as tasks are updated.</div></div>
      ) : (
        <div className="section">
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead>
                <tr style={{background:'var(--s3)'}}>
                  {['Date & Time','Task','Changed By','Role','From','To'].map(h=>(
                    <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:10,textTransform:'uppercase',color:'var(--t2)',fontWeight:700,whiteSpace:'nowrap',borderBottom:'2px solid var(--border)'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((e,i)=>(
                  <tr key={e.id||i} style={{borderBottom:'1px solid var(--border)',background:e.isIntervention?'rgba(245,158,11,.06)':i%2===0?'transparent':'var(--s3)',borderLeft:e.isIntervention?'3px solid #F59E0B':'3px solid transparent'}}>
                    <td style={{padding:'9px 12px',color:'var(--t2)',whiteSpace:'nowrap'}}>
                      {fmtTs(e.at)}
                      {e.isIntervention&&<div style={{fontSize:9,color:'#F59E0B',fontWeight:700,marginTop:2}}>🔧 PLATFORM INTERVENTION</div>}
                    </td>
                    <td style={{padding:'9px 12px',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                      <div style={{fontWeight:600}}>{e.taskTitle||e.taskId}</div>
                      {e.interventionReason&&<div style={{fontSize:10,color:'var(--t2)',marginTop:2}}>Reason: {e.interventionReason}</div>}
                    </td>
                    <td style={{padding:'9px 12px'}}>{e.by}</td>
                    <td style={{padding:'9px 12px'}}>
                      <span style={{fontSize:10,padding:'2px 7px',borderRadius:10,background:'var(--s3)',color:ROLE_COLORS[e.byRole]||'var(--t2)',fontWeight:600,textTransform:'uppercase'}}>{ROLE_LABELS[e.byRole]||e.byRole}</span>
                    </td>
                    <td style={{padding:'9px 12px'}}>
                      <span style={{fontSize:11,padding:'2px 8px',borderRadius:10,background:'var(--s3)',color:STATUS_COLORS[e.fromStatus]||'var(--t2)',fontWeight:600}}>{e.fromStatus?.replace(/_/g,' ')}</span>
                    </td>
                    <td style={{padding:'9px 12px'}}>
                      <span style={{fontSize:11,padding:'2px 8px',borderRadius:10,background:STATUS_COLORS[e.toStatus]+'18'||'var(--s3)',color:STATUS_COLORS[e.toStatus]||'var(--t2)',fontWeight:700,border:'1px solid '+(STATUS_COLORS[e.toStatus]||'var(--border)')+'44'}}>{e.toStatus?.replace(/_/g,' ')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{marginTop:10,fontSize:11,color:'var(--t2)',textAlign:'right'}}>Showing {filtered.length} of {auditLog.length} entries · Read only</div>
        </div>
      )}
    </div>
  )
}


export default function App() {
  const [user, setUser] = useState(null)
  const [page, setPage] = useState('dashboard')
  const [tasks, setTasks] = useState(DEMO_TASKS)
  const [search, setSearch] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [profileName, setProfileName] = useState('')
  const [profileMsg, setProfileMsg] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [undoStack, setUndoStack] = useState([])
  const [showUndo, setShowUndo] = useState(false)
  const [auditLog, setAuditLog] = useState([])
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false)
  const undoTimer = useRef(null)

  const pushUndo = (label, prevTasks) => {
    setUndoStack(prev=>[...prev.slice(-9),{tasks:prevTasks,label}])
    setShowUndo(true)
    if(undoTimer.current) clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(()=>setShowUndo(false),5000)
  }
  const doUndo = () => {
    setUndoStack(prev=>{
      if(!prev.length) return prev
      setTasks(prev[prev.length-1].tasks); setShowUndo(false)
      return prev.slice(0,-1)
    })
  }

  const loadAuditLog = async () => {
    if (!isConfigured()) return
    const { data } = await supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(500)
    if (data) setAuditLog(user.role==='super_admin'?data:data.filter(e=>e.org===user.org))
  }

  const loadTasks = async () => {
    if(!isConfigured()) return
    const { data } = await supabase.from('tasks').select('*').order('created_at',{ascending:false})
    if(data) setTasks(data.map(t=>({...t, subtasks:parseSafe(t.subtasks), evidence:parseSafe(t.evidence), comments:parseSafe(t.comments,[])})))
    loadAuditLog()
  }

  useEffect(()=>{
    if(!isConfigured()) return
    const cached = localStorage.getItem('taksyn-user')
    if(cached) { try { setUser(JSON.parse(cached)) } catch(e) { localStorage.removeItem('taksyn-user') } }

    supabase.auth.getSession().then(({data:{session}})=>{
      if(session?.user) {
        supabase.from('profiles').select('*').eq('id',session.user.id).single().then(({data})=>{
          if(data) { const u={...data,email:session.user.email}; setUser(u); localStorage.setItem('taksyn-user',JSON.stringify(u)) }
        }).catch(()=>{})
      } else { localStorage.removeItem('taksyn-user'); setUser(null) }
    }).catch(()=>{})

    const {data:{subscription}} = supabase.auth.onAuthStateChange(async(event, session)=>{
      if(!session) { setUser(null); localStorage.removeItem('taksyn-user') }
      else if(event==='USER_UPDATED') {
        // Password was just set — now log them in properly
        try {
          const {data} = await supabase.from('profiles').select('*').eq('id',session.user.id).single()
          if(data) { const u={...data,email:session.user.email}; setUser(u); localStorage.setItem('taksyn-user',JSON.stringify(u)); setNeedsPasswordSetup(false) }
        } catch(e) {}
      }
      else if(event==='SIGNED_IN') {
        // Check if this is an invite or recovery — block auto sign-in and show password setup
        const isInvite = session.user.app_metadata?.provider==='email' && 
          (session.user.last_sign_in_at === null || 
           session.user.last_sign_in_at === session.user.created_at ||
           !session.user.confirmed_at ||
           window.__taksyn_invite_flow)
        if(isInvite) {
          window.__taksyn_invite_flow = false
          setNeedsPasswordSetup(true)
          return
        }
        try {
          const {data} = await supabase.from('profiles').select('*').eq('id',session.user.id).single()
          if(data) { const u={...data,email:session.user.email}; setUser(u); localStorage.setItem('taksyn-user',JSON.stringify(u)) }
        } catch(e) {}
      }
    })
    return ()=>subscription.unsubscribe()
  },[])

  useEffect(()=>{ if(user&&isConfigured()) loadTasks() },[user])

  const handleAuth = (userData) => { setUser(userData); setPage('dashboard') }

  const logout = () => {
    clearAuthCache()
    setUser(null); setTasks(DEMO_TASKS); setPage('dashboard')
    if(isConfigured()) supabase.auth.signOut().catch(()=>{})
  }

  useEffect(()=>setPage('dashboard'),[user?.role])

  if(needsPasswordSetup) return <PasswordSetupView onDone={()=>setNeedsPasswordSetup(false)}/>
  if(!user) return <AuthView onAuth={handleAuth}/>

  const escalationCount = tasks.filter(t=>t.escalation||t.status==='overdue').length
  const reviewCount = tasks.filter(t=>t.status==='awaiting_review').length
  const rejectedCount = tasks.filter(t=>t.status==='rejected'&&visibleTasks([t],user).length>0).length
  const navItems = NAV[user.role]||NAV.worker
  const pageProps = { tasks, setTasks, user, setPage, loadTasks, search, pushUndo, auditLog, setAuditLog }
  const navigate = (key) => { setPage(key); setSidebarOpen(false) }

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        {showUndo&&undoStack.length>0&&(
          <div className="undo-toast">
            <span>↩ {undoStack[undoStack.length-1]?.label}</span>
            <button className="undo-btn" onClick={doUndo}>Undo</button>
            <span style={{cursor:'pointer',opacity:.6,fontSize:16}} onClick={()=>setShowUndo(false)}>×</span>
          </div>
        )}

        <div className="topbar">
          <button className="tb-menu-btn" onClick={()=>{ if(window.innerWidth<=768) setSidebarOpen(!sidebarOpen); else setSidebarCollapsed(!sidebarCollapsed) }}><IC n="menu" s={18}/></button>
          <img src="/logo.jpeg" alt="Taksyn" className="tb-logo" onClick={()=>navigate('dashboard')}/>
          <div className="tb-sep"/>
          <span className="tb-org">{user.org||'My Organisation'}</span>
          <div className="tb-space"/>
          <div className="tb-search"><IC n="search" s={12}/><input placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
          <button className="tb-icon-btn" onClick={()=>navigate('escalations')}><IC n="bell" s={16}/>{escalationCount>0&&<div className="tb-badge">{escalationCount}</div>}</button>
          <div className="tb-user" onClick={()=>{setShowProfile(true);setProfileName(user.name);setProfileMsg('')}}>
            <Avatar name={user.name} role={user.role} size={26} avatarUrl={user.avatar_url}/>
            <div><div className="tb-user-name">{user.name?.split(' ')[0]}</div><div className="tb-user-role">{ROLE_LABELS[user.role]}</div></div>
          </div>
        </div>

        {showProfile&&(
          <div className="modal-overlay" onClick={()=>setShowProfile(false)}>
            <div className="modal" onClick={e=>e.stopPropagation()}>
              <div className="modal-hdr"><div className="modal-title">My Profile</div><button className="modal-close" onClick={()=>setShowProfile(false)}>×</button></div>
              <div className="modal-body">
                <div style={{display:'flex',alignItems:'center',gap:14,padding:'4px 0 16px',borderBottom:'1px solid var(--border)',marginBottom:16}}>
                  <div style={{position:'relative',flexShrink:0}}>
                    {user.avatar_url ? <img src={user.avatar_url} alt={user.name} style={{width:56,height:56,borderRadius:'50%',objectFit:'cover',border:'2px solid var(--border)'}}/> : <Avatar name={user.name} role={user.role} size={56}/>}
                    <button style={{position:'absolute',bottom:-2,right:-2,width:22,height:22,borderRadius:'50%',background:'var(--brand)',border:'2px solid #fff',color:'#fff',fontSize:11,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}} onClick={()=>document.getElementById('av-inp').click()}>✏️</button>
                    <input id="av-inp" type="file" accept="image/*" style={{display:'none'}} onChange={async e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=async ev=>{ const d=ev.target.result; setUser(prev=>({...prev,avatar_url:d})); if(isConfigured()) await supabase.from('profiles').update({avatar_url:d}).eq('id',user.id); setProfileMsg('✓ Profile photo updated') }; r.readAsDataURL(f); e.target.value='' }}/>
                  </div>
                  <div>
                    <div style={{fontSize:15,fontWeight:700}}>{user.name}</div>
                    <div style={{fontSize:12,color:'var(--t2)',marginTop:2}}>{user.email}</div>
                    <div style={{marginTop:4}}><RolePill role={user.role}/></div>
                  </div>
                </div>
                {profileMsg&&<div style={{background:'rgba(16,185,129,.08)',border:'1px solid rgba(16,185,129,.2)',borderRadius:6,padding:'8px 12px',fontSize:13,color:'var(--green)',marginBottom:14}}>{profileMsg}</div>}
                <div className="form-field"><label className="form-label">Display Name</label><input className="form-input" value={profileName} onChange={e=>setProfileName(e.target.value)}/></div>
                <button className="btn btn-secondary btn-sm" style={{marginBottom:20}} onClick={async()=>{ if(!profileName.trim()) return; if(isConfigured()) await supabase.from('profiles').update({name:profileName.trim()}).eq('id',user.id); setUser(prev=>({...prev,name:profileName.trim()})); setProfileMsg('✓ Name updated') }}>Update Name</button>
                <div style={{borderTop:'1px solid var(--border)',paddingTop:16}}>
                  <div style={{fontSize:12,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:12}}>Reset Password</div>
                  <div className="form-field"><label className="form-label">New Password</label><input className="form-input" type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="Min 6 characters"/></div>
                  <div className="form-field"><label className="form-label">Confirm Password</label><input className="form-input" type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} placeholder="Repeat new password"/></div>
                  <button className="btn btn-secondary btn-sm" style={{marginBottom:20}} disabled={!newPassword||newPassword!==confirmPassword||newPassword.length<6} onClick={async()=>{ if(isConfigured()){ const {error}=await supabase.auth.updateUser({password:newPassword}); if(error) setProfileMsg('❌ '+error.message); else { setProfileMsg('✓ Password updated'); setNewPassword(''); setConfirmPassword('') } } }}>{newPassword&&confirmPassword&&newPassword!==confirmPassword?'⚠️ Passwords do not match':'Update Password'}</button>
                </div>
                <div style={{borderTop:'1px solid var(--border)',paddingTop:16,display:'flex',flexDirection:'column',gap:8}}>
                  <button className="btn btn-secondary" style={{width:'100%'}} onClick={()=>{setShowProfile(false);clearAuthCache();location.reload()}}>🔄 Clear Cache & Reload</button>
                  <button className="btn btn-danger" style={{width:'100%'}} onClick={()=>{setShowProfile(false);logout()}}>Sign Out</button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="main">
          <div className={"sidebar-overlay "+(sidebarOpen?'open':'')} onClick={()=>setSidebarOpen(false)}/>
          <div className={"sidebar "+(sidebarCollapsed?'collapsed ':''+(sidebarOpen?'mobile-open':''))}>
            <div className="sb-section">
              <div className="sb-label">Navigation</div>
              {navItems.map(([key,label,icon])=>(
                <button key={key} className={"nav-item "+(page===key?'active':'')} onClick={()=>navigate(key)} title={label}>
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

          <div className="content">
            {PAGE_ACCESS[page]&&!hasAccess(user.role,PAGE_ACCESS[page]) ? (
              <div className="empty" style={{marginTop:60}}><div className="empty-icon">🔒</div><div style={{fontSize:16,fontWeight:700,marginBottom:8}}>Access Restricted</div><div className="empty-text">Your role ({ROLE_LABELS[user.role]}) does not have access to this section.</div></div>
            ) : (
              <>
                {page==='dashboard'   && <DashboardView   {...pageProps}/>}
                {page==='tasks'       && <TasksView        {...pageProps}/>}
                {page==='evidence'    && hasAccess(user.role,2) && <EvidenceView   {...pageProps}/>}
                {page==='escalations' && hasAccess(user.role,2) && <EscalationsView {...pageProps}/>}
                {page==='reports'     && hasAccess(user.role,3) && <ReportsView    {...pageProps}/>}
                {page==='audit'       && hasAccess(user.role,2) && <AuditLogView   {...pageProps}/>}
                {page==='orgs'        && user.role==='super_admin' && <OrganisationsView {...pageProps}/>}
                {page==='users'       && hasAccess(user.role,4) && <UsersView      {...pageProps}/>}
                {page==='tiers'       && hasAccess(user.role,4) && <TiersView      {...pageProps}/>}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
