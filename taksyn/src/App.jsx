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
const DEPARTMENTS = {
  Hospitality: ['Front of House','Housekeeping','Kitchen','Bar','Restaurant','Concierge','Maintenance','Management','Security','Events','Reservations','Laundry'],
  Clinical: ['Nurse','Doctor','General Practitioner','Reception','Administration','Pharmacy','Allied Health','Pathology','Radiology','Management','Cleaning','Security','IT'],
  NDIS: ['Support Worker','Team Leader','Service Delivery Manager','Coordinator','Finance','Rostering','Administration','Allied Health','Transport','Management','Compliance'],
  Aged_Care: ['Carer','Registered Nurse','Enrolled Nurse','Physiotherapist','Occupational Therapist','Lifestyle','Administration','Kitchen','Cleaning','Management','Rostering','Finance'],
  Wedding_Events: ['Event Coordinator','Catering','Decorations','Photography','AV & Sound','Setup & Bump Out','Florals','Management','Administration'],
  Facilities: ['Cleaning','Grounds','Maintenance','Security','Reception','Management','Administration'],
  Safety: ['Safety Officer','Supervisor','Inspector','Compliance','Management'],
  Maintenance: ['Electrician','Plumber','Carpenter','General Maintenance','Grounds','Management'],
  HR: ['HR Officer','Payroll','Recruitment','Training','Management'],
  General: ['Staff','Supervisor','Management','Administration']
}
const CAT_ICONS = { Hospitality:'🏨', Clinical:'🏥', NDIS:'♿', Aged_Care:'👴', Wedding_Events:'💍', Facilities:'🏢', Safety:'🛡️', Maintenance:'🔧', HR:'👥', General:'📋' }
const LEAVE_TYPES = ['sick_leave','annual_leave','personal_leave','public_holiday']
const LEAVE_LABELS = { sick_leave:'Sick Leave', annual_leave:'Annual Leave', personal_leave:'Personal Leave', public_holiday:'Public Holiday' }
const LEAVE_COLORS = { sick_leave:'#EF4444', annual_leave:'#10B981', personal_leave:'#3B82F6', public_holiday:'#8B5CF6' }

const RECURRENCE_OPTS = ['once','daily','weekdays','weekly','fortnightly','monthly','quarterly','annually']
const RECURRENCE_LABELS = { once:'One-off', daily:'Daily', weekdays:'Weekdays (Mon-Fri)', weekly:'Weekly', fortnightly:'Fortnightly', monthly:'Monthly', quarterly:'Quarterly', annually:'Annually' }
const DEMO_TASKS = []
const ROLE_LEVEL = { super_admin:5, client_admin:4, manager:3, supervisor:2, worker:1 }
// Default SLA response times in minutes
const DEFAULT_SLA = { low:1440, medium:1440, high:1440, critical:60 } // minutes
const SLA_LABELS = { low:'1 day', medium:'1 day', high:'1 day', critical:'1 hour' }

const getSLAMinutes = (priority, orgSLA) => {
  const sla = orgSLA || DEFAULT_SLA
  return sla[priority] || DEFAULT_SLA[priority] || 1440
}

const getSLAStatus = (task, orgSLA) => {
  if(task.status !== 'awaiting_review' || !task.submitted_at) return null
  const slaMinutes = getSLAMinutes(task.priority, orgSLA)
  const elapsed = (new Date() - new Date(task.submitted_at)) / 60000
  const remaining = slaMinutes - elapsed
  const pct = Math.min(100, (elapsed / slaMinutes) * 100)
  if(remaining <= 0) return { status:'breached', remaining:0, pct:100, label:'SLA Breached', color:'#EF4444' }
  if(remaining <= slaMinutes * 0.25) return { status:'warning', remaining, pct, label:remaining<60?Math.round(remaining)+'m left':Math.round(remaining/60)+'h left', color:'#F97316' }
  return { status:'ok', remaining, pct, label:remaining<60?Math.round(remaining)+'m left':Math.round(remaining/60)+'h left', color:'#10B981' }
}

const isRecurring = t => t.recurrence && t.recurrence !== '' && t.recurrence !== 'once' && t.recurrence !== null
const isOneOff = t => !isRecurring(t)
const hasAccess = (userRole, requiredLevel) => (ROLE_LEVEL[userRole]||0) >= requiredLevel
const PAGE_ACCESS = { dashboard:1, tasks:1, evidence:2, escalations:2, reports:3, users:4, tiers:4, orgs:5, support:5, help:1, projects:2, performance:4, leave:1, teams:2, sla:4 }
const pct = (a,b) => b ? Math.round(a/b*100) : 0
const workingDaysBetween = (start, end) => {
  let count = 0
  const cur = new Date(start)
  cur.setHours(0,0,0,0)
  const endD = new Date(end)
  endD.setHours(0,0,0,0)
  while(cur <= endD) {
    const day = cur.getDay()
    if(day!==0&&day!==6) count++
    cur.setDate(cur.getDate()+1)
  }
  return count
}

const computeAlerts = (tasks, user, leaveRecords=[]) => {
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const alerts = []
  const orgTasks = tasks.filter(t=>t.org===user.org)

  // Get users on leave today
  const onLeaveToday = new Set(leaveRecords.filter(l=>l.date_from<=today&&l.date_to>=today).map(l=>l.user_id))

  orgTasks.forEach(t=>{
    if(!t.due_date) return
    const isAssigneeOnLeave = onLeaveToday.has(t.assigned_user_id)
    if(isAssigneeOnLeave) return // skip — worker on leave

    // Alert 1: Worker hasn't done task on due date — alert supervisor
    if(t.status==='pending'&&t.due_date<today&&t.assigned_role==='worker') {
      if(['supervisor','manager','client_admin'].includes(user.role)) {
        alerts.push({ type:'overdue_worker', task:t, msg:`Worker task overdue: "${t.title}" assigned to ${t.assigned_user_name||'worker'}`, level:'red' })
      }
    }

    // Alert 2: Supervisor hasn't responded to awaiting_review for >1 working day
    if(t.status==='awaiting_review'&&t.submitted_at) {
      const days = workingDaysBetween(new Date(t.submitted_at), now)
      if(days>=1&&['manager','client_admin'].includes(user.role)) {
        alerts.push({ type:'review_pending', task:t, msg:`"${t.title}" awaiting review for ${days} working day${days>1?'s':''} — supervisor not responded`, level:'amber' })
      }
    }

    // Alert 3: Report not reviewed within 5 working days
    if(t.status==='awaiting_review'&&t.submitted_at) {
      const days = workingDaysBetween(new Date(t.submitted_at), now)
      if(days>=5&&['manager','client_admin'].includes(user.role)) {
        alerts.push({ type:'review_overdue', task:t, msg:`"${t.title}" not reviewed in ${days} working days — immediate action required`, level:'red' })
      }
    }

    // Alert 4: SLA warning — review deadline approaching or breached
    if(t.status==='awaiting_review'&&t.submitted_at&&['supervisor','manager','client_admin'].includes(user.role)) {
      const sla = getSLAStatus(t, null)
      if(sla?.status==='breached') {
        alerts.push({ type:'sla_breach', task:t, msg:`SLA breached: "${t.title}" — review overdue (${t.priority} priority)`, level:'red' })
      } else if(sla?.status==='warning') {
        alerts.push({ type:'sla_warning', task:t, msg:`SLA warning: "${t.title}" — only ${sla.label} to review (${t.priority} priority)`, level:'amber' })
      }
    }
  })

  return alerts
}

const generateNotifications = (tasks, user, prevTasks=[]) => {
  const notifs = []
  const orgTasks = tasks.filter(t=>t.org===user.org)
  const today = new Date().toISOString().split('T')[0]

  orgTasks.forEach(t=>{
    const prev = prevTasks.find(p=>p.id===t.id)

    // Task completed/submitted — notify supervisor/manager
    if(t.status==='awaiting_review' && prev?.status!=='awaiting_review') {
      if(['supervisor','manager','client_admin'].includes(user.role) &&
        (t.assigned_role==='worker'||t.assigned_role===user.role)) {
        notifs.push({ id:t.id+'_submitted', type:'submitted', title:'Task submitted for review', body:`"${t.title}" submitted by ${t.completed_by||t.assigned_user_name||'worker'}`, taskId:t.id, at:new Date().toISOString(), read:false, color:'#F59E0B' })
      }
    }

    // Task approved — notify worker
    if(t.status==='approved' && prev?.status!=='approved') {
      if(user.id===t.assigned_user_id || user.name===t.assigned_user_name) {
        notifs.push({ id:t.id+'_approved', type:'approved', title:'Task approved ✅', body:`"${t.title}" has been approved`, taskId:t.id, at:new Date().toISOString(), read:false, color:'#10B981' })
      }
    }

    // Task rejected — notify worker
    if(t.status==='rejected' && prev?.status!=='rejected') {
      if(user.id===t.assigned_user_id || user.name===t.assigned_user_name) {
        notifs.push({ id:t.id+'_rejected', type:'rejected', title:'Task sent back ⚠️', body:`"${t.title}" was rejected — check instructions`, taskId:t.id, at:new Date().toISOString(), read:false, color:'#EF4444' })
      }
    }

    // Task overdue — notify assignee and supervisor
    if(t.status==='pending' && t.due_date && t.due_date < today) {
      if(user.id===t.assigned_user_id || user.name===t.assigned_user_name) {
        notifs.push({ id:t.id+'_overdue_worker', type:'overdue', title:'Task overdue 🔴', body:`"${t.title}" was due ${t.due_date}`, taskId:t.id, at:new Date().toISOString(), read:false, color:'#EF4444' })
      }
    }
  })
  return notifs
}

const sendEmailNotif = async (toEmail, subject, body) => {
  if(!isConfigured()||!toEmail) return
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    await fetch(supabaseUrl+'/functions/v1/send-notification', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ to:toEmail, subject, body, secret:import.meta.env.VITE_INVITE_SECRET||'' })
    })
  } catch(e) { console.log('Email notif failed:', e.message) }
}

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
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;touch-action:manipulation}
html,body{height:100%;background:#F4F6F9;color:#1A2033;font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased}
:root{--brand:#00A87E;--brand-dk:#008A68;--brand-lt:rgba(0,168,126,.1);--s3:#F0F2F5;--s4:#E8EBF0;--border:rgba(0,0,0,.08);--border2:rgba(0,0,0,.14);--text:#1A2033;--t2:#5A6478;--t3:#9AA3B2;--red:#EF4444;--amber:#F59E0B;--blue:#3B82F6;--green:#10B981;--r:10px;--rs:6px;--shadow:0 4px 20px rgba(0,0,0,.08);--sidebar-w:214px}
.auth-bg{min-height:100vh;display:flex;align-items:flex-start;justify-content:center;background:linear-gradient(135deg,#F0F7F4,#E8F4F0);padding:20px;overflow-y:auto}
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
.app{display:flex;flex-direction:column;height:100%;position:fixed;top:0;left:0;right:0;bottom:0}
.topbar{display:flex;align-items:center;gap:12px;padding:0 16px;height:52px;background:#fff;border-bottom:1px solid var(--border);flex-shrink:0;z-index:300}
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
@media(max-width:768px){.sidebar{position:absolute;top:0;left:0;bottom:0;transform:translateX(-100%);width:var(--sidebar-w) !important}.sidebar.mobile-open{transform:translateX(0)}}
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
.content{flex:1;overflow-y:auto;padding:20px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
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
.ev-thumbs{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start}
.ev-thumb{width:60px;height:60px;border-radius:var(--rs);background:var(--s3);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:18px;position:relative}
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
.notif-panel{position:fixed;top:52px;right:0;width:320px;max-height:calc(100vh - 52px);background:#fff;border-left:1px solid var(--border);border-bottom:1px solid var(--border);box-shadow:-4px 4px 20px rgba(0,0,0,.1);z-index:250;display:flex;flex-direction:column;overflow:hidden}
@media(max-width:480px){.notif-panel{width:100vw}}
.notif-entry{padding:12px 14px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s}
.notif-entry:hover{background:var(--s3)}
.notif-entry.unread{background:rgba(0,168,126,.04);border-left:3px solid var(--brand)}
.notif-entry.unread:hover{background:rgba(0,168,126,.08)}
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
        {task.project&&<span style={{fontSize:11,color:'#3B82F6',background:'rgba(59,130,246,.08)',padding:'2px 7px',borderRadius:4}}>📁 {task.project}</span>}

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
      setSuccess('✅ Password reset email sent! Check your inbox at ' + email)
      setEmail('')
      setLoading(false)
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
          <div style={{display:'flex',flexDirection:'column',gap:10,marginTop:16,maxHeight:'50vh',overflowY:'auto',paddingRight:4}}>
            {[...orgChoices].sort((a,b)=>a.org.localeCompare(b.org)||(a.role.localeCompare(b.role))).map((m,i)=>(
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
        {success&&<div className="auth-success" style={{fontSize:14,fontWeight:600,padding:'14px 16px',textAlign:'center'}}>{success}</div>}
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

function visibleTasks(tasks, user, leaveRecords=[]) {
  // Super admin sees NO task content — privacy/confidentiality
  if (user.role==='super_admin') return []

  const orgTasks = tasks.filter(t => t.org?.toLowerCase()===user.org?.toLowerCase())

  // Check if user is a replacement for someone on leave
  const today = new Date().toISOString().split('T')[0]
  const coveringFor = leaveRecords.filter(l=>
    l.replacement_id===user.id &&
    l.date_from<=today &&
    l.date_to>=today
  )

  if (user.role==='client_admin') {
    // Sees all tasks in org
    // "Receives back" = completed/approved tasks assigned to managers show in their view
    return orgTasks
  }

  if (user.role==='manager') {
    // Managers see all tasks in their org for full oversight
    return orgTasks
  }

  if (user.role==='supervisor') {
    // Supervisors see all tasks in their org for full oversight
    return orgTasks
  }

  if (user.role==='worker') {
    const myTasks = orgTasks.filter(t =>
      t.assigned_user_id===user.id ||
      t.assigned_user_name?.toLowerCase()===user.name?.toLowerCase() ||
      (!t.assigned_user_id&&!t.assigned_user_name&&t.assigned_role==='worker')
    )
    // Add tasks of people being covered
    const coverTasks = coveringFor.length>0 ? orgTasks.filter(t=>
      coveringFor.some(l=>t.assigned_user_id===l.user_id||t.assigned_user_name===l.user_name)
    ) : []
    return [...new Map([...myTasks,...coverTasks].map(t=>[t.id,t])).values()]
  }

  return orgTasks
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

function DashboardView({ tasks, user, setPage, tickets=[], leaveRecords=[], orgSLA=DEFAULT_SLA }) {
  // Filter tasks by org - super admin sees no org's tasks on dashboard (use Organisations page)
  const visibleAll = visibleTasks(tasks, user)
  const visible = user.role==='super_admin' ? [] : visibleAll
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
        {isWkr&&<><Stat label="My Tasks" val={visible.filter(t=>!['awaiting_review','approved','completed'].includes(t.status)||isRecurring(t)).length} sub="remaining to do" icon="📋"/><Stat label="Submitted" val={visible.filter(t=>['awaiting_review','approved','completed'].includes(t.status)).length} sub="done or in review" color="#10B981" bg="rgba(16,185,129,.1)" icon="✅"/><Stat label="Overdue" val={overdue} sub={overdue>0?'Complete soon':'All good'} color={overdue>0?'#EF4444':'#10B981'} bg={overdue>0?'rgba(239,68,68,.1)':'rgba(16,185,129,.1)'} icon="⏰"/><Stat label="Rejected" val={rejected} sub={rejected>0?'Action needed':'All good'} color={rejected>0?'#EF4444':'#6B7280'} bg={rejected>0?'rgba(239,68,68,.1)':'rgba(107,114,128,.1)'} icon="✗"/></>}
      </div>
      {overdue>0&&<div className="esc-banner"><span style={{fontSize:18}}>🚨</span><div className="esc-banner-body"><div className="esc-banner-title">{overdue} task{overdue>1?'s':''} overdue</div><div className="esc-banner-sub">Immediate action required</div></div><button className="btn btn-danger btn-sm" onClick={()=>setPage('escalations')}>View</button></div>}
      {/* Smart Alerts */}
      {(()=>{
        const smartAlerts = computeAlerts(tasks, user, leaveRecords)
        if(smartAlerts.length===0) return null
        return (
          <div className="section" style={{marginBottom:14,border:'1px solid rgba(239,68,68,.2)',background:'rgba(239,68,68,.03)'}}>
            <div className="section-title" style={{color:'var(--red)'}}>⚠️ Action Required ({smartAlerts.length})</div>
            {smartAlerts.slice(0,5).map((a,i)=>(
              <div key={i} style={{display:'flex',gap:10,padding:'8px 0',borderBottom:'1px solid var(--border)',alignItems:'flex-start',cursor:'pointer'}} onClick={()=>setPage('tasks')}>
                <span style={{fontSize:14,flexShrink:0}}>{a.level==='red'?'🔴':'🟡'}</span>
                <div style={{flex:1,fontSize:12,color:'var(--text)',lineHeight:1.5}}>{a.msg}</div>
              </div>
            ))}
            {smartAlerts.length>5&&<div style={{fontSize:11,color:'var(--t2)',marginTop:6,textAlign:'right'}}>{smartAlerts.length-5} more alerts</div>}
          </div>
        )
      })()}
      {isMgr&&false&&awards.week&&<div className="section"><div className="section-title">🏆 Staff Recognition</div><div className="award-card"><div className="award-icon">🥇</div><div><div className="award-title">Worker of the Week</div><div className="award-name">{awards.week.name}</div><div className="award-sub">{awards.week.count} tasks completed</div></div></div></div>}
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
        {isSA ? (
          <>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <div style={{fontSize:14,fontWeight:700}}>🎫 Active Support Tickets</div>
              <button className="btn btn-secondary btn-sm" onClick={()=>setPage('support')}>View All</button>
            </div>
            {tickets.filter(t=>t.status==='open'||t.status==='in_progress').length===0
              ? <div className="empty"><div className="empty-icon">🎉</div><div className="empty-text">No open tickets</div></div>
              : tickets.filter(t=>t.status==='open'||t.status==='in_progress').slice(0,5).map((t,i)=>(
                <div key={i} onClick={()=>setPage('support')} style={{background:'#fff',border:'1px solid var(--border)',borderRadius:10,padding:12,marginBottom:8,cursor:'pointer',borderLeft:'4px solid '+(t.status==='open'?'#F59E0B':'#3B82F6')}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:12,fontWeight:600,marginBottom:2}}>{t.description?.slice(0,80)}{t.description?.length>80?'...':''}</div>
                      <div style={{fontSize:11,color:'var(--t2)'}}>{t.user_name} · {t.org} · {t.device}</div>
                    </div>
                    <span style={{fontSize:10,padding:'2px 8px',borderRadius:10,fontWeight:600,background:t.status==='open'?'rgba(245,158,11,.15)':'rgba(59,130,246,.15)',color:t.status==='open'?'#F59E0B':'#3B82F6',whiteSpace:'nowrap'}}>{t.status?.replace('_',' ').toUpperCase()}</span>
                  </div>
                </div>
              ))
            }
          </>
        ) : (
          <>
            <div style={{fontSize:14,fontWeight:700,marginBottom:10}}>Active Tasks</div>
            {visible.filter(t=>!['completed','approved'].includes(t.status)||isRecurring(t)).slice(0,5).map(t=><TaskCard key={t.id} task={t} onClick={()=>setPage('tasks')}/>)}
            {visible.filter(t=>!['completed','approved'].includes(t.status)||isRecurring(t)).length===0&&<div className="empty"><div className="empty-icon">🎉</div><div className="empty-text">All tasks complete!</div></div>}
          </>
        )}
      </div>
    </div>
  )
}

function TasksView({ tasks, setTasks, user, loadTasks, search, pushUndo, setAuditLog, leaveRecords=[], orgSLA }) {
  const [filter, setFilter] = useState('all')
  const [selectedOrg, setSelectedOrg] = useState('all')
  const [orgSearch, setOrgSearch] = useState('')
  const [showArchive, setShowArchive] = useState(false)
  const [archiveSearch, setArchiveSearch] = useState('')
  const [archiveDateFrom, setArchiveDateFrom] = useState('')
  const [archiveDateTo, setArchiveDateTo] = useState('')
  const [archiveWorker, setArchiveWorker] = useState('')
  const [archiveCategory, setArchiveCategory] = useState('')
  const [archiveCollapsed, setArchiveCollapsed] = useState({})
  const today = new Date()
  const [calYear, setCalYear] = useState(today.getFullYear())
  const [calMonth, setCalMonth] = useState(today.getMonth())
  const [calPicking, setCalPicking] = useState('from') // 'from' | 'to' | null
  const [orgsList, setOrgsList] = useState([])
  const [selected, setSelected] = useState(null)
  const [comment, setComment] = useState('')
  const [editingComment, setEditingComment] = useState(null) // {taskId, commentId, text}
  const [interventionModal, setInterventionModal] = useState(null) // {action, label, changes, taskId}
  const [interventionReason, setInterventionReason] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editTask, setEditTask] = useState({})
  const [showReject, setShowReject] = useState(null)
  const [rejectNote, setRejectNote] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteScope, setDeleteScope] = useState('')
  const [celebration, setCelebration] = useState(false)
  const [teamUsers, setTeamUsers] = useState([])
  const [userSearch, setUserSearch] = useState('')
  const [newTask, setNewTask] = useState({ title:'', category:'Hospitality', department:'', priority:'medium', due_date:'', compliance:false, recurrence:'once', assigned_role:'worker', assigned_user_id:'', assigned_user_name:'', assigned_user_email:'', project:'' })
  const [orgProjects, setOrgProjects] = useState([])

  useEffect(()=>{
    if(isConfigured()&&user.org) {
      supabase.from('projects').select('*').eq('org',user.org).eq('status','active').order('name')
        .then(({data})=>{ if(data) setOrgProjects(data) })
        .catch(()=>{}) // table may not exist yet
    }
  },[user.org])

  useEffect(()=>{ if(isConfigured()) supabase.from('profiles').select('*').then(({data})=>{ if(data) setTeamUsers(user.role==='super_admin'?data:data.filter(u=>u.org===user.org)) }) },[])
  useEffect(()=>{ if(isConfigured()&&user.role==='super_admin') supabase.from('organisations').select('name,status').eq('status','active').order('name').then(({data})=>{ if(data) setOrgsList(data.map(o=>o.name)) }) },[])


  const visible = visibleTasks(tasks, user, leaveRecords)
  // Super admin: filter by selected org
  const orgFiltered = user.role==='super_admin' && selectedOrg!=='all'
    ? visible.filter(t=>t.org===selectedOrg)
    : visible
  // Get unique orgs for super admin dropdown
  const taskOrgs = [...new Set(tasks.map(t=>t.org).filter(Boolean))]
  const allOrgs = user.role==='super_admin'
    ? [...new Set([...orgsList,...taskOrgs])].sort()
    : []
  const activeStatuses = ['pending','in_progress','awaiting_review','overdue','escalated','rejected']
  const searchFiltered = search ? orgFiltered.filter(t=>t.title?.toLowerCase().includes(search.toLowerCase())||t.category?.toLowerCase().includes(search.toLowerCase())||t.assigned_user_name?.toLowerCase().includes(search.toLowerCase())) : orgFiltered
  const activeFiltered = searchFiltered.filter(t=>activeStatuses.includes(t.status) || isRecurring(t))
  const filtered = filter==='all'?activeFiltered:filter==='escalated'?activeFiltered.filter(t=>t.escalation):activeFiltered.filter(t=>t.status===filter)

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
      // Send email notifications for key status changes
      if(isConfigured()) {
        const task = tasks.find(t=>t.id===id)
        // Task submitted → email supervisor/manager
        if(changes.status==='awaiting_review' && task) {
          const supervisors = await supabase.from('profiles').select('email,name,role').eq('org',task.org||user.org)
          if(supervisors.data) {
            supervisors.data.filter(p=>['supervisor','manager','client_admin'].includes(p.role)&&p.email).forEach(p=>{
              sendEmailNotif(p.email, `Task submitted for review: ${task.title}`,
                `${task.assigned_user_name||'A worker'} has submitted "${task.title}" for your review in ${task.org||user.org}. Please review it in Taksyn.`)
            })
          }
        }
        // Task approved → email worker
        if(changes.status==='approved' && task?.assigned_user_id) {
          const worker = await supabase.from('profiles').select('email,name').eq('id',task.assigned_user_id).single()
          if(worker.data?.email) {
            sendEmailNotif(worker.data.email, `Task approved: ${task.title}`,
              `Great work! Your task "${task.title}" has been approved by ${user.name}.`)
          }
        }
        // Task rejected → email worker
        if(changes.status==='rejected' && task?.assigned_user_id) {
          const worker = await supabase.from('profiles').select('email,name').eq('id',task.assigned_user_id).single()
          if(worker.data?.email) {
            sendEmailNotif(worker.data.email, `Task sent back: ${task.title}`,
              `Your task "${task.title}" has been sent back by ${user.name}. Please check the instructions in Taksyn and resubmit.`)
          }
        }
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

  const createTask = () => {
    if (!newTask.title.trim() || creating) return
    setCreating(true)
    const taskData = {...newTask}
    // Close and reset immediately — no await before this
    setShowCreate(false)
    setUserSearch('')
    setNewTask({title:'',category:'Hospitality',department:'',priority:'medium',due_date:'',compliance:false,recurrence:'once',assigned_role:'worker',assigned_user_id:'',assigned_user_name:'',assigned_user_email:'',project:''})
    // Do the async work in background
    const t = { id:'T'+Date.now(), ...taskData, status:'pending', subtasks:[], evidence:[], comments:[], escalation:false, created_by:user.name, org:user.org, created_at:new Date().toISOString() }
    setTasks(prev=>[...prev,t])
    if (isConfigured()) {
      supabase.auth.getUser().then(({data:{user:authUser}})=>{
        const assigned_user_id = authUser?.id ?? null
        supabase.from('tasks').insert({ ...t, subtasks:'[]', evidence:'[]', comments:'[]', assigned_user_id })
          .then(({error})=>{
            if (error) console.error('Task save error:', error)
            // Real-time subscription will update the list automatically
          })
      }).finally(()=>setCreating(false))
    } else {
      setCreating(false)
    }
  }

  const canCreate = ['client_admin','manager','supervisor'].includes(user.role)
  const canApprove = hasAccess(user.role, 2)
  // Each role can only assign to roles below them
  const assignableRoles = user.role==='client_admin' ? ['manager','supervisor','worker']
    : user.role==='manager' ? ['supervisor','worker']
    : user.role==='supervisor' ? ['worker']
    : []
  const sel = selected ? tasks.find(t=>t.id===selected) : null

  const AssignField = ({ value, onChange, compact=false }) => (
    teamUsers.length > 0 ? (
      <div>
        {!compact&&<input className="form-input" placeholder="Search staff…" value={userSearch} onChange={e=>setUserSearch(e.target.value)} style={{marginBottom:6}}/>}
        <select className="form-select" value={value} onChange={onChange}>
          <option value="">— Select a staff member —</option>
          {teamUsers.filter(u=>(assignableRoles.includes(u.role))&&(!userSearch||u.name?.toLowerCase().includes(userSearch.toLowerCase()))).map(u=><option key={u.id} value={u.id}>{u.name} ({ROLE_LABELS[u.role]||u.role})</option>)}
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
                <div className="form-field"><label className="form-label">Category</label><select className="form-select" value={editTask.category||''} onChange={e=>setEditTask({...editTask,category:e.target.value,department:''})}>{Object.keys(CAT_ICONS).map(c=><option key={c}>{c}</option>)}</select></div>
                <div className="form-field"><label className="form-label">Department</label><select className="form-select" value={editTask.department||''} onChange={e=>setEditTask({...editTask,department:e.target.value})}><option value="">— Select —</option>{(DEPARTMENTS[editTask.category||'General']||DEPARTMENTS.General).map(d=><option key={d} value={d}>{d}</option>)}</select></div>
                <div className="form-field"><label className="form-label">Priority</label><select className="form-select" value={editTask.priority||''} onChange={e=>setEditTask({...editTask,priority:e.target.value})}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
              </div>
              <div className="two-col">
                <div className="form-field"><label className="form-label">Due Date</label><input className="form-input" type="date" value={editTask.due_date||''} onChange={e=>setEditTask({...editTask,due_date:e.target.value})}/></div>
                <div className="form-field"><label className="form-label">Schedule</label><select className="form-select" value={editTask.recurrence||'once'} onChange={e=>setEditTask({...editTask,recurrence:e.target.value})}>{RECURRENCE_OPTS.map(r=><option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>)}</select></div>
              </div>
              <div className="form-field"><label className="form-label">Assign To</label>
                {teamUsers.length>0 ? <select className="form-select" value={editTask.assigned_user_id||''} onChange={e=>{ const u=teamUsers.find(u=>u.id===e.target.value); if(u) setEditTask({...editTask,assigned_user_id:u.id,assigned_user_name:u.name,assigned_role:u.role}) }}><option value="">— Select —</option>{teamUsers.map(u=><option key={u.id} value={u.id}>{u.name} ({ROLE_LABELS[u.role]||u.role})</option>)}</select>
                : <select className="form-select" value={editTask.assigned_role||'worker'} onChange={e=>setEditTask({...editTask,assigned_role:e.target.value})}>{ROLES.filter(r=>r!=='super_admin').map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>}
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
                  const rejectEntry={id:Date.now()+'',author:user.name,authorId:user.id,text:'⚠️ Rejected: '+rejectNote.trim(),timestamp:new Date().toISOString(),edits:[],isRejection:true}
                  update(showReject,{status:'rejected',reviewed_at:new Date().toISOString(),comments:[...parseSafe(task.comments,[]),rejectEntry]})
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
            <div className="modal-hdr"><div className="modal-title" style={{color:'#F59E0B'}}>🔧 Platform Admin Intervention</div><button className="modal-close" onClick={()=>{setInterventionModal(null);setInterventionReason('')}}>×</button></div>
            <div className="modal-body">
              <div style={{background:'rgba(245,158,11,.08)',border:'1px solid rgba(245,158,11,.25)',borderRadius:8,padding:12,marginBottom:14,fontSize:12}}>
                <div style={{fontWeight:700,marginBottom:4}}>⚠️ You are about to modify organisation data</div>
                <div style={{color:'var(--t2)'}}>Action: <strong>{interventionModal?.action}</strong></div>
              </div>
              <div className="form-field"><label className="form-label">Reason for Intervention <span style={{color:'var(--red)'}}>*</span></label><textarea className="comment-box" style={{minHeight:80}} placeholder="e.g. Fixing incorrect status…" value={interventionReason} onChange={e=>setInterventionReason(e.target.value)}/></div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
                <button className="btn btn-secondary" onClick={()=>{setInterventionModal(null);setInterventionReason('')}}>Cancel</button>
                <button className="btn btn-amber" disabled={!interventionReason.trim()} onClick={()=>{ update(interventionModal.taskId,interventionModal.changes,interventionReason.trim()); setInterventionModal(null); setInterventionReason('') }}>🔧 Confirm Intervention</button>
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
                <div className="form-field"><label className="form-label">Category</label><select className="form-select" value={newTask.category} onChange={e=>setNewTask({...newTask,category:e.target.value,department:''})}>{Object.keys(CAT_ICONS).map(c=><option key={c}>{c}</option>)}</select></div>
                <div className="form-field"><label className="form-label">Department</label><select className="form-select" value={newTask.department||''} onChange={e=>setNewTask({...newTask,department:e.target.value})}><option value="">— Select —</option>{(DEPARTMENTS[newTask.category]||DEPARTMENTS.General).map(d=><option key={d} value={d}>{d}</option>)}</select></div>
                <div className="form-field"><label className="form-label">Priority</label><select className="form-select" value={newTask.priority} onChange={e=>setNewTask({...newTask,priority:e.target.value})}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
              </div>
              <div className="two-col">
                <div className="form-field"><label className="form-label">Due Date</label><input className="form-input" type="date" value={newTask.due_date} onChange={e=>setNewTask({...newTask,due_date:e.target.value})}/></div>
                <div className="form-field"><label className="form-label">Schedule</label><select className="form-select" value={newTask.recurrence} onChange={e=>setNewTask({...newTask,recurrence:e.target.value})}>{RECURRENCE_OPTS.map(r=><option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>)}</select></div>
              </div>
              <div className="form-field"><label className="form-label">Assign To</label>
                {teamUsers.length>0 ? (
                  <div>
                    <input className="form-input" placeholder="Search staff…" value={userSearch} onChange={e=>setUserSearch(e.target.value)} style={{marginBottom:6}}/>
                    <select className="form-select" value={newTask.assigned_user_id} onChange={e=>{ const u=teamUsers.find(u=>u.id===e.target.value); if(u) setNewTask({...newTask,assigned_user_id:u.id,assigned_user_name:u.name,assigned_user_email:u.email||'',assigned_role:u.role}); else setNewTask({...newTask,assigned_user_id:'',assigned_user_name:'',assigned_user_email:''}) }}>
                      <option value="">— Select a staff member —</option>
                      {teamUsers.filter(u=>(assignableRoles.includes(u.role))&&(!userSearch||u.name?.toLowerCase().includes(userSearch.toLowerCase()))).map(u=><option key={u.id} value={u.id}>{u.name} ({ROLE_LABELS[u.role]||u.role})</option>)}
                    </select>
                    {newTask.assigned_user_name&&<div style={{fontSize:11,color:'var(--brand)',marginTop:4,fontWeight:600}}>✓ {newTask.assigned_user_name}</div>}
                    {teamUsers.length>0&&!newTask.assigned_user_id&&<div style={{fontSize:11,color:'#F59E0B',marginTop:4}}>⚠️ Please select a staff member to assign this task</div>}
                  </div>
                ) : (
                  <select className="form-select" value={newTask.assigned_role} onChange={e=>setNewTask({...newTask,assigned_role:e.target.value})}>{assignableRoles.map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>
                )}
              </div>
              {orgProjects.length>0&&(
                <div className="form-field">
                  <label className="form-label">Project <span style={{fontSize:10,color:'var(--t2)',fontWeight:400,textTransform:'none'}}>— optional</span></label>
                  <select className="form-select" value={newTask.project||''} onChange={e=>setNewTask({...newTask,project:e.target.value})}>
                    <option value="">— No project —</option>
                    {orgProjects.map(p=><option key={p.id} value={p.name}>{p.name}</option>)}
                  </select>
                </div>
              )}
              <div className="form-field" style={{display:'flex',alignItems:'center',gap:10}}>
                <input type="checkbox" id="comp" checked={newTask.compliance} onChange={e=>setNewTask({...newTask,compliance:e.target.checked})} style={{width:16,height:16,accentColor:'var(--brand)',cursor:'pointer'}}/>
                <label htmlFor="comp" style={{fontSize:13,cursor:'pointer'}}>Mark as compliance-critical</label>
              </div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className="btn btn-secondary" onClick={()=>setShowCreate(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={creating||!newTask.title.trim()||(teamUsers.length>0&&!newTask.assigned_user_id)} onClick={createTask}>{creating?'Creating…':'Create Task'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {sel ? (
        <div className="anim">
          <button className="back-btn" onClick={()=>{setSelected(null);setShowDeleteConfirm(false);setDeleteScope('')}}><IC n="x" s={14}/> {showArchive?'Back to Archive':'Back to Tasks'}</button>
          <div className="detail-header">
            <div style={{flex:1}}>
              <div style={{display:'flex',gap:6,marginBottom:6,flexWrap:'wrap'}}>
                <span className="cat-tag">{CAT_ICONS[sel.category]||'📋'} {sel.category}</span>
                {sel.department&&<span className="cat-tag">🏢 {sel.department}</span>}
                {sel.recurrence&&sel.recurrence!=='once'&&<span className="recurrence-tag">🔁 {RECURRENCE_LABELS[sel.recurrence]}</span>}
              </div>
              <div style={{fontSize:17,fontWeight:800,letterSpacing:'-.5px'}}>{sel.title}</div>
              <div style={{fontSize:11,color:'var(--t2)',marginTop:3}}>{sel.id} · Due {sel.due_date}{sel.created_by&&' · Created by '+sel.created_by}</div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:5,alignItems:'flex-end'}}><StatusBadge status={sel.status}/><PriBadge priority={sel.priority}/></div>
          </div>
          <div className="timing-bar">
            <div className={"timing-chip "+(sel.started_at?'active':'')}>⏱ In: {sel.started_at?fmtTime(sel.started_at):'—'}</div>
            <div className={"timing-chip "+(sel.completed_at?'active':'')}>⏹ Out: {sel.completed_at?fmtTime(sel.completed_at):'—'}</div>
            {fmtDuration(sel.started_at,sel.completed_at)&&<div className="timing-chip active">⏱ {fmtDuration(sel.started_at,sel.completed_at)}</div>}
            {sel.gps_start&&<span className="gps-chip" onClick={()=>window.open('https://maps.google.com/?q='+sel.gps_start)}>📍 Start</span>}
            {sel.gps_end&&<span className="gps-chip" style={{background:'rgba(16,185,129,.08)',borderColor:'rgba(16,185,129,.2)',color:'var(--green)'}} onClick={()=>window.open('https://maps.google.com/?q='+sel.gps_end)}>📍 End</span>}
          </div>
          {sel.status==='rejected'&&(
            <div style={{background:'rgba(239,68,68,.06)',border:'1px solid rgba(239,68,68,.25)',borderRadius:10,padding:14,marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:700,color:'var(--red)',marginBottom:6}}>⚠️ Task Sent Back</div>
              {parseSafe(sel.comments,[]).filter(c=>(typeof c==='object'?c.isRejection:String(c||'').startsWith('⚠️'))).slice(-1).map((c,i)=>{
                const txt=typeof c==='object'?c.text:String(c||'').split(': ').slice(1).join(': ')
                return <div key={i} style={{fontSize:13,color:'var(--text)',background:'rgba(239,68,68,.04)',borderRadius:6,padding:'8px 10px'}}>{txt}</div>
              })}
            </div>
          )}
          {sel.escalation&&<div className="esc-banner"><span style={{fontSize:18}}>🚨</span><div className="esc-banner-body"><div className="esc-banner-title">Escalated</div></div></div>}
          {sel.lastIntervention&&<div style={{background:'rgba(245,158,11,.06)',border:'1px solid rgba(245,158,11,.2)',borderRadius:8,padding:10,marginBottom:12,fontSize:12}}><span style={{color:'#F59E0B',fontWeight:700}}>🔧 Platform Intervention</span> by {sel.lastIntervention.by} — {sel.lastIntervention.reason}</div>}
          <div className="section">
            <div className="section-title">Evidence {parseSafe(sel.evidence).length>0?'('+parseSafe(sel.evidence).length+'/5)':''}</div>
            {parseSafe(sel.evidence).length>0&&<div className="ev-thumbs" style={{marginBottom:10}}>
              {parseSafe(sel.evidence).map((e,i)=>{
                const url=typeof e==='object'?e.url:e
                const ts=typeof e==='object'?e.ts:null
                return (
                  <div key={i} style={{position:'relative',marginBottom:4}}>
                    <div className="ev-thumb">{typeof url==='string'&&(url.startsWith('data:image')||url.startsWith('http'))?<img src={url} alt="evidence" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<span style={{fontSize:18}}>📷</span>}
                      {user.role==='worker'&&<div className="ev-rm" onClick={()=>update(sel.id,{evidence:parseSafe(sel.evidence).filter((_,j)=>j!==i)})}>×</div>}
                    </div>
                    {ts&&<div style={{fontSize:9,color:'var(--t2)',textAlign:'center',marginTop:2}}>{new Date(ts).toLocaleDateString('en-AU')}</div>}
                  </div>
                )
              })}
            </div>}
            {user.role==='worker'&&parseSafe(sel.evidence).length<5&&(
              <div>
                <div style={{display:'flex',gap:8,marginBottom:10}}>
                  <button className="btn btn-secondary" style={{flex:1}} onClick={()=>document.getElementById('cam-inp').click()}>📷 Take Photo</button>
                  <button className="btn btn-secondary" style={{flex:1}} onClick={()=>document.getElementById('gal-inp').click()}>🖼 Gallery</button>
                </div>
                <input id="cam-inp" type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={async e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=async ev=>{ await update(sel.id,{evidence:[...parseSafe(sel.evidence),{url:ev.target.result,ts:new Date().toISOString(),by:user.name}]}) }; r.readAsDataURL(f); e.target.value='' }}/>
                <input id="gal-inp" type="file" accept="image/*" style={{display:'none'}} onChange={async e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=async ev=>{ await update(sel.id,{evidence:[...parseSafe(sel.evidence),{url:ev.target.result,ts:new Date().toISOString(),by:user.name}]}) }; r.readAsDataURL(f); e.target.value='' }}/>
                {parseSafe(sel.evidence).length===0&&<div className="evidence-zone" onClick={()=>document.getElementById('cam-inp').click()}><div style={{fontSize:24,marginBottom:5}}>📷</div><div style={{fontSize:13,color:'var(--t2)'}}>Tap to add photo (max 5)</div></div>}
              </div>
            )}
            {user.role!=='worker'&&!parseSafe(sel.evidence).length&&<div style={{fontSize:13,color:'var(--t2)'}}>No evidence uploaded yet</div>}
          </div>
          <div className="section">
            <div className="section-title">Comments & Notes</div>
            {parseSafe(sel.comments,[]).map((c,i)=>{
              const isObj=c&&typeof c==='object'
              const author=isObj?c.author:(String(c||'').split(':')[0]||'')
              const text=isObj?c.text:String(c||'').split(':').slice(1).join(':').trim()
              const ts=isObj?c.timestamp:null
              const isAmendment=isObj&&c.isAmendment
              const isRejection=isObj&&c.isRejection
              const isOwn=isObj?c.authorId===user.id:author===user.name
              const tsDate=ts?new Date(ts):null
              const isToday=tsDate?tsDate.toDateString()===new Date().toDateString():false
              const fmtTs=d=>new Date(d).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})
              const commentId=isObj?c.id:i+''
              const isEditing=editingComment&&editingComment.taskId===sel.id&&editingComment.commentId===commentId
              return (
                <div key={i} style={{borderLeft:isAmendment?'3px solid #6366F1':isRejection?'3px solid var(--red)':'3px solid var(--border)',marginBottom:8,background:'var(--s3)',borderRadius:6,padding:'8px 10px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                    <div style={{flex:1}}>
                      <span style={{fontWeight:700,fontSize:12,color:isAmendment?'#6366F1':isRejection?'var(--red)':'var(--brand)'}}>{isAmendment?'✏️':isRejection?'⚠️':'💬'} {author}</span>
                      {tsDate&&<span style={{fontSize:10,color:'var(--t2)',marginLeft:8}}>{fmtTs(ts)}</span>}
                    </div>
                    {isOwn&&!isEditing&&(
                      <div style={{display:'flex',gap:4}}>
                        <button style={{fontSize:10,padding:'2px 7px',borderRadius:4,border:'1px solid var(--border)',background:'none',cursor:'pointer',color:'var(--t2)'}} onClick={()=>setEditingComment({taskId:sel.id,commentId,text})}>✏️</button>
                        {isToday&&<button style={{fontSize:10,padding:'2px 7px',borderRadius:4,border:'1px solid rgba(239,68,68,.3)',background:'none',cursor:'pointer',color:'var(--red)'}} onClick={()=>update(sel.id,{comments:parseSafe(sel.comments,[]).filter((_,j)=>j!==i)})}>🗑</button>}
                      </div>
                    )}
                  </div>
                  {isEditing?(
                    <div style={{marginTop:6}}>
                      <textarea style={{width:'100%',padding:'6px 8px',borderRadius:6,border:'1px solid var(--border)',background:'var(--s2)',color:'var(--text)',fontSize:12,resize:'vertical',minHeight:56,fontFamily:'inherit',boxSizing:'border-box'}} value={editingComment.text} onChange={e=>setEditingComment({...editingComment,text:e.target.value})}/>
                      <div style={{display:'flex',gap:6,marginTop:6}}>
                        <button className="btn btn-primary btn-sm" onClick={()=>{ const all=parseSafe(sel.comments,[]); update(sel.id,{comments:all.map((cm,j)=>j!==i?cm:{...(typeof cm==='object'?cm:{id:i+'',author,authorId:user.id,text,timestamp:new Date().toISOString(),edits:[]}),edits:[...((typeof cm==='object'?cm.edits:null)||[]),{text:typeof cm==='object'?cm.text:text,editedAt:new Date().toISOString()}],text:editingComment.text})}); setEditingComment(null) }}>Save</button>
                        <button className="btn btn-secondary btn-sm" onClick={()=>setEditingComment(null)}>Cancel</button>
                      </div>
                    </div>
                  ):(
                    <div style={{marginTop:4,fontSize:13}}>{text}</div>
                  )}
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
              <div style={{fontSize:13}}><span style={{color:'var(--t2)'}}>Assigned:</span> {sel.assigned_user_name||ROLE_LABELS[sel.assigned_role]}</div>
              <div style={{fontSize:13}}><span style={{color:'var(--t2)'}}>Schedule:</span> {RECURRENCE_LABELS[sel.recurrence||'once']}</div>
              {sel.project&&<div style={{fontSize:13}}><span style={{color:'var(--t2)'}}>Project:</span> <span style={{color:'#3B82F6',fontWeight:600}}>📁 {sel.project}</span></div>}
            </div>
          </div>
          {user.role==='worker'&&(
            <div style={{background:'var(--s3)',border:'1px solid var(--border)',borderRadius:10,padding:14,marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>Task Timer</div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:10}}>
                {!sel.started_at?<button className="btn btn-green" style={{flex:1}} onClick={()=>startTask(sel.id)}>▶ Time In</button>:<div style={{flex:1,background:'rgba(16,185,129,.1)',border:'1px solid rgba(16,185,129,.25)',borderRadius:6,padding:'8px 12px',fontSize:12,color:'var(--green)',fontWeight:600,textAlign:'center'}}>✓ In: {fmtTime(sel.started_at)}</div>}
                {sel.started_at&&!sel.completed_at?<button className="btn btn-amber" style={{flex:1}} onClick={()=>{ navigator.geolocation?.getCurrentPosition(pos=>update(sel.id,{completed_at:new Date().toISOString(),gps_end:pos.coords.latitude.toFixed(4)+','+pos.coords.longitude.toFixed(4)}),()=>update(sel.id,{completed_at:new Date().toISOString()})) }}>⏹ Time Out</button>:sel.completed_at?<div style={{flex:1,background:'rgba(245,158,11,.1)',border:'1px solid rgba(245,158,11,.25)',borderRadius:6,padding:'8px 12px',fontSize:12,color:'var(--amber)',fontWeight:600,textAlign:'center'}}>✓ Out: {fmtTime(sel.completed_at)}</div>:null}
              </div>
              {sel.started_at&&sel.completed_at&&<div style={{fontSize:12,color:'var(--t2)',marginBottom:10,textAlign:'center'}}>⏱ Duration: <strong>{fmtDuration(sel.started_at,sel.completed_at)}</strong></div>}
              {sel.started_at&&sel.completed_at&&!['awaiting_review','approved'].includes(sel.status)&&<button className="btn btn-primary" style={{width:'100%'}} onClick={()=>submitTask(sel.id)}>✅ Submit for Review</button>}
              {sel.status==='awaiting_review'&&<div style={{background:'rgba(245,158,11,.1)',border:'1px solid rgba(245,158,11,.25)',borderRadius:6,padding:'8px 12px',fontSize:12,color:'var(--amber)',fontWeight:600,textAlign:'center'}}>📋 Awaiting review</div>}
              {sel.status==='approved'&&<div style={{background:'rgba(16,185,129,.1)',border:'1px solid rgba(16,185,129,.25)',borderRadius:6,padding:'8px 12px',fontSize:12,color:'var(--green)',fontWeight:600,textAlign:'center'}}>✅ Approved</div>}
            </div>
          )}
          <div className="btn-row">
            {canApprove&&sel.status!=='approved'&&<button className="btn btn-secondary" onClick={()=>{setEditTask({...sel,subtasks:parseSafe(sel.subtasks)});setShowEdit(true)}}>✏️ Edit</button>}
            {canApprove&&sel.status==='awaiting_review'&&<><button className="btn btn-primary" onClick={()=>update(sel.id,{status:'approved'})}>✅ Approve</button><button className="btn btn-danger" onClick={()=>setShowReject(sel.id)}>✗ Send Back</button></>}
            {canApprove&&!sel.escalation&&!['completed','approved'].includes(sel.status)&&<button className="btn btn-amber" onClick={()=>update(sel.id,{escalation:true,status:'escalated'})}>⚠️ Escalate</button>}
            {canApprove&&sel.escalation&&<button className="btn btn-secondary" onClick={()=>update(sel.id,{escalation:false,status:'in_progress'})}>Resolve</button>}
            {canApprove&&(
              <div style={{marginLeft:'auto'}}>
                {!showDeleteConfirm?<button className="btn btn-danger btn-sm" onClick={()=>setShowDeleteConfirm(true)}>🗑 Delete</button>:(
                  <div style={{background:'rgba(239,68,68,.06)',border:'1px solid rgba(239,68,68,.25)',borderRadius:8,padding:12,minWidth:200}}>
                    <div style={{fontSize:12,fontWeight:700,color:'var(--red)',marginBottom:10}}>Delete this task?</div>
                    {[['this','This task only'],['future','This and future']].map(([v,l])=>(
                      <label key={v} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12,marginBottom:6}}>
                        <input type="radio" name="deleteScope" value={v} checked={deleteScope===v} onChange={()=>setDeleteScope(v)} style={{accentColor:'var(--red)'}}/>
                        {l}
                      </label>
                    ))}
                    <div style={{display:'flex',gap:6,marginTop:8}}>
                      <button className="btn btn-secondary btn-sm" onClick={()=>{setShowDeleteConfirm(false);setDeleteScope('')}}>Cancel</button>
                      <button className="btn btn-danger btn-sm" disabled={!deleteScope} onClick={async()=>{
                        if(pushUndo) pushUndo('Deleted: '+sel.title,tasks)
                        setTasks(prev=>prev.filter(t=>t.id!==sel.id))
                        if(isConfigured()) await supabase.from('tasks').delete().eq('id',sel.id)
                        setShowDeleteConfirm(false); setDeleteScope(''); setSelected(null)
                      }}>Confirm</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div>
          <div className="ph">
            <div className="ph-top">
              <div>
                <div className="ph-title">Tasks</div>
                <div className="ph-sub">{user.role==='super_admin'?(selectedOrg==='all'?`All orgs · ${orgFiltered.length} tasks`:`${selectedOrg} · ${orgFiltered.length} tasks`):`${visible.length} tasks · ${visible.filter(t=>t.compliance).length} compliance`}</div>
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <button className={'btn btn-sm '+(showArchive?'btn-primary':'btn-secondary')} onClick={()=>{setShowArchive(v=>!v);setSelected(null)}}>📦 {showArchive?'Active':'Archive'}</button>
                {canCreate&&(user.role==='super_admin'?<div style={{fontSize:11,color:'#F59E0B',padding:'6px 10px',background:'rgba(245,158,11,.08)',borderRadius:6}}>🔧 View only</div>:<button className="btn btn-primary" onClick={()=>setShowCreate(true)}><IC n="plus" s={13}/> New Task</button>)}
              </div>
            </div>
            {user.role==='super_admin'&&(
              <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap',alignItems:'center'}}>
                <select className="form-input" value={selectedOrg} onChange={e=>{setSelectedOrg(e.target.value);setOrgSearch('')}} style={{fontSize:13,padding:'6px 10px',minWidth:200}}>
                  <option value="all">🏢 All Organisations ({allOrgs.length})</option>
                  {allOrgs.filter(o=>!orgSearch||o.toLowerCase().includes(orgSearch.toLowerCase())).map(o=><option key={o} value={o}>{o} ({tasks.filter(t=>t.org===o).length})</option>)}
                </select>
                <input className="form-input" placeholder="Search organisations..." value={orgSearch} onChange={e=>setOrgSearch(e.target.value)} style={{fontSize:13,padding:'6px 10px',minWidth:160}}/>
                {selectedOrg!=='all'&&<button className="btn btn-secondary btn-sm" onClick={()=>{setSelectedOrg('all');setOrgSearch('')}}>✕</button>}
              </div>
            )}
          </div>

          {showArchive ? (
            <div className="anim">
              <div className="section">
                <button className="back-btn" style={{marginBottom:10}} onClick={()=>setShowArchive(false)}><IC n="x" s={14}/> Back to Tasks</button>
                <div className="section-title" style={{marginBottom:12}}>📦 Archive — Completed & Approved Tasks</div>
                <div style={{background:'var(--s3)',border:'1px solid var(--border)',borderRadius:10,padding:14,marginBottom:12}}>
                  <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>🔍 Search & Filter</div>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    <input className="form-input" placeholder="Search task name or worker..." value={archiveSearch} onChange={e=>setArchiveSearch(e.target.value)} style={{fontSize:12}}/>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                      <select className="form-input" value={archiveCategory} onChange={e=>setArchiveCategory(e.target.value)} style={{fontSize:12,flex:1,minWidth:130}}>
                        <option value="">All Categories</option>
                        {Object.keys(DEPARTMENTS).map(k=><option key={k} value={k}>{k.replace('_',' ')}</option>)}
                      </select>
                      <select className="form-input" value={archiveWorker} onChange={e=>setArchiveWorker(e.target.value)} style={{fontSize:12,flex:1,minWidth:130}}>
                        <option value="">All Workers</option>
                        {[...new Set(orgFiltered.map(t=>t.assigned_user_name).filter(Boolean))].sort().map(n=><option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <div style={{width:'100%'}}>
                      <div style={{fontSize:10,color:'var(--t2)',fontWeight:600,marginBottom:6}}>📅 DATE RANGE</div>
                      <div style={{display:'flex',gap:6}}>
                        <div onClick={()=>setCalPicking('from')} style={{flex:1,padding:'6px 10px',borderRadius:8,border:'2px solid '+(calPicking==='from'?'var(--brand)':'var(--border)'),background:calPicking==='from'?'var(--brand-lt)':'var(--s3)',cursor:'pointer'}}>
                          <div style={{fontSize:9,color:'var(--t2)',fontWeight:600,textTransform:'uppercase'}}>From</div>
                          <div style={{fontSize:12,fontWeight:700,color:archiveDateFrom?'var(--text)':'var(--t3)',marginTop:1}}>
                            {archiveDateFrom?new Date(archiveDateFrom+'T00:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}):'Tap to set'}
                          </div>
                        </div>
                        <div style={{display:'flex',alignItems:'center',color:'var(--t3)',fontSize:14}}>→</div>
                        <div onClick={()=>setCalPicking('to')} style={{flex:1,padding:'6px 10px',borderRadius:8,border:'2px solid '+(calPicking==='to'?'var(--brand)':'var(--border)'),background:calPicking==='to'?'var(--brand-lt)':'var(--s3)',cursor:'pointer'}}>
                          <div style={{fontSize:9,color:'var(--t2)',fontWeight:600,textTransform:'uppercase'}}>To</div>
                          <div style={{fontSize:12,fontWeight:700,color:archiveDateTo?'var(--text)':'var(--t3)',marginTop:1}}>
                            {archiveDateTo?new Date(archiveDateTo+'T00:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}):'Tap to set'}
                          </div>
                        </div>
                        {(archiveDateFrom||archiveDateTo)&&<button className="btn btn-secondary btn-sm" style={{alignSelf:'center'}} onClick={()=>{setArchiveDateFrom('');setArchiveDateTo('');setCalPicking(null)}}>✕</button>}
                      </div>
                      {calPicking&&(
                        <div style={{position:'fixed',inset:0,zIndex:500,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.4)',backdropFilter:'blur(2px)'}} onClick={()=>setCalPicking(null)}>
                          <div style={{background:'#fff',borderRadius:16,padding:16,width:300,boxShadow:'0 20px 60px rgba(0,0,0,.2)'}} onClick={e=>e.stopPropagation()}>
                            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                              <div style={{fontSize:13,fontWeight:700,color:calPicking==='from'?'var(--brand)':'#8B5CF6'}}>
                                {calPicking==='from'?'📅 Select Start Date':'📅 Select End Date'}
                              </div>
                              <button style={{background:'none',border:'none',cursor:'pointer',fontSize:18,color:'var(--t2)',lineHeight:1}} onClick={()=>setCalPicking(null)}>×</button>
                            </div>
                            <div style={{display:'flex',alignItems:'center',gap:4,marginBottom:10}}>
                              <button style={{background:'none',border:'1px solid var(--border)',borderRadius:6,padding:'3px 8px',cursor:'pointer',fontSize:14,color:'var(--t2)'}} onClick={()=>{if(calMonth===0){setCalMonth(11);setCalYear(y=>y-1)}else setCalMonth(m=>m-1)}}>‹</button>
                              <select value={calMonth} onChange={e=>setCalMonth(+e.target.value)} style={{flex:1,fontSize:12,fontWeight:700,border:'1px solid var(--border)',borderRadius:6,padding:'5px 6px',background:'var(--s3)',cursor:'pointer',outline:'none',fontFamily:'inherit'}}>
                                {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m,i)=><option key={i} value={i}>{m}</option>)}
                              </select>
                              <select value={calYear} onChange={e=>setCalYear(+e.target.value)} style={{fontSize:12,fontWeight:700,border:'1px solid var(--border)',borderRadius:6,padding:'5px 6px',background:'var(--s3)',cursor:'pointer',outline:'none',fontFamily:'inherit',width:72}}>
                                {Array.from({length:10},(_,i)=>new Date().getFullYear()-i).map(y=><option key={y} value={y}>{y}</option>)}
                              </select>
                              <button style={{background:'none',border:'1px solid var(--border)',borderRadius:6,padding:'3px 8px',cursor:'pointer',fontSize:14,color:'var(--t2)'}} onClick={()=>{if(calMonth===11){setCalMonth(0);setCalYear(y=>y+1)}else setCalMonth(m=>m+1)}}>›</button>
                            </div>
                            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2,marginBottom:4,textAlign:'center'}}>
                              {['S','M','T','W','T','F','S'].map((d,i)=><div key={i} style={{fontSize:10,color:'var(--t2)',fontWeight:700,padding:'2px 0'}}>{d}</div>)}
                            </div>
                            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2}}>
                              {Array.from({length:new Date(calYear,calMonth,1).getDay()}).map((_,i)=><div key={'e'+i}/>)}
                              {Array.from({length:new Date(calYear,calMonth+1,0).getDate()},(_,i)=>i+1).map(d=>{
                                const k=new Date(calYear,calMonth,d).toISOString().split('T')[0]
                                const isFr=k===archiveDateFrom, isTo=k===archiveDateTo
                                const inR=archiveDateFrom&&archiveDateTo&&k>archiveDateFrom&&k<archiveDateTo
                                const isDisabled=calPicking==='to'&&archiveDateFrom&&k<archiveDateFrom
                                return (
                                  <div key={d} onClick={()=>{
                                    if(isDisabled) return
                                    if(calPicking==='from'){setArchiveDateFrom(k);setArchiveDateTo('');setCalPicking('to')}
                                    else{setArchiveDateTo(k);setCalPicking(null)}
                                  }} style={{textAlign:'center',padding:'7px 2px',borderRadius:6,fontSize:12,cursor:isDisabled?'default':'pointer',background:isFr||isTo?'var(--brand)':inR?'rgba(0,168,126,.15)':'transparent',color:isFr||isTo?'#fff':isDisabled?'var(--t3)':'var(--text)',fontWeight:isFr||isTo?700:400,opacity:isDisabled?0.3:1,transition:'background .1s'}}>{d}</div>
                                )
                              })}
                            </div>
                            <div style={{marginTop:10,textAlign:'center',fontSize:11,color:calPicking==='from'?'var(--brand)':'#8B5CF6',fontWeight:600}}>
                              {calPicking==='from'?'Tap a day to set start':'Tap a day to set end'}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    {(archiveSearch||archiveCategory||archiveWorker||archiveDateFrom||archiveDateTo)&&(
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 10px',background:'var(--brand-lt)',borderRadius:6,border:'1px solid rgba(0,168,126,.2)'}}>
                        <span style={{fontSize:12,color:'var(--brand)',fontWeight:600}}>✓ Filters active</span>
                        <button className="btn btn-secondary btn-sm" onClick={()=>{setArchiveSearch('');setArchiveCategory('');setArchiveWorker('');setArchiveDateFrom('');setArchiveDateTo('');setCalPicking('from')}}>✕ Clear All</button>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{background:'#fff',border:'1px solid var(--border)',borderRadius:10,padding:14}}>
                  <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>📋 Results</div>
                  {(()=>{
                    const archived=orgFiltered.filter(t=>{
                      if(!['completed','approved','rejected'].includes(t.status)) return false
                      if(archiveSearch&&!t.title?.toLowerCase().includes(archiveSearch.toLowerCase())&&!t.assigned_user_name?.toLowerCase().includes(archiveSearch.toLowerCase())) return false
                      if(archiveCategory&&t.category!==archiveCategory) return false
                      if(archiveWorker&&t.assigned_user_name!==archiveWorker) return false
                      if(archiveDateFrom&&new Date(t.completed_at||t.created_at)<new Date(archiveDateFrom)) return false
                      if(archiveDateTo&&new Date(t.completed_at||t.created_at)>new Date(archiveDateTo+'T23:59:59')) return false
                      return true
                    }).sort((a,b)=>new Date(b.completed_at||b.created_at)-new Date(a.completed_at||a.created_at))
                    const groups={}
                    archived.forEach(t=>{ const dept=t.department||t.category||'General'; if(!groups[dept]) groups[dept]=[]; groups[dept].push(t) })
                    if(archived.length===0) return <div className="empty"><div className="empty-icon">📦</div><div className="empty-text">No archived tasks match your filters</div></div>

                    // Same box structure as active tasks
                    const approved = archived.filter(t=>t.status==='approved')
                    const completed = archived.filter(t=>t.status==='completed')
                    const rejected = archived.filter(t=>t.status==='rejected')
                    const oneOffArchive = archived.filter(t=>isOneOff(t))
                    const recurringArchive = archived.filter(t=>t.recurrence&&t.recurrence!==''&&t.recurrence!=='once')

                    const ArchiveTaskRow = ({t}) => (
                      <div onClick={()=>setSelected(t.id)} style={{padding:'10px 14px',background:'var(--s3)',border:'1px solid var(--border)',borderRadius:8,marginBottom:6,cursor:'pointer',display:'flex',gap:12,alignItems:'flex-start'}}>
                        <div style={{flex:1}}>
                          <div style={{fontWeight:600,fontSize:13,marginBottom:3}}>{t.title}</div>
                          <div style={{fontSize:11,color:'var(--t2)',display:'flex',gap:10,flexWrap:'wrap'}}>
                            <span>👤 {t.assigned_user_name||'—'}</span>
                            {t.completed_at&&<span>✅ {new Date(t.completed_at).toLocaleDateString('en-AU')}</span>}
                            {t.due_date&&<span>📅 {t.due_date}</span>}
                            {t.recurrence&&t.recurrence!=='once'&&<span style={{color:'var(--brand)'}}>🔁 {RECURRENCE_LABELS[t.recurrence]}</span>}
                          </div>
                        </div>
                        <span style={{fontSize:10,padding:'2px 8px',borderRadius:10,fontWeight:600,background:t.status==='approved'?'rgba(16,185,129,.12)':t.status==='rejected'?'rgba(239,68,68,.12)':'var(--s3)',color:t.status==='approved'?'var(--green)':t.status==='rejected'?'var(--red)':'var(--t2)'}}>{t.status.replace('_',' ').toUpperCase()}</span>
                      </div>
                    )

                    return (
                      <div>
                        {/* Rejected box */}
                        {rejected.length>0&&(
                          <div style={{background:'rgba(239,68,68,.04)',border:'1px solid rgba(239,68,68,.2)',borderRadius:12,padding:16,marginBottom:14}}>
                            <div style={{fontSize:11,fontWeight:700,color:'var(--red)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:12}}>⚠️ Rejected ({rejected.length})</div>
                            {rejected.map(t=><ArchiveTaskRow key={t.id} t={t}/>)}
                          </div>
                        )}

                        {/* One-off tasks */}
                        {oneOffArchive.filter(t=>t.status!=='rejected').length>0&&(
                          <div style={{background:'#fff',border:'1px solid var(--border)',borderRadius:12,padding:16,marginBottom:14}}>
                            <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:12}}>📋 One-off Tasks ({oneOffArchive.filter(t=>t.status!=='rejected').length})</div>
                            {oneOffArchive.filter(t=>t.status!=='rejected').map(t=><ArchiveTaskRow key={t.id} t={t}/>)}
                          </div>
                        )}

                        {/* Recurring tasks */}
                        {recurringArchive.filter(t=>t.status!=='rejected').length>0&&(
                          <div style={{background:'rgba(0,168,126,.03)',border:'1px solid rgba(0,168,126,.15)',borderRadius:12,padding:16,marginBottom:14}}>
                            <div style={{fontSize:11,fontWeight:700,color:'var(--brand)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:12}}>🔁 Recurring Tasks ({recurringArchive.filter(t=>t.status!=='rejected').length})</div>
                            {recurringArchive.filter(t=>t.status!=='rejected').map(t=><ArchiveTaskRow key={t.id} t={t}/>)}
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              </div>
            </div>
          ) : (
            <div>
              {/* Filter bar — only show when not on 'all' view */}
              <div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:12,alignItems:'center'}}>
                <span style={{fontSize:10,color:'var(--t2)',fontWeight:600,textTransform:'uppercase',letterSpacing:'.6px',marginRight:2}}>Filter:</span>
                {['all','pending','in_progress','awaiting_review','rejected','overdue','escalated'].map(f=>(
                  <button key={f} className={"fb "+(filter===f?'active':'')} onClick={()=>setFilter(f)}>
                    {f==='all'?'All':(STATUS_CFG[f]?.label||f)} <span style={{opacity:.6}}>({f==='all'?activeFiltered.length:f==='escalated'?activeFiltered.filter(t=>t.escalation).length:activeFiltered.filter(t=>t.status===f).length})</span>
                  </button>
                ))}
              </div>
              {filter!=='all' ? (
                    // Flat list when specific filter selected
                    <div>{filtered.length===0?<div className="empty"><div className="empty-icon">✅</div><div className="empty-text">No tasks here</div></div>:filtered.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}</div>
                  ) : (()=>{
                    const byDate = (a,b) => new Date(a.due_date||'9999')-new Date(b.due_date||'9999')

                    // ── WORKER VIEW ──────────────────────────────────
                    if(user.role==='worker') {
                      const actionNeeded = activeFiltered.filter(t=>t.status==='rejected').sort(byDate)
                      const toDo = activeFiltered.filter(t=>['pending','in_progress','overdue'].includes(t.status)&&isOneOff(t)).sort(byDate)
                      const submitted = activeFiltered.filter(t=>t.status==='awaiting_review').sort(byDate)
                      const recurring = activeFiltered.filter(t=>isRecurring(t)).sort(byDate)
                      return (
                        <div>
                          <div style={{background:'rgba(239,68,68,.04)',border:'1px solid rgba(239,68,68,.2)',borderRadius:12,padding:16,marginBottom:12}}>
                            <div style={{fontSize:11,fontWeight:700,color:'var(--red)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>🔴 Action Needed — Sent Back ({actionNeeded.length})</div>
                            {actionNeeded.length===0?<div style={{fontSize:12,color:'var(--t2)',padding:'6px 0'}}>✅ No rejected tasks</div>:actionNeeded.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}
                          </div>
                          <div style={{background:'#fff',border:'1px solid var(--border)',borderRadius:12,padding:16,marginBottom:12}}>
                            <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>📋 To Do ({toDo.length})</div>
                            {toDo.length===0?<div style={{fontSize:12,color:'var(--t2)',padding:'6px 0'}}>✅ Nothing to do right now</div>:toDo.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}
                          </div>
                          <div style={{background:'rgba(0,168,126,.03)',border:'1px solid rgba(0,168,126,.15)',borderRadius:12,padding:16,marginBottom:12}}>
                            <div style={{fontSize:11,fontWeight:700,color:'var(--brand)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>🔁 Recurring Tasks ({recurring.length})</div>
                            {recurring.length===0?<div style={{fontSize:12,color:'var(--t2)',padding:'6px 0'}}>No recurring tasks assigned</div>:recurring.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}
                          </div>
                          <div style={{background:'rgba(245,158,11,.04)',border:'1px solid rgba(245,158,11,.2)',borderRadius:12,padding:16,marginBottom:12}}>
                            <div style={{fontSize:11,fontWeight:700,color:'#F59E0B',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>⏳ Submitted — Awaiting Review ({submitted.length})</div>
                            {submitted.length===0?<div style={{fontSize:12,color:'var(--t2)',padding:'6px 0'}}>Nothing submitted yet</div>:submitted.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}
                          </div>
                        </div>
                      )
                    }

                    // ── SUPERVISOR VIEW ───────────────────────────────
                    if(user.role==='supervisor') {
                      const needsReview = activeFiltered.filter(t=>t.status==='awaiting_review').sort(byDate)
                      const myTasks = activeFiltered.filter(t=>(t.assigned_user_id===user.id||t.assigned_user_name?.toLowerCase()===user.name?.toLowerCase())&&t.status!=='awaiting_review'&&isOneOff(t)).sort(byDate)
                      const iAssigned = activeFiltered.filter(t=>t.created_by===user.name&&t.assigned_user_name!==user.name).sort(byDate)
                      const oneOff = iAssigned.filter(t=>isOneOff(t))
                      const recurring = activeFiltered.filter(t=>isRecurring(t)).sort(byDate)
                      return (
                        <div>
                          <div style={{background:'rgba(245,158,11,.04)',border:'1px solid rgba(245,158,11,.25)',borderRadius:12,padding:16,marginBottom:12}}>
                            <div style={{fontSize:11,fontWeight:700,color:'#F59E0B',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>🔍 Needs My Review ({needsReview.length})</div>
                            {needsReview.length===0?<div style={{fontSize:12,color:'var(--t2)',padding:'6px 0'}}>✅ Nothing to review</div>:needsReview.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}
                          </div>
                          <div style={{background:'#fff',border:'1px solid var(--border)',borderRadius:12,padding:16,marginBottom:12}}>
                            <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>📋 My Own Tasks ({myTasks.length})</div>
                            {myTasks.length===0?<div style={{fontSize:12,color:'var(--t2)',padding:'6px 0'}}>✅ No tasks assigned to you</div>:myTasks.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}
                          </div>
                          <div style={{background:'#fff',border:'1px solid var(--border)',borderRadius:12,padding:16,marginBottom:12}}>
                            <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>📤 One-off Tasks I Assigned ({oneOff.length})</div>
                            {oneOff.length===0?<div style={{fontSize:12,color:'var(--t2)',padding:'6px 0'}}>No one-off tasks assigned</div>:oneOff.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}
                          </div>
                          <div style={{background:'rgba(0,168,126,.03)',border:'1px solid rgba(0,168,126,.15)',borderRadius:12,padding:16,marginBottom:12}}>
                            <div style={{fontSize:11,fontWeight:700,color:'var(--brand)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>🔁 Recurring Tasks I Assigned ({recurring.length})</div>
                            {recurring.length===0?<div style={{fontSize:12,color:'var(--t2)',padding:'6px 0'}}>No recurring tasks assigned</div>:recurring.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}
                          </div>
                        </div>
                      )
                    }

                    // ── MANAGER VIEW ──────────────────────────────────
                    if(user.role==='manager') {
                      const needsReview = activeFiltered.filter(t=>t.status==='awaiting_review').sort(byDate)
                      const myTasks = activeFiltered.filter(t=>(t.assigned_user_id===user.id||t.assigned_user_name?.toLowerCase()===user.name?.toLowerCase())&&t.status!=='awaiting_review'&&isOneOff(t)).sort(byDate)
                      const iAssigned = activeFiltered.filter(t=>t.created_by===user.name&&t.assigned_user_name!==user.name).sort(byDate)
                      const oneOff = iAssigned.filter(t=>isOneOff(t))
                      const recurring = activeFiltered.filter(t=>isRecurring(t)).sort(byDate)
                      return (
                        <div>
                          <div style={{background:'rgba(245,158,11,.04)',border:'1px solid rgba(245,158,11,.25)',borderRadius:12,padding:16,marginBottom:12}}>
                            <div style={{fontSize:11,fontWeight:700,color:'#F59E0B',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>🔍 Needs My Review ({needsReview.length})</div>
                            {needsReview.length===0?<div style={{fontSize:12,color:'var(--t2)',padding:'6px 0'}}>✅ Nothing to review</div>:needsReview.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}
                          </div>
                          <div style={{background:'#fff',border:'1px solid var(--border)',borderRadius:12,padding:16,marginBottom:12}}>
                            <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>📋 My Own Tasks ({myTasks.length})</div>
                            {myTasks.length===0?<div style={{fontSize:12,color:'var(--t2)',padding:'6px 0'}}>✅ No tasks assigned to you</div>:myTasks.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}
                          </div>
                          <div style={{background:'#fff',border:'1px solid var(--border)',borderRadius:12,padding:16,marginBottom:12}}>
                            <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>📤 One-off Tasks I Assigned ({oneOff.length})</div>
                            {oneOff.length===0?<div style={{fontSize:12,color:'var(--t2)',padding:'6px 0'}}>No one-off tasks assigned</div>:oneOff.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}
                          </div>
                          <div style={{background:'rgba(0,168,126,.03)',border:'1px solid rgba(0,168,126,.15)',borderRadius:12,padding:16,marginBottom:12}}>
                            <div style={{fontSize:11,fontWeight:700,color:'var(--brand)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>🔁 Recurring Tasks I Assigned ({recurring.length})</div>
                            {recurring.length===0?<div style={{fontSize:12,color:'var(--t2)',padding:'6px 0'}}>No recurring tasks assigned</div>:recurring.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}
                          </div>
                        </div>
                      )
                    }

                    // ── CLIENT ADMIN VIEW ─────────────────────────────
                    const needsReview = activeFiltered.filter(t=>t.status==='awaiting_review').sort(byDate)
                    const attention = activeFiltered.filter(t=>['overdue','escalated'].includes(t.status)||t.escalation).sort(byDate)
                    const iAssigned = activeFiltered.filter(t=>t.created_by===user.name).sort(byDate)
                    const assignedToMgr = iAssigned.filter(t=>t.assigned_role==='manager'||teamUsers.find(u=>u.id===t.assigned_user_id)?.role==='manager')
                    const assignedToSup = iAssigned.filter(t=>t.assigned_role==='supervisor'||teamUsers.find(u=>u.id===t.assigned_user_id)?.role==='supervisor')
                    const assignedToWkr = iAssigned.filter(t=>t.assigned_role==='worker'||teamUsers.find(u=>u.id===t.assigned_user_id)?.role==='worker')
                    const oneOffAll = activeFiltered.filter(t=>isOneOff(t)).filter(t=>t.status!=='awaiting_review'&&!['overdue','escalated'].includes(t.status)&&!t.escalation).sort(byDate)
                    const recurringAll = activeFiltered.filter(t=>isRecurring(t)).filter(t=>t.status!=='awaiting_review'&&!['overdue','escalated'].includes(t.status)&&!t.escalation).sort(byDate)
                    return (
                      <div>
                        <div style={{background:'rgba(245,158,11,.04)',border:'1px solid rgba(245,158,11,.25)',borderRadius:12,padding:16,marginBottom:12}}>
                          <div style={{fontSize:11,fontWeight:700,color:'#F59E0B',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>🔍 Needs My Review ({needsReview.length})</div>
                          {needsReview.length===0?<div style={{fontSize:12,color:'var(--t2)',padding:'6px 0'}}>✅ Nothing to review</div>:needsReview.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}
                        </div>
                        {attention.length>0&&(
                          <div style={{background:'rgba(239,68,68,.04)',border:'1px solid rgba(239,68,68,.2)',borderRadius:12,padding:16,marginBottom:12}}>
                            <div style={{fontSize:11,fontWeight:700,color:'var(--red)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>⚠️ Needs Attention — Overdue & Escalated ({attention.length})</div>
                            {attention.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}
                          </div>
                        )}
                        <div style={{background:'#fff',border:'1px solid var(--border)',borderRadius:12,padding:16,marginBottom:12}}>
                          <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>📤 Tasks I Assigned ({iAssigned.length})</div>
                          {iAssigned.length===0?<div style={{fontSize:12,color:'var(--t2)',padding:'6px 0'}}>No tasks assigned by you</div>:(
                            <div>
                              {assignedToMgr.length>0&&<div style={{marginBottom:10}}><div style={{fontSize:10,color:'var(--t2)',fontWeight:600,marginBottom:6,display:'flex',alignItems:'center',gap:6}}><span style={{width:8,height:8,borderRadius:'50%',background:'#3B82F6',display:'inline-block'}}/> To Managers ({assignedToMgr.length})</div>{assignedToMgr.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}</div>}
                              {assignedToSup.length>0&&<div style={{marginBottom:10}}><div style={{fontSize:10,color:'var(--t2)',fontWeight:600,marginBottom:6,display:'flex',alignItems:'center',gap:6}}><span style={{width:8,height:8,borderRadius:'50%',background:'#10B981',display:'inline-block'}}/> To Supervisors ({assignedToSup.length})</div>{assignedToSup.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}</div>}
                              {assignedToWkr.length>0&&<div><div style={{fontSize:10,color:'var(--t2)',fontWeight:600,marginBottom:6,display:'flex',alignItems:'center',gap:6}}><span style={{width:8,height:8,borderRadius:'50%',background:'#6B7280',display:'inline-block'}}/> To Workers ({assignedToWkr.length})</div>{assignedToWkr.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}</div>}
                            </div>
                          )}
                        </div>
                        <div style={{background:'#fff',border:'1px solid var(--border)',borderRadius:12,padding:16,marginBottom:12}}>
                          <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>📋 One-off Tasks ({oneOffAll.length})</div>
                          {oneOffAll.length===0?<div style={{fontSize:12,color:'var(--t2)',padding:'6px 0'}}>✅ No one-off tasks · <span style={{color:'var(--brand)',cursor:'pointer'}} onClick={()=>setShowArchive(true)}>View Archive</span></div>:oneOffAll.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}
                        </div>
                        <div style={{background:'rgba(0,168,126,.03)',border:'1px solid rgba(0,168,126,.15)',borderRadius:12,padding:16,marginBottom:12}}>
                          <div style={{fontSize:11,fontWeight:700,color:'var(--brand)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>🔁 Recurring Tasks ({recurringAll.length})</div>
                          {recurringAll.length===0?<div style={{fontSize:12,color:'var(--t2)',padding:'6px 0'}}>✅ No recurring tasks</div>:recurringAll.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}
                        </div>
                      </div>
                    )
                  })()}
            </div>
          )}
        </div>
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
  const [orgLogo, setOrgLogo] = useState(null)
  const DEFAULT_STAT_ORDER = [
    {id:'total',l:'Total Tasks',v:()=>total,c:'b'},
    {id:'done',l:'Completed',v:()=>done,c:'g'},
    {id:'notdone',l:'Not Completed',v:()=>total-done,c:'a'},
    {id:'overdue',l:'Overdue',v:()=>overdue,c:'r'},
    {id:'compliance',l:'Compliance Rate',v:()=>pct(compDone,compT.length)+'%',c:'p'},
    {id:'toreview',l:'Total for Review',v:()=>totalToReview,c:'b'},
    {id:'reviewed',l:'Reviewed',v:()=>reviewed,c:'g'},
    {id:'pending',l:'Pending Reviews',v:()=>pendingReview,c:'a'},
    {id:'reviewtime',l:'Reviewed in Time',v:()=>reviewedInTimePct+'%',c:'p'},
    {id:'sameday',l:'Tasks Done Same Day',v:()=>doneOnDayPct+'%',c:'g'},
    {id:'empty1',l:'',v:()=>'',c:'x'},
    {id:'reporttime',l:'Report Reviewed in Time',v:()=>reportWithinWeekPct+'%',c:'g'},
    {id:'empty2',l:'',v:()=>'',c:'x'},
  ]
  const [statOrder, setStatOrder] = useState(DEFAULT_STAT_ORDER)
  const [dragStatId, setDragStatId] = useState(null)
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

  useEffect(()=>{
    setOrgLogo(null) // reset on org change
    if(isConfigured() && user.org && user.role!=='super_admin') {
      supabase.from('organisations').select('logo').eq('name', user.org).single()
        .then(({data})=>{ if(data?.logo) setOrgLogo(data.logo) })
        .catch(()=>{})
    }
  },[user.org])

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
  ptFiltered.forEach(t => {
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

  const baseStyle = `*{box-sizing:border-box}body{font-family:Helvetica Neue,sans-serif;padding:40px;color:#1a2033;font-size:13px}.hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:16px;border-bottom:2px solid #000000}.lt{font-size:24px;font-weight:800;color:#2D3180}.ri{text-align:right;font-size:11px;color:#5a6478}.ri strong{display:block;font-size:14px;color:#1a2033;margin-bottom:2px}.sg{display:grid;gap:12px;margin-bottom:24px}.st{background:#f4f6f9;border-radius:8px;padding:14px;text-align:center}.sv{font-size:22px;font-weight:800;color:#5BC8C0;line-height:1}.sv.r{color:#EF4444}.sv.g{color:#10B981}.sv.a{color:#F59E0B}.sl{font-size:10px;color:#5a6478;margin-top:5px;text-transform:uppercase}table{width:100%;border-collapse:collapse;font-size:11px}th{text-align:left;padding:7px 8px;background:#f4f6f9;font-size:9px;text-transform:uppercase;color:#5a6478;border-bottom:1px solid #e8ebf0}td{padding:7px 8px;border-bottom:1px solid #f0f2f5}.ft{margin-top:28px;padding-top:14px;border-top:1px solid #e8ebf0;font-size:10px;color:#9aa3b2;display:flex;justify-content:space-between}.sec{margin-bottom:24px}.sec-title{font-size:13px;font-weight:700;color:#2D3180;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #e8ebf0}`

  const reportHeader = (title) => {
    const orgName = user.role==='super_admin' ? 'Taksyn' : (user.org||'My Organisation')
    const logoImg = user.role==='super_admin'
      ? '<img src="https://taksyn.vercel.app/logo.jpeg" height="64" style="object-fit:contain;border-radius:6px"/>'
      : orgLogo
        ? '<img src="'+orgLogo+'" height="64" style="object-fit:contain;border-radius:6px"/>'
        : ''
    return '<div class="hdr"><div>'+logoImg+'</div><div class="ri"><strong>'+title+'</strong><strong>'+orgName+'</strong><br/>Period: '+pl+'<br/>Generated: '+new Date().toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'})+'</div></div>'
  }
  const reportFooter = `<div class="ft"><span>Taksyn — Task Compliance & Accountability Platform</span><span>taksyn.vercel.app</span></div>`

  const openReport = (html) => {
    const w = window.open('','_blank')
    if (w) { w.document.write(html); w.document.close(); setTimeout(()=>w.print(),800) }
    else { const a=document.createElement('a'); a.href='data:text/html;charset=utf-8,'+encodeURIComponent(html); a.download='taksyn-report.html'; a.click() }
  }

  const exportCompliancePDF = () => {
    const rows = pt.map(t=>'<tr><td>'+t.id+'</td><td><strong>'+t.title+'</strong></td><td>'+t.category+'</td><td style="color:'+(t.status==='approved'?'#10B981':t.status==='rejected'?'#EF4444':'#1a2033')+'">'+t.status.replace('_',' ').toUpperCase()+'</td><td>'+(t.compliance?'✓ Yes':'—')+'</td><td>'+(t.due_date||'—')+'</td><td>'+(t.completed_at?new Date(t.completed_at).toLocaleDateString():'—')+'</td><td>'+(fmtDur(t.started_at,t.completed_at))+'</td><td>'+(t.assigned_user_name||ROLE_LABELS[t.assigned_role]||'—')+'</td></tr>').join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Taksyn Compliance Report</title><style>${baseStyle}.sg{grid-template-columns:repeat(5,1fr)}</style></head><body>${reportHeader('Compliance Report')}<div class="sg">${statOrder.map(s=>{
        if(s.c==='x') return '<div class="st" style="background:transparent;border:1px dashed #e8ebf0"></div>'
        const colorMap={g:'#10B981',r:'#EF4444',a:'#F59E0B',p:'#8B5CF6',b:'#3B82F6'}
        const col=colorMap[s.c]||'#5BC8C0'
        return '<div class="st"><div class="sv" style="color:'+col+'">'+s.v()+'</div><div class="sl">'+s.l+'</div></div>'
      }).join('')}</div><table><thead><tr><th>ID</th><th>Task</th><th>Category</th><th>Status</th><th>Compliance</th><th>Due Date</th><th>Completed</th><th>Duration</th><th>Assigned To</th></tr></thead><tbody>${rows}</tbody></table>${reportFooter}</body></html>`
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
            <div style={{fontSize:10,color:'var(--t2)',marginBottom:6,marginTop:10}}>✋ Drag blocks to rearrange — order is reflected in the PDF report</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(110px,1fr))',gap:10}}>
              {statOrder.map((s,i)=>{
                const c=s.c, v=s.v(), l=s.l
                return (
                  <div key={s.id}
                    draggable={c!=='x'}
                    onDragStart={()=>setDragStatId(s.id)}
                    onDragOver={e=>e.preventDefault()}
                    onDrop={()=>{
                      if(!dragStatId||dragStatId===s.id) return
                      setStatOrder(prev=>{
                        const arr=[...prev]
                        const fromIdx=arr.findIndex(x=>x.id===dragStatId)
                        const toIdx=arr.findIndex(x=>x.id===s.id)
                        const [moved]=arr.splice(fromIdx,1)
                        arr.splice(toIdx,0,moved)
                        return arr
                      })
                      setDragStatId(null)
                    }}
                    style={{
                      background:c==='x'?'transparent':dragStatId===s.id?'var(--brand-lt)':'var(--s3)',
                      border:c==='x'?'1px dashed var(--border)':dragStatId===s.id?'2px solid var(--brand)':'1px solid transparent',
                      borderRadius:8,padding:12,textAlign:'center',
                      cursor:c!=='x'?'grab':'default',
                      opacity:dragStatId===s.id?0.5:1,
                      transition:'all .15s',userSelect:'none'
                    }}>
                    <div style={{fontSize:20,fontWeight:800,lineHeight:1,color:c==='g'?'var(--green)':c==='r'?'var(--red)':c==='a'?'#F59E0B':c==='p'?'#8B5CF6':c==='b'?'#3B82F6':c==='x'?'transparent':'#5BC8C0'}}>{c!=='x'?v:''}</div>
                    <div style={{fontSize:10,color:'var(--t2)',marginTop:4,textTransform:'uppercase'}}>{c!=='x'?l:''}</div>
                  </div>
                )
              })}
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',marginTop:8}}>
              <button className="btn btn-secondary btn-sm" style={{fontSize:11}} onClick={()=>setStatOrder(DEFAULT_STAT_ORDER)}>↺ Reset Order</button>
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
  const [inviteIndustry, setInviteIndustry] = useState('')
  const [inviteDept, setInviteDept] = useState('')
  const [inviteCustomDept, setInviteCustomDept] = useState('')
  const [realUsers, setRealUsers] = useState([])
  const [editingUser, setEditingUser] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [editCustomDept, setEditCustomDept] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [collapsedRoles, setCollapsedRoles] = useState({})
  const [orgCustomDepts, setOrgCustomDepts] = useState([])

  useEffect(()=>{
    if(isConfigured()&&user.org) {
      supabase.from('organisations').select('custom_departments').eq('name',user.org).single()
        .then(({data})=>{ if(data?.custom_departments) setOrgCustomDepts(JSON.parse(data.custom_departments||'[]')) })
        .catch(()=>{})
    }
  },[user.org])

  useEffect(()=>{
    if(!isConfigured()) return
    if(user.role==='super_admin') {
      supabase.from('profiles').select('*').then(({data})=>{ if(data) setRealUsers(data) })
    } else {
      // Load members from org_members joined with profiles
      supabase.from('org_members').select('user_id, role, org, tier').eq('org', user.org)
        .then(async ({data:members, error:err1})=>{
          if(!members?.length) return
          // Build user list from org_members data directly
          // Also try to get profile details
          const ids = members.map(m=>m.user_id)
          const {data:profiles} = await supabase.from('profiles').select('*').in('id', ids)
          const merged = members.map(m=>{
            const p = profiles?.find(p=>p.id===m.user_id) || {}
            return {...p, id:m.user_id, role:m.role, org:m.org, tier:m.tier}
          })
          setRealUsers(merged)
        })
    }
  },[])

  const deleteUser = async (id) => {
    if (!confirm('Remove this user from your organisation?')) return
    if(isConfigured()) {
      // Remove from org_members for this org only — preserves their account in other orgs
      await supabase.from('org_members').delete().eq('user_id',id).eq('org',user.org)
    }
    setRealUsers(prev=>prev.filter(u=>u.id!==id))
  }

  const saveEditUser = async () => {
    if (!editForm.name?.trim()) return
    const { id } = editingUser
    const finalDept = editForm.department==='__custom__' ? editCustomDept.trim() : editForm.department||''
    const updates = {
      name: editForm.name.trim(),
      role: editForm.role,
      department: finalDept,
      industry: editForm.industry||'',
      phone: editForm.phone||'',
      notes: editForm.notes||'',
      email: editForm.email||''
    }
    // Save custom dept to org
    if (editForm.department==='__custom__' && editCustomDept.trim() && editForm.industry && isConfigured()) {
      const newDept = {name:editCustomDept.trim(),industry:editForm.industry}
      const updatedDepts = [...orgCustomDepts, newDept]
      setOrgCustomDepts(updatedDepts)
      supabase.from('organisations').update({custom_departments:JSON.stringify(updatedDepts)}).eq('name',user.org).then(()=>{})
    }
    if (isConfigured()) {
      await supabase.from('profiles').update(updates).eq('id', id)
      await supabase.from('org_members').update({ role: editForm.role }).eq('user_id', id).eq('org', user.org)
    }
    setRealUsers(prev=>prev.map(u=>u.id===id?{...u,...updates}:u))
    setEditingUser(null)
    setEditForm({})
    setEditCustomDept('')
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
        body: JSON.stringify({ email: inviteEmail.trim(), name: inviteName.trim(), role: inviteRole, org: targetOrg, industry: inviteIndustry, department: inviteDept==='__custom__'?inviteCustomDept:inviteDept, secret: import.meta.env.VITE_INVITE_SECRET || '' })
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error||result.message||'Invite failed ('+res.status+')')
      alert('Invite sent to '+inviteEmail+'!')
      // Save custom department to org if added
      if(inviteDept==='__custom__'&&inviteCustomDept.trim()&&inviteIndustry&&isConfigured()) {
        const newDept = {name:inviteCustomDept.trim(),industry:inviteIndustry}
        const updatedDepts = [...orgCustomDepts,newDept]
        setOrgCustomDepts(updatedDepts)
        supabase.from('organisations').update({custom_departments:JSON.stringify(updatedDepts)}).eq('name',targetOrg).then(()=>{})
      }
      setShowInvite(false); setInviteEmail(''); setInviteName(''); setInviteRole('worker'); setInviteOrg(''); setInviteIndustry(''); setInviteDept(''); setInviteCustomDept('')
    } catch(e) {
      alert('Failed to send invite: '+e.message)
    }
  }

  return (
    <div className="anim">
      {editingUser&&(
        <div className="modal-overlay" onClick={()=>{ setEditingUser(null); setEditForm({}) }}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr">
              <div className="modal-title">Edit Team Member</div>
              <button className="modal-close" onClick={()=>{ setEditingUser(null); setEditForm({}) }}>×</button>
            </div>
            <div className="modal-body">
              <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16,padding:'10px 14px',background:'var(--s3)',borderRadius:8}}>
                <Avatar name={editingUser.name} role={editingUser.role} size={44} avatarUrl={editingUser.avatar_url}/>
                <div>
                  <div style={{fontWeight:700,fontSize:14}}>{editingUser.name}</div>
                  <div style={{fontSize:12,color:'var(--t2)',marginTop:2}}>{editingUser.email||'—'}</div>
                  <div style={{marginTop:4}}><RolePill role={editingUser.role}/></div>
                </div>
              </div>
              <div className="two-col">
                <div className="form-field">
                  <label className="form-label">Full Name</label>
                  <input className="form-input" value={editForm.name||''} onChange={e=>setEditForm({...editForm,name:e.target.value})}/>
                </div>
                <div className="form-field">
                  <label className="form-label">Phone</label>
                  <input className="form-input" value={editForm.phone||''} onChange={e=>setEditForm({...editForm,phone:e.target.value})} placeholder="e.g. +61 400 000 000"/>
                </div>
              </div>
              <div className="form-field">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" value={editForm.email||''} onChange={e=>setEditForm({...editForm,email:e.target.value})} placeholder="email@example.com"/>
                <div style={{fontSize:10,color:'var(--t2)',marginTop:3}}>Updates the display email — user must change their own login email via Profile</div>
              </div>
              <div className="form-field">
                <label className="form-label">Role</label>
                <select className="form-input" value={editForm.role||'worker'} onChange={e=>setEditForm({...editForm,role:e.target.value})}>
                  {ROLES.filter(r=>r!=='super_admin').map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <div className="two-col">
                <div className="form-field">
                  <label className="form-label">Industry</label>
                  <select className="form-input" value={editForm.industry||''} onChange={e=>setEditForm({...editForm,industry:e.target.value,department:''})}>
                    <option value="">— Select industry —</option>
                    {Object.keys(DEPARTMENTS).map(k=><option key={k} value={k}>{k.replace('_',' ')}</option>)}
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">Department / Position</label>
                  <select className="form-input" value={editForm.department||''} onChange={e=>setEditForm({...editForm,department:e.target.value})}>
                    <option value="">— Select department —</option>
                    {[...(DEPARTMENTS[editForm.industry||'General']||DEPARTMENTS.General),...orgCustomDepts.filter(d=>d.industry===(editForm.industry||'General')).map(d=>d.name)].map(d=><option key={d} value={d}>{d}</option>)}
                    <option value="__custom__">+ Add custom position...</option>
                  </select>
                </div>
              </div>
              {editForm.department==='__custom__'&&<div className="form-field">
                <label className="form-label">Custom Position</label>
                <input className="form-input" value={editCustomDept} onChange={e=>setEditCustomDept(e.target.value)} placeholder="e.g. Night Shift Supervisor"/>
              </div>}
              <div className="form-field">
                <label className="form-label">Notes</label>
                <textarea className="comment-box" style={{minHeight:60}} value={editForm.notes||''} onChange={e=>setEditForm({...editForm,notes:e.target.value})} placeholder="Any notes about this team member..."/>
              </div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
                <button className="btn btn-secondary" onClick={()=>{ setEditingUser(null); setEditForm({}) }}>Cancel</button>
                <button className="btn btn-primary" disabled={!editForm.name?.trim()} onClick={saveEditUser}>Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showInvite&&(
        <div className="modal-overlay" onClick={()=>setShowInvite(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr"><div className="modal-title">Invite Team Member</div><button className="modal-close" onClick={()=>setShowInvite(false)}>×</button></div>
            <div className="modal-body">
              <div className="form-field"><label className="form-label">Full Name</label><input className="form-input" value={inviteName} onChange={e=>setInviteName(e.target.value)} placeholder="Emma Wilson"/></div>
              <div className="form-field"><label className="form-label">Email Address</label><input className="form-input" type="email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="emma@yourorg.com"/></div>
              <div className="form-field"><label className="form-label">Role</label><select className="form-select" value={inviteRole} onChange={e=>setInviteRole(e.target.value)}>{ROLES.filter(r=>r!=='super_admin').map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></div>
              {user.role==='super_admin'&&<div className="form-field"><label className="form-label">Organisation <span style={{color:'var(--red)'}}>*</span></label><input className="form-input" value={inviteOrg} onChange={e=>setInviteOrg(e.target.value)} placeholder="Exact organisation name"/></div>}
              <div className="form-field"><label className="form-label">Industry</label><select className="form-input" value={inviteIndustry} onChange={e=>{setInviteIndustry(e.target.value);setInviteDept('');setInviteCustomDept('')}}><option value="">— Select industry —</option>{Object.keys(DEPARTMENTS).map(k=><option key={k} value={k}>{k.replace('_',' ')}</option>)}</select></div>
              {inviteIndustry&&<div className="form-field"><label className="form-label">Department / Position</label><select className="form-input" value={inviteDept} onChange={e=>setInviteDept(e.target.value)}><option value="">— Select department —</option>{[...(DEPARTMENTS[inviteIndustry]||[]),...orgCustomDepts.filter(d=>d.industry===inviteIndustry).map(d=>d.name)].map(d=><option key={d} value={d}>{d}</option>)}<option value="__custom__">+ Add custom position...</option></select></div>}
              {inviteDept==='__custom__'&&<div className="form-field"><label className="form-label">Custom Position <span style={{fontSize:10,color:'var(--t2)'}}>— will be saved to this org</span></label><input className="form-input" value={inviteCustomDept} onChange={e=>setInviteCustomDept(e.target.value)} placeholder="e.g. Night Shift Supervisor"/></div>}
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
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div className="section-title" style={{margin:0}}>Active Users ({realUsers.length})</div>
          <input className="form-input" placeholder="Search by name or role..." value={userSearch} onChange={e=>setUserSearch(e.target.value)} style={{fontSize:12,padding:'5px 10px',maxWidth:220}}/>
        </div>
        {realUsers.length===0
          ? <div style={{fontSize:13,color:'var(--t2)'}}>No users yet. Invite staff or ask them to sign up at taksyn.vercel.app</div>
          : (() => {
              const filtered = [...realUsers]
                .filter(u=>!userSearch||u.name?.toLowerCase().includes(userSearch.toLowerCase())||u.role?.toLowerCase().includes(userSearch.toLowerCase()))
                .sort((a,b)=>(a.name||'').localeCompare(b.name||''))
              const groups = {}
              filtered.forEach(u=>{ const r=u.role||'worker'; if(!groups[r]) groups[r]=[]; groups[r].push(u) })
              const roleOrder = ['client_admin','manager','supervisor','worker']
              return roleOrder.filter(r=>groups[r]?.length).map(role=>(
                <div key={role} style={{marginBottom:12}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px',background:'var(--s3)',borderRadius:8,cursor:'pointer',marginBottom:6}} onClick={()=>setCollapsedRoles(prev=>({...prev,[role]:!prev[role]}))}>
                    <span style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.6px',flex:1}}>{ROLE_LABELS[role]} ({groups[role].length})</span>
                    <span style={{fontSize:12,color:'var(--t2)'}}>{collapsedRoles[role]?'▶':'▼'}</span>
                  </div>
                  {!collapsedRoles[role]&&groups[role].map((u,i)=>(
            <div key={i} className="user-row" style={{flexWrap:'wrap',gap:8}}>
              <Avatar name={u.name} role={u.role} size={34} avatarUrl={u.avatar_url}/>
              <div className="user-info" style={{flex:1}}>
                <div className="user-name">{u.name}</div>
                <div className="user-email">{u.email||'—'}</div>
                {u.department&&<div style={{fontSize:10,color:'var(--t2)',marginTop:1}}>🏢 {u.department}</div>}
              </div>
              <RolePill role={u.role}/>
              {['client_admin','super_admin'].includes(user.role)&&<button className="btn btn-secondary btn-sm" onClick={()=>{ setEditingUser(u); setEditForm({name:u.name,role:u.role,department:u.department||'',industry:u.industry||'',phone:u.phone||'',notes:u.notes||'',email:u.email||''}) }}>✏️ Edit</button>}
              {['client_admin','super_admin'].includes(user.role)&&<button className="btn btn-danger btn-sm" onClick={()=>deleteUser(u.id)}>Remove</button>}
            </div>
          ))}
        </div>
      ))
    })()
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
  super_admin:  [['dashboard','Dashboard','home'],['orgs','Organisations','users'],['tasks','Task Stats','tasks'],['escalations','Escalations','alert'],['reports','Reports','chart'],['audit','Audit Log','audit'],['users','Team','users'],['tiers','Plans','tier'],['support','Support','alert']],
  client_admin: [['dashboard','Dashboard','home'],['tasks','Tasks','tasks'],['escalations','Escalations','alert'],['reports','Reports','chart'],['audit','Audit Log','audit'],['users','Team','users'],['teams','Teams','users'],['projects','Projects 🔜','tasks'],['leave','Team Leave','clock'],['performance','Performance','chart'],['sla','SLA Settings','clock'],['tiers','Plans','tier'],['help','Help & Support','alert']],
  manager:      [['dashboard','Dashboard','home'],['tasks','Tasks','tasks'],['escalations','Escalations','alert'],['reports','Reports','chart'],['audit','Audit Log','audit'],['projects','Projects 🔜','tasks'],['teams','My Teams','users'],['leave','Leave','clock'],['help','Help & Support','alert']],
  supervisor:   [['dashboard','Dashboard','home'],['tasks','Tasks','tasks'],['escalations','Escalations','alert'],['audit','Audit Log','audit'],['projects','Projects 🔜','tasks'],['teams','My Teams','users'],['leave','Leave','clock'],['help','Help & Support','alert']],
  worker:       [['dashboard','Today','home'],['tasks','My Tasks','tasks'],['leave','My Leave','clock'],['help','Help & Support','alert']],
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
  const [dragOver, setDragOver] = useState(null)
  const [selectedOrgView, setSelectedOrgView] = useState(null) // org being viewed
  const [orgMembers, setOrgMembers] = useState([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [viewingMember, setViewingMember] = useState(null)
  const [editingMember, setEditingMember] = useState(null)
  const [memberEditForm, setMemberEditForm] = useState({})

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

  const loadOrgMembers = async (orgName) => {
    setLoadingMembers(true)
    const { data: members } = await supabase.from('org_members').select('user_id, role, org, tier').eq('org', orgName)
    if (members?.length) {
      const ids = members.map(m=>m.user_id)
      const { data: profiles } = await supabase.from('profiles').select('*').in('id', ids)
      const merged = members.map(m=>{ const p=profiles?.find(p=>p.id===m.user_id)||{}; return {...p,id:m.user_id,role:m.role,org:m.org,tier:m.tier,email:p.email||''} })
      setOrgMembers(merged)
    } else { setOrgMembers([]) }
    setLoadingMembers(false)
  }

  const saveMemberEdit = async () => {
    if (!memberEditForm.name?.trim()) return
    const updates = { name:memberEditForm.name.trim(), role:memberEditForm.role, department:memberEditForm.department||'', industry:memberEditForm.industry||'', phone:memberEditForm.phone||'', notes:memberEditForm.notes||'', email:memberEditForm.email||'' }
    if (isConfigured()) {
      await supabase.from('profiles').update(updates).eq('id', editingMember.id)
      await supabase.from('org_members').update({ role: memberEditForm.role }).eq('user_id', editingMember.id).eq('org', editingMember.org)
    }
    setOrgMembers(prev=>prev.map(m=>m.id===editingMember.id?{...m,...updates}:m))
    setViewingMember(prev=>prev?{...prev,...updates}:null)
    setEditingMember(null); setMemberEditForm({})
  }

  const toggleStatus = async (org) => {
    const newStatus = org.status==='active' ? 'inactive' : 'active'
    if (!confirm((newStatus==='inactive'?'Deactivate':'Reactivate')+' '+org.name+'?')) return
    await supabase.from('organisations').update({status:newStatus}).eq('id',org.id)
    setOrgs(prev=>prev.map(o=>o.id===org.id?{...o,status:newStatus}:o))
  }

  const uploadOrgLogo = async (orgId, file) => {
    const r = new FileReader()
    r.onload = async ev => {
      const logoData = ev.target.result
      await supabase.from('organisations').update({logo:logoData}).eq('id',orgId)
      // Also update all profiles in that org so their reports use the new logo
      await supabase.from('profiles').update({avatar_url:logoData}).eq('org', orgs.find(o=>o.id===orgId)?.name)
      setOrgs(prev=>prev.map(o=>o.id===orgId?{...o,logo:logoData}:o))
    }
    r.readAsDataURL(file)
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
                    {org.logo&&<img src={org.logo} alt={org.name} style={{height:32,objectFit:'contain',borderRadius:4,border:'1px solid var(--border)'}}/>}
                    <div style={{fontWeight:700,fontSize:15,cursor:'pointer',color:'var(--brand)',textDecoration:'underline'}} onClick={()=>{ setSelectedOrgView(org); loadOrgMembers(org.name) }}>{org.name}</div>
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
                  <label
                    style={{
                      display:'flex',alignItems:'center',justifyContent:'center',
                      gap:6,padding:'5px 10px',borderRadius:6,fontSize:12,fontWeight:600,
                      cursor:'pointer',transition:'all .15s',
                      border:'2px dashed '+(dragOver===org.id?'var(--brand)':'var(--border)'),
                      background:dragOver===org.id?'var(--brand-lt)':'var(--s3)',
                      color:dragOver===org.id?'var(--brand)':'var(--t2)',
                      minWidth:80,textAlign:'center'
                    }}
                    onDragOver={e=>{ e.preventDefault(); setDragOver(org.id) }}
                    onDragLeave={()=>setDragOver(null)}
                    onDrop={e=>{ e.preventDefault(); setDragOver(null); const f=e.dataTransfer.files[0]; if(f&&f.type.startsWith('image/')) uploadOrgLogo(org.id,f) }}
                  >
                    {org.logo ? '🖼 Update Logo' : '🖼 Add Logo'}
                    <input type="file" accept="image/*" style={{display:'none'}} onChange={e=>{ const f=e.target.files[0]; if(f) uploadOrgLogo(org.id,f); e.target.value='' }}/>
                  </label>
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

      {/* Org Members Modal */}
      {selectedOrgView&&(
        <div className="modal-overlay" onClick={()=>setSelectedOrgView(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:560}}>
            <div className="modal-hdr">
              <div>
                <div className="modal-title">👥 {selectedOrgView.name}</div>
                <div style={{fontSize:11,color:'var(--t2)',marginTop:2}}>{selectedOrgView.industry||'—'} · {selectedOrgView.tier}</div>
              </div>
              <button className="modal-close" onClick={()=>setSelectedOrgView(null)}>×</button>
            </div>
            <div className="modal-body">
              {loadingMembers ? <div style={{textAlign:'center',padding:20,color:'var(--t2)'}}>Loading members...</div> :
              orgMembers.length===0 ? <div className="empty"><div className="empty-icon">👥</div><div className="empty-text">No members yet</div></div> :
              <div>
                {Object.entries(orgMembers.reduce((g,m)=>{ const r=m.role||'worker'; if(!g[r]) g[r]=[]; g[r].push(m); return g },{})).sort(([a],[b])=>['client_admin','manager','supervisor','worker'].indexOf(a)-['client_admin','manager','supervisor','worker'].indexOf(b)).map(([role,members])=>(
                  <div key={role} style={{marginBottom:14}}>
                    <div style={{fontSize:10,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:8,paddingBottom:4,borderBottom:'1px solid var(--border)'}}>{ROLE_LABELS[role]} ({members.length})</div>
                    {members.map((m,i)=>(
                      <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid var(--border)',cursor:'pointer'}} onClick={()=>setViewingMember(m)}>
                        <Avatar name={m.name||'?'} role={m.role} size={36} avatarUrl={m.avatar_url}/>
                        <div style={{flex:1}}>
                          <div style={{fontWeight:600,fontSize:13}}>{m.name||'—'}</div>
                          <div style={{fontSize:11,color:'var(--t2)'}}>{m.email||'—'}</div>
                          {m.department&&<div style={{fontSize:10,color:'var(--t2)',marginTop:1}}>🏢 {m.department}</div>}
                        </div>
                        <RolePill role={m.role}/>
                        <button className="btn btn-secondary btn-sm" onClick={e=>{e.stopPropagation();setEditingMember(m);setMemberEditForm({name:m.name,role:m.role,department:m.department||'',industry:m.industry||'',phone:m.phone||'',notes:m.notes||'',email:m.email||''})}}>✏️</button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>}
            </div>
          </div>
        </div>
      )}

      {/* View Member Profile Modal */}
      {viewingMember&&(
        <div className="modal-overlay" onClick={()=>setViewingMember(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr"><div className="modal-title">👤 Member Profile</div><button className="modal-close" onClick={()=>setViewingMember(null)}>×</button></div>
            <div className="modal-body">
              <div style={{display:'flex',alignItems:'center',gap:14,padding:'12px 0 16px',borderBottom:'1px solid var(--border)',marginBottom:16}}>
                <Avatar name={viewingMember.name||'?'} role={viewingMember.role} size={56} avatarUrl={viewingMember.avatar_url}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:16,fontWeight:800}}>{viewingMember.name||'—'}</div>
                  <div style={{fontSize:12,color:'var(--t2)',marginTop:2}}>{viewingMember.email||'—'}</div>
                  <div style={{marginTop:6,display:'flex',gap:6,flexWrap:'wrap'}}><RolePill role={viewingMember.role}/>{viewingMember.tier&&<span style={{fontSize:11,padding:'2px 8px',borderRadius:10,background:'var(--s3)',color:'var(--t2)',fontWeight:600}}>{viewingMember.tier}</span>}</div>
                </div>
              </div>
              <div className="two-col" style={{gap:8}}>
                {[['Organisation',viewingMember.org],['Industry',viewingMember.industry],['Department',viewingMember.department],['Phone',viewingMember.phone]].map(([l,v])=>v?(
                  <div key={l} style={{background:'var(--s3)',borderRadius:8,padding:'8px 12px'}}>
                    <div style={{fontSize:10,color:'var(--t2)',fontWeight:600,textTransform:'uppercase',letterSpacing:'.6px',marginBottom:2}}>{l}</div>
                    <div style={{fontSize:13,fontWeight:600}}>{v}</div>
                  </div>
                ):null)}
              </div>
              {viewingMember.notes&&<div style={{marginTop:10,background:'var(--s3)',borderRadius:8,padding:'8px 12px',fontSize:13,color:'var(--t2)',fontStyle:'italic'}}>{viewingMember.notes}</div>}
              <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                <button className="btn btn-secondary" onClick={()=>setViewingMember(null)}>Close</button>
                <button className="btn btn-primary" onClick={()=>{setEditingMember(viewingMember);setMemberEditForm({name:viewingMember.name,role:viewingMember.role,department:viewingMember.department||'',industry:viewingMember.industry||'',phone:viewingMember.phone||'',notes:viewingMember.notes||'',email:viewingMember.email||''})}}>✏️ Edit Profile</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Member Modal */}
      {editingMember&&(
        <div className="modal-overlay" onClick={()=>setEditingMember(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr"><div className="modal-title">✏️ Edit Member</div><button className="modal-close" onClick={()=>setEditingMember(null)}>×</button></div>
            <div className="modal-body">
              <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',background:'var(--s3)',borderRadius:8,marginBottom:14}}>
                <Avatar name={editingMember.name||'?'} role={editingMember.role} size={36} avatarUrl={editingMember.avatar_url}/>
                <div><div style={{fontWeight:700}}>{editingMember.name}</div><div style={{fontSize:11,color:'var(--t2)'}}>{editingMember.email||'—'} · {editingMember.org}</div></div>
              </div>
              <div className="two-col">
                <div className="form-field"><label className="form-label">Full Name</label><input className="form-input" value={memberEditForm.name||''} onChange={e=>setMemberEditForm({...memberEditForm,name:e.target.value})}/></div>
                <div className="form-field"><label className="form-label">Phone</label><input className="form-input" value={memberEditForm.phone||''} onChange={e=>setMemberEditForm({...memberEditForm,phone:e.target.value})} placeholder="+61 400 000 000"/></div>
              </div>
              <div className="form-field"><label className="form-label">Email</label>
                <input className="form-input" type="email" value={memberEditForm.email||''} onChange={e=>setMemberEditForm({...memberEditForm,email:e.target.value})} placeholder="email@example.com"/>
                <div style={{fontSize:10,color:'var(--t2)',marginTop:3}}>Updates display email — user changes login email via their own Profile</div>
              </div>
              <div className="form-field"><label className="form-label">Role</label>
                <select className="form-input" value={memberEditForm.role||'worker'} onChange={e=>setMemberEditForm({...memberEditForm,role:e.target.value})}>
                  {ROLES.filter(r=>r!=='super_admin').map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <div className="two-col">
                <div className="form-field"><label className="form-label">Industry</label>
                  <select className="form-input" value={memberEditForm.industry||''} onChange={e=>setMemberEditForm({...memberEditForm,industry:e.target.value,department:''})}>
                    <option value="">— Select —</option>
                    {Object.keys(DEPARTMENTS).map(k=><option key={k} value={k}>{k.replace('_',' ')}</option>)}
                  </select>
                </div>
                <div className="form-field"><label className="form-label">Department</label>
                  <select className="form-input" value={memberEditForm.department||''} onChange={e=>setMemberEditForm({...memberEditForm,department:e.target.value})}>
                    <option value="">— Select —</option>
                    {(DEPARTMENTS[memberEditForm.industry||'General']||DEPARTMENTS.General).map(d=><option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-field"><label className="form-label">Notes</label>
                <textarea className="comment-box" style={{minHeight:60}} value={memberEditForm.notes||''} onChange={e=>setMemberEditForm({...memberEditForm,notes:e.target.value})} placeholder="Notes about this member..."/>
              </div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className="btn btn-secondary" onClick={()=>setEditingMember(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={!memberEditForm.name?.trim()} onClick={saveMemberEdit}>Save Changes</button>
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


function SuperAdminTaskStats({ tasks }) {
  const [orgSearch, setOrgSearch] = useState('')
  
  // Build aggregate stats per org — no task content exposed
  const orgs = [...new Set(tasks.map(t=>t.org).filter(Boolean))].sort()
  const filtered = orgSearch ? orgs.filter(o=>o.toLowerCase().includes(orgSearch.toLowerCase())) : orgs
  
  const statsForOrg = (org) => {
    const t = tasks.filter(t=>t.org===org)
    const done = t.filter(t=>['completed','approved','awaiting_review'].includes(t.status)).length
    const overdue = t.filter(t=>t.status==='overdue').length
    const pending = t.filter(t=>t.status==='pending').length
    const rejected = t.filter(t=>t.status==='rejected').length
    const compliance = t.filter(t=>t.compliance)
    const compDone = compliance.filter(t=>['completed','approved'].includes(t.status)).length
    return { total:t.length, done, overdue, pending, rejected, compRate:pct(done,t.length), complianceRate:pct(compDone,compliance.length) }
  }

  const globalStats = statsForOrg(null)
  const allTotal = tasks.length
  const allDone = tasks.filter(t=>['completed','approved','awaiting_review'].includes(t.status)).length
  const allOverdue = tasks.filter(t=>t.status==='overdue').length

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-title">Platform Task Overview</div>
        <div className="ph-sub">Aggregate statistics only — task content is private to each organisation</div>
      </div>

      <div style={{background:'rgba(245,158,11,.06)',border:'1px solid rgba(245,158,11,.2)',borderRadius:10,padding:12,marginBottom:16,fontSize:12,color:'#92400E',display:'flex',gap:8,alignItems:'center'}}>
        <span style={{fontSize:16}}>🔒</span>
        <span>Task content, titles and worker details are private to each organisation. Only aggregate statistics are shown here.</span>
      </div>

      <div className="stat-grid" style={{marginBottom:20}}>
        <Stat label="Total Tasks" val={allTotal} sub="across all orgs" icon="📋" color="#3B82F6" bg="rgba(59,130,246,.1)"/>
        <Stat label="Completed" val={allDone} sub={pct(allDone,allTotal)+'% rate'} icon="✅" color="#10B981" bg="rgba(16,185,129,.1)"/>
        <Stat label="Overdue" val={allOverdue} sub={allOverdue>0?'Need attention':'All on track'} icon="⏰" color={allOverdue>0?'#EF4444':'#10B981'} bg={allOverdue>0?'rgba(239,68,68,.1)':'rgba(16,185,129,.1)'}/>
        <Stat label="Organisations" val={orgs.length} sub="active" icon="🏢" color="#8B5CF6" bg="rgba(139,92,246,.1)"/>
      </div>

      <div className="section">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <div className="section-title" style={{margin:0}}>Stats by Organisation</div>
          <input className="form-input" placeholder="Search org..." value={orgSearch} onChange={e=>setOrgSearch(e.target.value)} style={{fontSize:12,padding:'5px 10px',maxWidth:180}}/>
        </div>
        {filtered.length===0
          ? <div className="empty"><div className="empty-icon">🏢</div><div className="empty-text">No organisations found</div></div>
          : <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead>
                  <tr style={{background:'var(--s3)'}}>
                    {['Organisation','Total','Done','Overdue','Pending','Rejected','Rate','Compliance'].map(h=>(
                      <th key={h} style={{padding:'7px 10px',textAlign:'left',fontSize:10,textTransform:'uppercase',color:'var(--t2)',fontWeight:600,whiteSpace:'nowrap'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(org=>{
                    const s = statsForOrg(org)
                    return (
                      <tr key={org} style={{borderBottom:'1px solid var(--border)'}}>
                        <td style={{padding:'8px 10px',fontWeight:700}}>{org}</td>
                        <td style={{padding:'8px 10px'}}>{s.total}</td>
                        <td style={{padding:'8px 10px',color:'var(--green)',fontWeight:600}}>{s.done}</td>
                        <td style={{padding:'8px 10px',color:s.overdue>0?'var(--red)':'var(--t2)',fontWeight:s.overdue>0?700:400}}>{s.overdue}</td>
                        <td style={{padding:'8px 10px',color:'var(--t2)'}}>{s.pending}</td>
                        <td style={{padding:'8px 10px',color:s.rejected>0?'var(--red)':'var(--t2)'}}>{s.rejected}</td>
                        <td style={{padding:'8px 10px',fontWeight:700,color:s.compRate>=80?'var(--green)':s.compRate>=50?'#F59E0B':'var(--red)'}}>{s.compRate}%</td>
                        <td style={{padding:'8px 10px',fontWeight:700,color:s.complianceRate>=80?'var(--green)':s.complianceRate>=50?'#F59E0B':'var(--red)'}}>{s.complianceRate}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
        }
      </div>
    </div>
  )
}


function ProjectsView({ user }) {
  const [projects, setProjects] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [newProject, setNewProject] = useState({name:'',description:'',status:'active'})
  const [saving, setSaving] = useState(false)

  useEffect(()=>{
    if(isConfigured()&&user.org) {
      supabase.from('projects').select('*').eq('org',user.org).order('created_at',{ascending:false})
        .then(({data})=>{ if(data) setProjects(data) })
        .catch(()=>{})
    }
  },[user.org])

  const createProject = async () => {
    if(!newProject.name.trim()||saving) return
    setSaving(true)
    const entry = { id:'PRJ'+Date.now(), name:newProject.name.trim(), description:newProject.description.trim(), org:user.org, status:'active', created_by:user.name, created_at:new Date().toISOString() }
    if(isConfigured()) {
      const {error} = await supabase.from('projects').insert(entry)
      if(error) { alert('Error: '+error.message); setSaving(false); return }
    }
    setProjects(prev=>[entry,...prev])
    setShowCreate(false)
    setNewProject({name:'',description:'',status:'active'})
    setSaving(false)
  }

  const toggleProject = async (p) => {
    const newStatus = p.status==='active'?'inactive':'active'
    if(isConfigured()) await supabase.from('projects').update({status:newStatus}).eq('id',p.id)
    setProjects(prev=>prev.map(x=>x.id===p.id?{...x,status:newStatus}:x))
  }

  const deleteProject = async (id) => {
    if(!confirm('Delete this project?')) return
    if(isConfigured()) await supabase.from('projects').delete().eq('id',id)
    setProjects(prev=>prev.filter(p=>p.id!==id))
  }

  const isCA = user.role==='client_admin'

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-top">
          <div>
            <div className="ph-title">Projects <span style={{fontSize:12,background:'rgba(245,158,11,.12)',color:'#F59E0B',padding:'2px 8px',borderRadius:10,fontWeight:600,marginLeft:6}}>🔜 Coming Soon</span></div>
            <div className="ph-sub">{user.org} · {projects.filter(p=>p.status==='active').length} active projects</div>
          </div>
          {isCA&&<button className="btn btn-primary" onClick={()=>setShowCreate(true)}><IC n="plus" s={13}/> New Project</button>}
        </div>
      </div>

      <div style={{background:'rgba(245,158,11,.06)',border:'1px solid rgba(245,158,11,.2)',borderRadius:10,padding:12,marginBottom:16,fontSize:12,color:'#92400E',display:'flex',gap:8,alignItems:'flex-start'}}>
        <span style={{fontSize:16,flexShrink:0}}>🚀</span>
        <div>
          <strong>Full Project Management is coming soon.</strong> For now, you can create projects and assign them to tasks. Future updates will add milestones, Gantt charts, project-level reporting and multi-team coordination.
        </div>
      </div>

      {showCreate&&(
        <div className="modal-overlay" onClick={()=>setShowCreate(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr"><div className="modal-title">New Project</div><button className="modal-close" onClick={()=>setShowCreate(false)}>×</button></div>
            <div className="modal-body">
              <div className="form-field"><label className="form-label">Project Name <span style={{color:'var(--red)'}}>*</span></label><input className="form-input" value={newProject.name} onChange={e=>setNewProject({...newProject,name:e.target.value})} placeholder="e.g. Q3 Facility Upgrade"/></div>
              <div className="form-field"><label className="form-label">Description</label><textarea className="comment-box" value={newProject.description} onChange={e=>setNewProject({...newProject,description:e.target.value})} placeholder="Brief description of this project..."/></div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className="btn btn-secondary" onClick={()=>setShowCreate(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={!newProject.name.trim()||saving} onClick={createProject}>{saving?'Creating...':'Create Project'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {projects.length===0 ? (
        <div className="empty" style={{background:'#fff',borderRadius:16,border:'1px solid var(--border)',padding:40}}>
          <div className="empty-icon">📁</div>
          <div style={{fontSize:15,fontWeight:700,marginBottom:6}}>{isCA?'No projects yet':'No projects set up'}</div>
          <div className="empty-text">{isCA?'Create your first project to start organising tasks.':'Your Client Admin will set up projects for this organisation.'}</div>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {projects.map(p=>(
            <div key={p.id} style={{background:'#fff',border:'1px solid var(--border)',borderRadius:12,padding:16,borderLeft:'4px solid '+(p.status==='active'?'var(--brand)':'var(--border)')}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
                <div style={{flex:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                    <span style={{fontSize:15,fontWeight:700}}>{p.name}</span>
                    <span style={{fontSize:10,padding:'2px 8px',borderRadius:10,fontWeight:600,background:p.status==='active'?'rgba(0,168,126,.12)':'var(--s3)',color:p.status==='active'?'var(--brand)':'var(--t2)'}}>{p.status?.toUpperCase()}</span>
                  </div>
                  {p.description&&<div style={{fontSize:12,color:'var(--t2)',marginBottom:4}}>{p.description}</div>}
                  <div style={{fontSize:11,color:'var(--t3)'}}>Created by {p.created_by} · {new Date(p.created_at).toLocaleDateString('en-AU')}</div>
                </div>
                {isCA&&(
                  <div style={{display:'flex',gap:6,flexShrink:0}}>
                    <button className="btn btn-secondary btn-sm" onClick={()=>toggleProject(p)}>{p.status==='active'?'Deactivate':'Activate'}</button>
                    <button className="btn btn-danger btn-sm" onClick={()=>deleteProject(p.id)}>🗑</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section" style={{marginTop:16}}>
        <div className="section-title">Coming in Full Release</div>
        {['Milestones & deadlines','Task grouping by project','Project progress tracking','Gantt chart view','Project-level reports','Budget tracking','Multi-team coordination'].map((f,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',gap:8,fontSize:13,color:'var(--t2)',padding:'5px 0',borderBottom:'1px solid var(--border)'}}>
            <span style={{color:'var(--t3)'}}>◦</span>{f}
          </div>
        ))}
      </div>
    </div>
  )
}

function PerformanceView({ tasks, user, leaveRecords=[] }) {
  const [period, setPeriod] = useState('monthly')
  const [selectedRole, setSelectedRole] = useState('all')

  const getRange = () => {
    const now = new Date()
    if (period==='weekly') { const s=new Date(now); s.setDate(s.getDate()-6); return [s,now] }
    if (period==='monthly') { const s=new Date(now); s.setDate(s.getDate()-29); return [s,now] }
    if (period==='quarterly') { const s=new Date(now); s.setDate(s.getDate()-89); return [s,now] }
    return [new Date(0), now]
  }
  const [rs,re] = getRange()
  const orgTasks = tasks.filter(t=>t.org===user.org)
  const pt = orgTasks.filter(t=>{ const d=new Date(t.created_at||t.due_date||0); return d>=rs&&d<=re })

  // Build leave day lookup per user
  const leaveDaysByUser = {}
  leaveRecords.forEach(l=>{
    if(!leaveDaysByUser[l.user_id]) leaveDaysByUser[l.user_id]=new Set()
    const cur=new Date(l.date_from)
    while(cur.toISOString().split('T')[0]<=l.date_to){
      leaveDaysByUser[l.user_id].add(cur.toISOString().split('T')[0])
      cur.setDate(cur.getDate()+1)
    }
  })

  // Filter out tasks due on leave days (don't penalise for leave)
  const ptFiltered = pt.filter(t=>{
    if(!t.assigned_user_id||!t.due_date) return true
    return !leaveDaysByUser[t.assigned_user_id]?.has(t.due_date)
  })

  // Build per-person stats
  const peopleMap = {}
  pt.forEach(t=>{
    const key = t.assigned_user_id||t.assigned_user_name||'Unassigned'
    const name = t.assigned_user_name||'Unassigned'
    const role = t.assigned_role||'worker'
    if(!peopleMap[key]) peopleMap[key]={id:key,name,role,total:0,done:0,onTime:0,rejected:0,overdue:0,avgMins:[],submitted:0,reviewedInTime:0}
    peopleMap[key].total++
    if(['completed','approved'].includes(t.status)){
      peopleMap[key].done++
      if(t.due_date&&t.completed_at&&new Date(t.completed_at)<=new Date(t.due_date)) peopleMap[key].onTime++
      if(t.started_at&&t.completed_at) peopleMap[key].avgMins.push((new Date(t.completed_at)-new Date(t.started_at))/60000)
    }
    if(t.status==='rejected') peopleMap[key].rejected++
    if(t.status==='overdue') peopleMap[key].overdue++
    if(['awaiting_review','approved','rejected'].includes(t.status)) peopleMap[key].submitted++
    // SLA tracking — was it reviewed within the SLA?
    if(t.reviewed_at && t.submitted_at) {
      const slaMinutes = getSLAMinutes(t.priority, null)
      const reviewMinutes = (new Date(t.reviewed_at)-new Date(t.submitted_at))/60000
      if(!peopleMap[key].slaTotal) peopleMap[key].slaTotal=0
      if(!peopleMap[key].slaOnTime) peopleMap[key].slaOnTime=0
      peopleMap[key].slaTotal++
      if(reviewMinutes<=slaMinutes) peopleMap[key].slaOnTime++
    }
    if(t.reviewed_at&&t.submitted_at&&(new Date(t.reviewed_at)-new Date(t.submitted_at))<=86400000) peopleMap[key].reviewedInTime++
  })

  const people = Object.values(peopleMap)
    .filter(p=>selectedRole==='all'||p.role===selectedRole)
    .sort((a,b)=>b.total-a.total)

  const fmtAvg = mins => {
    if(!mins.length) return '—'
    const avg = Math.round(mins.reduce((a,b)=>a+b,0)/mins.length)
    return avg<60?avg+'m':Math.floor(avg/60)+'h '+(avg%60)+'m'
  }

  const getGrade = (rate) => {
    if(rate>=90) return {grade:'A',color:'#10B981'}
    if(rate>=75) return {grade:'B',color:'#3B82F6'}
    if(rate>=60) return {grade:'C',color:'#F59E0B'}
    if(rate>=40) return {grade:'D',color:'#F97316'}
    return {grade:'F',color:'#EF4444'}
  }

  const pct = (a,b) => b>0?Math.round(a/b*100):0

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-title">Performance Review</div>
        <div className="ph-sub">{user.org} · Task-based performance metrics</div>
      </div>

      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14,alignItems:'center'}}>
        <div style={{display:'flex',gap:4}}>
          {[['weekly','Weekly'],['monthly','Monthly'],['quarterly','Quarterly']].map(([v,l])=>(
            <button key={v} className={'btn btn-sm '+(period===v?'btn-primary':'btn-secondary')} onClick={()=>setPeriod(v)}>{l}</button>
          ))}
        </div>
        <select className="form-input" value={selectedRole} onChange={e=>setSelectedRole(e.target.value)} style={{fontSize:12,padding:'5px 10px',maxWidth:160}}>
          <option value="all">All Roles</option>
          {['manager','supervisor','worker'].map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </div>

      {people.length===0 ? (
        <div className="empty"><div className="empty-icon">📊</div><div className="empty-text">No task data for this period</div></div>
      ) : (
        <>
          {/* Summary cards */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:10,marginBottom:16}}>
            {[
              {label:'Team Members',val:people.length,color:'#3B82F6'},
              {label:'Tasks Assigned',val:pt.length,color:'#5BC8C0'},
              {label:'Completed',val:pt.filter(t=>['completed','approved'].includes(t.status)).length,color:'#10B981'},
              {label:'Overdue',val:pt.filter(t=>t.status==='overdue').length,color:'#EF4444'},
            ].map(s=>(
              <div key={s.label} style={{background:'#fff',border:'1px solid var(--border)',borderRadius:10,padding:'12px 14px'}}>
                <div style={{fontSize:22,fontWeight:800,color:s.color,lineHeight:1}}>{s.val}</div>
                <div style={{fontSize:10,color:'var(--t2)',marginTop:4,textTransform:'uppercase',fontWeight:600,letterSpacing:'.5px'}}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Per-person cards */}
          {people.map((p,i)=>{
            const compRate = pct(p.done,p.total)
            const onTimeRate = pct(p.onTime,p.done)
            const {grade,color} = getGrade(compRate)
            return (
              <div key={i} style={{background:'#fff',border:'1px solid var(--border)',borderRadius:12,padding:16,marginBottom:10}}>
                <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
                  <div style={{width:44,height:44,borderRadius:'50%',background:color+'22',color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:800,flexShrink:0}}>{grade}</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:14}}>{p.name}</div>
                    <div style={{fontSize:11,color:'var(--t2)',marginTop:1}}><RolePill role={p.role}/></div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:22,fontWeight:800,color,lineHeight:1}}>{compRate}%</div>
                    <div style={{fontSize:10,color:'var(--t2)',marginTop:1}}>completion</div>
                  </div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(100px,1fr))',gap:8}}>
                  {[
                    ['Tasks',p.total,'#5BC8C0'],
                    ['Completed',p.done,'#10B981'],
                    ['On Time',onTimeRate+'%','#3B82F6'],
                    ['Rejected',p.rejected,p.rejected>0?'#EF4444':'#6B7280'],
                    ['Overdue',p.overdue,p.overdue>0?'#EF4444':'#6B7280'],
                    ['Avg Time',fmtAvg(p.avgMins),'#8B5CF6'],
                    ['SLA Met',p.slaTotal>0?pct(p.slaOnTime,p.slaTotal)+'%':'—',p.slaTotal>0&&pct(p.slaOnTime,p.slaTotal)>=80?'#10B981':'#EF4444'],
                  ].map(([l,v,c])=>(
                    <div key={l} style={{background:'var(--s3)',borderRadius:8,padding:'8px 10px',textAlign:'center'}}>
                      <div style={{fontSize:15,fontWeight:700,color:c,lineHeight:1}}>{v}</div>
                      <div style={{fontSize:9,color:'var(--t2)',marginTop:3,textTransform:'uppercase',fontWeight:600}}>{l}</div>
                    </div>
                  ))}
                </div>
                {/* Performance bar */}
                <div style={{marginTop:10}}>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--t2)',marginBottom:3}}>
                    <span>Performance</span><span style={{fontWeight:600,color}}>{compRate}%</span>
                  </div>
                  <div style={{height:6,background:'var(--s3)',borderRadius:3,overflow:'hidden'}}>
                    <div style={{height:'100%',width:compRate+'%',background:color,borderRadius:3,transition:'width .5s'}}/>
                  </div>
                </div>
                {p.rejected>0&&<div style={{marginTop:8,fontSize:11,color:'#F97316',background:'rgba(249,115,22,.08)',borderRadius:6,padding:'4px 8px'}}>⚠️ {p.rejected} task{p.rejected>1?'s':''} rejected — may need coaching</div>}
                {p.overdue>0&&<div style={{marginTop:4,fontSize:11,color:'var(--red)',background:'rgba(239,68,68,.06)',borderRadius:6,padding:'4px 8px'}}>🔴 {p.overdue} overdue task{p.overdue>1?'s':''}</div>}
                {compRate>=90&&<div style={{marginTop:4,fontSize:11,color:'var(--green)',background:'rgba(16,185,129,.06)',borderRadius:6,padding:'4px 8px'}}>⭐ Outstanding performance</div>}
              </div>
            )
          })}

          {/* Team summary */}
          <div className="section" style={{marginTop:8}}>
            <div className="section-title">Team Summary</div>
            <div style={{fontSize:12,color:'var(--t2)',lineHeight:1.8}}>
              <div>📊 Overall team completion rate: <strong style={{color:'var(--text)'}}>{pct(pt.filter(t=>['completed','approved'].includes(t.status)).length,pt.length)}%</strong></div>
              <div>⭐ Top performer: <strong style={{color:'var(--text)'}}>{people.sort((a,b)=>pct(b.done,b.total)-pct(a.done,a.total))[0]?.name||'—'}</strong></div>
              <div>⚠️ Needs attention: <strong style={{color:'var(--red)'}}>{people.filter(p=>pct(p.done,p.total)<50).map(p=>p.name).join(', ')||'None'}</strong></div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}


function LeaveView({ user, tasks }) {
  const [leaves, setLeaves] = useState([])
  const [showApply, setShowApply] = useState(false)
  const [form, setForm] = useState({ type:'annual_leave', date_from:'', date_to:'', reason:'', replacement_id:'', replacement_name:'' })
  const [saving, setSaving] = useState(false)
  const [teamLeaves, setTeamLeaves] = useState([])
  const isCA = user.role==='client_admin'
  const today = new Date().toISOString().split('T')[0]
  const [orgUsers, setOrgUsers] = useState([])

  useEffect(()=>{
    if(isConfigured()&&user.org) {
      supabase.from('org_members').select('user_id,role').eq('org',user.org)
        .then(async({data:members})=>{
          if(!members?.length) return
          const {data:profiles} = await supabase.from('profiles').select('id,name,role').in('id',members.map(m=>m.user_id))
          if(profiles) setOrgUsers(profiles.map(p=>({...p,role:members.find(m=>m.user_id===p.id)?.role||p.role})))
        }).catch(()=>{})
    }
  },[user.org])

  useEffect(()=>{
    if(!isConfigured()) return
    // Load own leave
    supabase.from('leave_records').select('*').eq('user_id',user.id).order('date_from',{ascending:false})
      .then(({data})=>{ if(data) setLeaves(data) }).catch(()=>{})
    // Client admin sees all team leave
    if(isCA) {
      supabase.from('leave_records').select('*').eq('org',user.org).order('date_from',{ascending:false})
        .then(({data})=>{ if(data) setTeamLeaves(data) }).catch(()=>{})
    }
  },[])

  const applyLeave = async () => {
    if(!form.date_from||!form.date_to||saving) return
    if(form.date_to<form.date_from) { alert('End date must be after start date'); return }
    setSaving(true)
    const entry = {
      id: 'LV'+Date.now(),
      user_id: user.id,
      user_name: user.name,
      org: user.org,
      role: user.role,
      type: form.type,
      date_from: form.date_from,
      date_to: form.date_to,
      reason: form.reason.trim(),
      replacement_id: form.replacement_id||null,
      replacement_name: form.replacement_name||null,
      status: 'approved',
      created_at: new Date().toISOString()
    }
    if(isConfigured()) {
      const {error} = await supabase.from('leave_records').insert(entry)
      if(error) { alert('Error: '+error.message); setSaving(false); return }
    }
    setLeaves(prev=>[entry,...prev])
    if(isCA) setTeamLeaves(prev=>[entry,...prev])
    setShowApply(false)
    setForm({ type:'annual_leave', date_from:'', date_to:'', reason:'' })
    setSaving(false)
  }

  const deleteLeave = async (id) => {
    if(!confirm('Cancel this leave request?')) return
    if(isConfigured()) await supabase.from('leave_records').delete().eq('id',id)
    setLeaves(prev=>prev.filter(l=>l.id!==id))
    setTeamLeaves(prev=>prev.filter(l=>l.id!==id))
  }

  const isOnLeave = leaves.some(l=>l.date_from<=today&&l.date_to>=today)

  // Tasks on leave days — excluded from performance
  const leaveDays = new Set()
  leaves.forEach(l=>{
    const cur = new Date(l.date_from)
    while(cur.toISOString().split('T')[0]<=l.date_to) {
      leaveDays.add(cur.toISOString().split('T')[0])
      cur.setDate(cur.getDate()+1)
    }
  })
  const orgTasks = tasks.filter(t=>t.org===user.org)
  const myTasks = orgTasks.filter(t=>t.assigned_user_id===user.id||t.assigned_user_name===user.name)
  const leaveExcluded = myTasks.filter(t=>t.due_date&&leaveDays.has(t.due_date))

  const fmtDate = d => d ? new Date(d+'T00:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'}) : '—'

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-top">
          <div>
            <div className="ph-title">{isCA?'Team Leave':'My Leave'}</div>
            <div className="ph-sub">{isCA?`${teamLeaves.filter(l=>l.date_from<=today&&l.date_to>=today).length} staff on leave today`:(isOnLeave?'🟡 You are currently on leave':'✅ You are currently active')}</div>
          </div>
          <button className="btn btn-primary" onClick={()=>setShowApply(true)}><IC n="plus" s={13}/> Apply for Leave</button>
        </div>
      </div>

      {isOnLeave&&(
        <div style={{background:'rgba(245,158,11,.08)',border:'1px solid rgba(245,158,11,.2)',borderRadius:10,padding:12,marginBottom:14,fontSize:13,color:'#92400E'}}>
          🟡 <strong>You are on leave today.</strong> Tasks due on your leave days are excluded from your performance review.
        </div>
      )}

      {showApply&&(
        <div className="modal-overlay" onClick={()=>setShowApply(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr"><div className="modal-title">Apply for Leave</div><button className="modal-close" onClick={()=>setShowApply(false)}>×</button></div>
            <div className="modal-body">
              <div className="form-field">
                <label className="form-label">Leave Type</label>
                <select className="form-select" value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>
                  {LEAVE_TYPES.map(t=><option key={t} value={t}>{LEAVE_LABELS[t]}</option>)}
                </select>
              </div>
              <div className="two-col">
                <div className="form-field"><label className="form-label">From Date</label><input type="date" className="form-input" value={form.date_from} onChange={e=>setForm({...form,date_from:e.target.value})}/></div>
                <div className="form-field"><label className="form-label">To Date</label><input type="date" className="form-input" value={form.date_to} min={form.date_from||undefined} onChange={e=>setForm({...form,date_to:e.target.value})}/></div>
              </div>
              <div className="form-field">
                <label className="form-label">Reason <span style={{fontSize:10,color:'var(--t2)',fontWeight:400,textTransform:'none'}}>— optional</span></label>
                <textarea className="comment-box" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} placeholder="Brief reason for leave..."/>
              </div>
              <div className="form-field">
                <label className="form-label">Replacement / Cover Person <span style={{fontSize:10,color:'var(--t2)',fontWeight:400,textTransform:'none'}}>— optional</span></label>
                <select className="form-select" value={form.replacement_id||''} onChange={e=>{ const u=orgUsers?.find(x=>x.id===e.target.value); setForm({...form,replacement_id:e.target.value,replacement_name:u?.name||''}) }}>
                  <option value="">— No replacement needed —</option>
                  {(orgUsers||[]).filter(u=>u.id!==user.id&&(ROLE_LEVEL[u.role]||0)>=(ROLE_LEVEL[user.role]||0)).map(u=><option key={u.id} value={u.id}>{u.name} ({ROLE_LABELS[u.role]||u.role})</option>)}
                </select>
                <div style={{fontSize:10,color:'var(--t2)',marginTop:3}}>Can be same level or above. They will see your tasks during your leave.</div>
              </div>
              <div style={{background:'var(--brand-lt)',border:'1px solid rgba(0,168,126,.2)',borderRadius:8,padding:10,fontSize:12,color:'var(--brand)',marginBottom:12}}>
                ℹ️ Tasks due on your leave days will be excluded from your performance review automatically.
              </div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className="btn btn-secondary" onClick={()=>setShowApply(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={!form.date_from||!form.date_to||saving} onClick={applyLeave}>{saving?'Saving...':'Submit Leave'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* My Leave Records */}
      <div className="section" style={{marginBottom:14}}>
        <div className="section-title">My Leave Records</div>
        {leaves.length===0
          ? <div style={{fontSize:13,color:'var(--t2)',textAlign:'center',padding:16}}>No leave records yet</div>
          : leaves.map((l,i)=>(
            <div key={i} style={{display:'flex',gap:10,padding:'10px 0',borderBottom:'1px solid var(--border)',alignItems:'center'}}>
              <div style={{width:10,height:10,borderRadius:'50%',background:LEAVE_COLORS[l.type]||'#6B7280',flexShrink:0}}/>
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:13}}>{LEAVE_LABELS[l.type]}</div>
                <div style={{fontSize:11,color:'var(--t2)',marginTop:1}}>{fmtDate(l.date_from)} → {fmtDate(l.date_to)}</div>
                {l.reason&&<div style={{fontSize:11,color:'var(--t2)',fontStyle:'italic',marginTop:1}}>{l.reason}</div>}
                {l.replacement_name&&<div style={{fontSize:11,color:'var(--brand)',marginTop:1}}>👤 Cover: {l.replacement_name}</div>}
              </div>
              <span style={{fontSize:10,padding:'2px 8px',borderRadius:10,fontWeight:600,background:(LEAVE_COLORS[l.type]||'#6B7280')+'22',color:LEAVE_COLORS[l.type]||'#6B7280'}}>{l.type.replace('_',' ').toUpperCase()}</span>
              {l.date_from>=today&&<button className="btn btn-danger btn-sm" onClick={()=>deleteLeave(l.id)}>Cancel</button>}
            </div>
          ))
        }
      </div>

      {/* Tasks excluded from performance */}
      {leaveExcluded.length>0&&(
        <div className="section" style={{marginBottom:14}}>
          <div className="section-title">📊 Excluded from Performance Review</div>
          <div style={{fontSize:12,color:'var(--t2)',marginBottom:8}}>These tasks were due on your leave days and won't affect your performance metrics.</div>
          {leaveExcluded.map((t,i)=>(
            <div key={i} style={{display:'flex',gap:8,padding:'6px 0',borderBottom:'1px solid var(--border)',fontSize:12,alignItems:'center'}}>
              <span style={{color:'var(--t2)'}}>📋</span>
              <div style={{flex:1}}>{t.title}</div>
              <span style={{color:'var(--t2)',fontSize:11}}>Due {t.due_date}</span>
            </div>
          ))}
        </div>
      )}

      {/* Client admin: team leave overview */}
      {isCA&&teamLeaves.length>0&&(
        <div className="section">
          <div className="section-title">Team Leave Overview</div>
          {[...new Set(teamLeaves.map(l=>l.user_name))].map(name=>{
            const userLeaves = teamLeaves.filter(l=>l.user_name===name)
            const onLeave = userLeaves.some(l=>l.date_from<=today&&l.date_to>=today)
            return (
              <div key={name} style={{padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                  <span style={{width:8,height:8,borderRadius:'50%',background:onLeave?'#F59E0B':'#10B981',display:'inline-block'}}/>
                  <span style={{fontWeight:600,fontSize:13}}>{name}</span>
                  {onLeave&&<span style={{fontSize:10,background:'rgba(245,158,11,.15)',color:'#F59E0B',padding:'1px 6px',borderRadius:8,fontWeight:600}}>ON LEAVE</span>}
                </div>
                {userLeaves.slice(0,2).map((l,i)=>(
                  <div key={i} style={{fontSize:11,color:'var(--t2)',marginLeft:16,display:'flex',gap:8}}>
                    <span style={{color:LEAVE_COLORS[l.type]}}>{LEAVE_LABELS[l.type]}</span>
                    <span>{fmtDate(l.date_from)} → {fmtDate(l.date_to)}</span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}


function TeamsView({ user }) {
  const [teams, setTeams] = useState([])
  const [teamTypes, setTeamTypes] = useState([]) // org-defined team types
  const [showCreateTeam, setShowCreateTeam] = useState(false)
  const [showManageTypes, setShowManageTypes] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [orgUsers, setOrgUsers] = useState([])
  const [newTeam, setNewTeam] = useState({name:'', type:'', description:''})
  const [newType, setNewType] = useState('')
  const [saving, setSaving] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [addMemberUser, setAddMemberUser] = useState('')
  const [addMemberRole, setAddMemberRole] = useState('')
  const isCA = user.role==='client_admin'

  useEffect(()=>{
    if(!isConfigured()) return
    // Load teams for this org
    supabase.from('teams').select('*').eq('org',user.org).order('name')
      .then(({data})=>{ if(data) setTeams(data) }).catch(()=>{})
    // Load team types (stored in organisations table as JSON)
    supabase.from('organisations').select('team_types').eq('name',user.org).single()
      .then(({data})=>{ if(data?.team_types) setTeamTypes(JSON.parse(data.team_types||'[]')) }).catch(()=>{})
    // Load org users
    supabase.from('org_members').select('user_id,role').eq('org',user.org)
      .then(async({data:members})=>{
        if(!members?.length) return
        const {data:profiles} = await supabase.from('profiles').select('*').in('id',members.map(m=>m.user_id))
        if(profiles) setOrgUsers(profiles.map(p=>({...p,role:members.find(m=>m.user_id===p.id)?.role||p.role})))
      }).catch(()=>{})
  },[user.org])

  const loadTeamMembers = async (teamId) => {
    const {data} = await supabase.from('team_members').select('*').eq('team_id',teamId)
    if(data) {
      const ids = data.map(m=>m.user_id)
      const {data:profiles} = await supabase.from('profiles').select('*').in('id',ids)
      return data.map(m=>({...m, profile:profiles?.find(p=>p.id===m.user_id)||{}}))
    }
    return []
  }

  const openTeam = async (team) => {
    const members = await loadTeamMembers(team.id)
    setSelectedTeam({...team, members})
  }

  const createTeam = async () => {
    if(!newTeam.name.trim()||saving) return
    setSaving(true)
    const entry = {id:'TM'+Date.now(), name:newTeam.name.trim(), type:newTeam.type, description:newTeam.description.trim(), org:user.org, created_by:user.name, created_at:new Date().toISOString()}
    if(isConfigured()) {
      const {error} = await supabase.from('teams').insert(entry)
      if(error){alert('Error: '+error.message);setSaving(false);return}
    }
    setTeams(prev=>[...prev,entry])
    setShowCreateTeam(false)
    setNewTeam({name:'',type:'',description:''})
    setSaving(false)
  }

  const saveTeamType = async () => {
    if(!newType.trim()) return
    const updated = [...teamTypes, newType.trim()]
    setTeamTypes(updated)
    setNewType('')
    if(isConfigured()) supabase.from('organisations').update({team_types:JSON.stringify(updated)}).eq('name',user.org).then(()=>{})
  }

  const removeTeamType = async (t) => {
    const updated = teamTypes.filter(x=>x!==t)
    setTeamTypes(updated)
    if(isConfigured()) supabase.from('organisations').update({team_types:JSON.stringify(updated)}).eq('name',user.org).then(()=>{})
  }

  const addMember = async () => {
    if(!addMemberUser||!selectedTeam) return
    const u = orgUsers.find(x=>x.id===addMemberUser)
    if(!u) return
    const entry = {id:'TM'+Date.now(), team_id:selectedTeam.id, user_id:u.id, user_name:u.name, role:addMemberRole||u.role, org:user.org, added_by:user.name, added_at:new Date().toISOString()}
    if(isConfigured()) await supabase.from('team_members').insert(entry)
    const updated = {...selectedTeam, members:[...(selectedTeam.members||[]),{...entry,profile:u}]}
    setSelectedTeam(updated)
    setTeams(prev=>prev.map(t=>t.id===selectedTeam.id?{...t,member_count:(t.member_count||0)+1}:t))
    setShowAddMember(false)
    setAddMemberUser('')
    setAddMemberRole('')
  }

  const removeMember = async (memberId) => {
    if(!confirm('Remove this member from the team?')) return
    if(isConfigured()) await supabase.from('team_members').delete().eq('id',memberId)
    setSelectedTeam(prev=>({...prev, members:prev.members.filter(m=>m.id!==memberId)}))
  }

  const deleteTeam = async (id) => {
    if(!confirm('Delete this team? Members will be removed.')) return
    if(isConfigured()) {
      await supabase.from('team_members').delete().eq('team_id',id)
      await supabase.from('teams').delete().eq('id',id)
    }
    setTeams(prev=>prev.filter(t=>t.id!==id))
    if(selectedTeam?.id===id) setSelectedTeam(null)
  }

  const TYPE_COLORS = ['#3B82F6','#10B981','#F59E0B','#8B5CF6','#EF4444','#F97316','#06B6D4','#84CC16']

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-top">
          <div>
            <div className="ph-title">Teams</div>
            <div className="ph-sub">{user.org} · {teams.length} team{teams.length!==1?'s':''}</div>
          </div>
          <div style={{display:'flex',gap:8}}>
            {isCA&&<button className="btn btn-secondary" onClick={()=>setShowManageTypes(true)}>⚙️ Team Types</button>}
            {isCA&&<button className="btn btn-primary" onClick={()=>setShowCreateTeam(true)}><IC n="plus" s={13}/> New Team</button>}
          </div>
        </div>
      </div>

      {/* Manage Team Types Modal */}
      {showManageTypes&&(
        <div className="modal-overlay" onClick={()=>setShowManageTypes(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr"><div className="modal-title">⚙️ Team Types</div><button className="modal-close" onClick={()=>setShowManageTypes(false)}>×</button></div>
            <div className="modal-body">
              <div style={{fontSize:12,color:'var(--t2)',marginBottom:14}}>Define team types for your organisation. These appear as categories when creating teams (e.g. SIL House, Kitchen, Admin, Outreach).</div>
              <div style={{display:'flex',gap:8,marginBottom:14}}>
                <input className="form-input" value={newType} onChange={e=>setNewType(e.target.value)} placeholder="e.g. SIL House, Kitchen Team..." onKeyDown={e=>e.key==='Enter'&&saveTeamType()}/>
                <button className="btn btn-primary" onClick={saveTeamType} disabled={!newType.trim()}>Add</button>
              </div>
              {teamTypes.length===0
                ? <div style={{fontSize:13,color:'var(--t2)',textAlign:'center',padding:16}}>No team types yet — add some above</div>
                : <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                    {teamTypes.map((t,i)=>(
                      <div key={i} style={{display:'flex',alignItems:'center',gap:6,padding:'5px 12px',borderRadius:20,background:TYPE_COLORS[i%TYPE_COLORS.length]+'22',border:'1px solid '+TYPE_COLORS[i%TYPE_COLORS.length]+'44',color:TYPE_COLORS[i%TYPE_COLORS.length],fontSize:12,fontWeight:600}}>
                        {t}
                        {isCA&&<span style={{cursor:'pointer',fontSize:14,lineHeight:1,opacity:.7}} onClick={()=>removeTeamType(t)}>×</span>}
                      </div>
                    ))}
                  </div>
              }
            </div>
          </div>
        </div>
      )}

      {/* Create Team Modal */}
      {showCreateTeam&&(
        <div className="modal-overlay" onClick={()=>setShowCreateTeam(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr"><div className="modal-title">New Team</div><button className="modal-close" onClick={()=>setShowCreateTeam(false)}>×</button></div>
            <div className="modal-body">
              <div className="form-field"><label className="form-label">Team Name <span style={{color:'var(--red)'}}>*</span></label><input className="form-input" value={newTeam.name} onChange={e=>setNewTeam({...newTeam,name:e.target.value})} placeholder="e.g. SIL House Alpha, Morning Shift..."/></div>
              <div className="form-field">
                <label className="form-label">Team Type</label>
                <select className="form-select" value={newTeam.type} onChange={e=>setNewTeam({...newTeam,type:e.target.value})}>
                  <option value="">— Select type —</option>
                  {teamTypes.map((t,i)=><option key={i} value={t}>{t}</option>)}
                  {teamTypes.length===0&&<option disabled>No types defined — add via ⚙️ Team Types</option>}
                </select>
              </div>
              <div className="form-field"><label className="form-label">Description</label><textarea className="comment-box" value={newTeam.description} onChange={e=>setNewTeam({...newTeam,description:e.target.value})} placeholder="Brief description..."/></div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className="btn btn-secondary" onClick={()=>setShowCreateTeam(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={!newTeam.name.trim()||saving} onClick={createTeam}>{saving?'Creating...':'Create Team'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Team Detail View */}
      {selectedTeam ? (
        <div className="anim">
          <button className="back-btn" onClick={()=>setSelectedTeam(null)}><IC n="x" s={14}/> Back to Teams</button>
          <div style={{background:'#fff',border:'1px solid var(--border)',borderRadius:12,padding:20,marginBottom:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,marginBottom:12}}>
              <div>
                <div style={{fontSize:18,fontWeight:800}}>{selectedTeam.name}</div>
                {selectedTeam.type&&<div style={{fontSize:12,color:'var(--t2)',marginTop:3}}>📂 {selectedTeam.type}</div>}
                {selectedTeam.description&&<div style={{fontSize:12,color:'var(--t2)',marginTop:4,fontStyle:'italic'}}>{selectedTeam.description}</div>}
                <div style={{fontSize:11,color:'var(--t3)',marginTop:4}}>Created by {selectedTeam.created_by} · {new Date(selectedTeam.created_at).toLocaleDateString('en-AU')}</div>
              </div>
              {isCA&&<button className="btn btn-danger btn-sm" onClick={()=>deleteTeam(selectedTeam.id)}>🗑 Delete Team</button>}
            </div>

            <div style={{borderTop:'1px solid var(--border)',paddingTop:14}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px'}}>Members ({(selectedTeam.members||[]).length})</div>
                {(isCA||user.role==='manager'||user.role==='supervisor')&&<button className="btn btn-primary btn-sm" onClick={()=>setShowAddMember(true)}><IC n="plus" s={12}/> Add Member</button>}
              </div>

              {showAddMember&&(
                <div style={{background:'var(--s3)',borderRadius:10,padding:14,marginBottom:14}}>
                  <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',marginBottom:10}}>Add Member</div>
                  <div className="two-col">
                    <div className="form-field">
                      <label className="form-label">Staff Member</label>
                      <select className="form-select" value={addMemberUser} onChange={e=>setAddMemberUser(e.target.value)}>
                        <option value="">— Select —</option>
                        {orgUsers.filter(u=>!(selectedTeam.members||[]).find(m=>m.user_id===u.id)).map(u=><option key={u.id} value={u.id}>{u.name} ({ROLE_LABELS[u.role]||u.role})</option>)}
                      </select>
                    </div>
                    <div className="form-field">
                      <label className="form-label">Role in Team <span style={{fontSize:10,color:'var(--t2)',fontWeight:400}}>optional</span></label>
                      <input className="form-input" value={addMemberRole} onChange={e=>setAddMemberRole(e.target.value)} placeholder="e.g. Team Lead, On-call..."/>
                    </div>
                  </div>
                  <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                    <button className="btn btn-secondary btn-sm" onClick={()=>setShowAddMember(false)}>Cancel</button>
                    <button className="btn btn-primary btn-sm" disabled={!addMemberUser} onClick={addMember}>Add to Team</button>
                  </div>
                </div>
              )}

              {(selectedTeam.members||[]).length===0
                ? <div style={{fontSize:13,color:'var(--t2)',textAlign:'center',padding:20}}>No members yet — add staff to this team</div>
                : (()=>{
                    const roleOrder = ['client_admin','manager','supervisor','worker']
                    const grouped = {}
                    ;(selectedTeam.members||[]).forEach(m=>{ const r=m.profile?.role||m.role||'worker'; if(!grouped[r]) grouped[r]=[]; grouped[r].push(m) })
                    return roleOrder.filter(r=>grouped[r]?.length).map(role=>(
                      <div key={role} style={{marginBottom:14}}>
                        <div style={{fontSize:10,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:8,display:'flex',alignItems:'center',gap:6}}>
                          <span style={{width:8,height:8,borderRadius:'50%',background:avatarColor(role),display:'inline-block'}}/>
                          {ROLE_LABELS[role]} ({grouped[role].length})
                        </div>
                        {grouped[role].map((m,i)=>(
                          <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                            <Avatar name={m.profile?.name||m.user_name||'?'} role={m.profile?.role||role} size={32} avatarUrl={m.profile?.avatar_url}/>
                            <div style={{flex:1}}>
                              <div style={{fontWeight:600,fontSize:13}}>{m.profile?.name||m.user_name||'—'}</div>
                              <div style={{fontSize:11,color:'var(--t2)'}}>{m.role_in_team||m.role||ROLE_LABELS[role]}{m.profile?.department?' · '+m.profile.department:''}</div>
                            </div>
                            <RolePill role={m.profile?.role||role}/>
                            {(isCA||user.role==='manager')&&<button className="btn btn-danger btn-sm" onClick={()=>removeMember(m.id)}>Remove</button>}
                          </div>
                        ))}
                      </div>
                    ))
                  })()
              }
            </div>
          </div>
        </div>
      ) : (
        <div>
          {teams.length===0 ? (
            <div className="empty" style={{background:'#fff',borderRadius:16,border:'1px solid var(--border)',padding:40}}>
              <div className="empty-icon">👥</div>
              <div style={{fontSize:15,fontWeight:700,marginBottom:6}}>{isCA?'No teams yet':'No teams set up'}</div>
              <div className="empty-text">{isCA?'Create your first team to organise your staff.':'Your Client Admin will set up teams for this organisation.'}</div>
            </div>
          ) : (
            <div>
              {/* Group by team type */}
              {(()=>{
                const byType = {}
                teams.forEach(t=>{ const type=t.type||'Other'; if(!byType[type]) byType[type]=[]; byType[type].push(t) })
                return Object.keys(byType).sort().map((type,ti)=>(
                  <div key={type} style={{marginBottom:20}}>
                    <div style={{fontSize:11,fontWeight:700,color:TYPE_COLORS[ti%TYPE_COLORS.length],textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10,display:'flex',alignItems:'center',gap:6}}>
                      <span style={{width:10,height:10,borderRadius:'50%',background:TYPE_COLORS[ti%TYPE_COLORS.length],display:'inline-block'}}/>
                      {type} ({byType[type].length})
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:10}}>
                      {byType[type].map(team=>(
                        <div key={team.id} onClick={()=>openTeam(team)} style={{background:'#fff',border:'1px solid var(--border)',borderRadius:12,padding:16,cursor:'pointer',transition:'all .15s',borderLeft:'4px solid '+TYPE_COLORS[ti%TYPE_COLORS.length]}}
                          onMouseOver={e=>e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,.08)'}
                          onMouseOut={e=>e.currentTarget.style.boxShadow='none'}>
                          <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>{team.name}</div>
                          {team.description&&<div style={{fontSize:12,color:'var(--t2)',marginBottom:8}}>{team.description}</div>}
                          <div style={{fontSize:11,color:'var(--t2)',display:'flex',gap:12}}>
                            <span>👥 {team.member_count||0} members</span>
                            <span>📅 {new Date(team.created_at).toLocaleDateString('en-AU')}</span>
                          </div>
                          {isCA&&(
                            <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid var(--border)',display:'flex',justifyContent:'flex-end'}}>
                              <button className="btn btn-danger btn-sm" onClick={e=>{e.stopPropagation();deleteTeam(team.id)}}>🗑</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


function SLASettingsView({ user, orgSLA, setOrgSLA, tasks, setTasks, loadTasks }) {
  const [sla, setSla] = useState(orgSLA || DEFAULT_SLA)
  const [reviewSLA, setReviewSLA] = useState(10080) // 1 week in minutes
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [generating, setGenerating] = useState(false)

  const fmtMinutes = m => m<60?m+'m':m<1440?(m/60)+'h':Math.round(m/1440)+'d'
  const PRIORITIES = ['low','medium','high','critical']
  const PRIORITY_COLORS = {low:'#10B981',medium:'#F59E0B',high:'#F97316',critical:'#EF4444'}

  const saveSLA = async () => {
    setSaving(true)
    const settings = {...sla, monthly_review: reviewSLA}
    if(isConfigured()) {
      await supabase.from('organisations').update({sla_settings:JSON.stringify(settings)}).eq('name',user.org)
    }
    setOrgSLA(settings)
    setSaving(false); setSaved(true)
    setTimeout(()=>setSaved(false), 2000)
  }

  const generateMonthlyReview = async () => {
    if(!confirm('Generate monthly review tasks for all managers and supervisors?')) return
    setGenerating(true)
    const now = new Date()
    const monthName = now.toLocaleString('en-AU',{month:'long',year:'numeric'})
    // Get all managers and supervisors in org
    const {data:members} = await supabase.from('org_members').select('user_id,role').eq('org',user.org).in('role',['manager','supervisor'])
    if(members?.length) {
      const ids = members.map(m=>m.user_id)
      const {data:profiles} = await supabase.from('profiles').select('id,name').in('id',ids)
      const tasks = members.map(m=>{
        const p = profiles?.find(x=>x.id===m.user_id)
        return {
          id: 'MR'+Date.now()+Math.random().toString(36).slice(2),
          title: `Monthly Review — ${monthName}`,
          category: 'Administration',
          priority: 'high',
          status: 'pending',
          org: user.org,
          assigned_user_id: m.user_id,
          assigned_user_name: p?.name||'',
          assigned_role: m.role,
          recurrence: 'once',
          compliance: true,
          due_date: new Date(now.getFullYear(), now.getMonth()+1, 0).toISOString().split('T')[0],
          created_by: user.name,
          created_at: new Date().toISOString(),
          subtasks: [], evidence: [], comments: [], escalation: false,
          sla_override: reviewSLA
        }
      })
      if(isConfigured()) await supabase.from('tasks').insert(tasks)
      if(loadTasks) loadTasks()
    }
    setGenerating(false)
    alert(`Monthly review tasks generated for ${members?.length||0} staff members.`)
  }

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-title">⚙️ SLA & Response Time Settings</div>
        <div className="ph-sub">{user.org} · Configure review response time limits</div>
      </div>

      {saved&&<div style={{background:'rgba(16,185,129,.08)',border:'1px solid rgba(16,185,129,.2)',borderRadius:10,padding:12,marginBottom:14,fontSize:13,color:'var(--green)',fontWeight:600}}>✅ Settings saved successfully</div>}

      <div className="section" style={{marginBottom:14}}>
        <div className="section-title">⏱ Review Response Times</div>
        <div style={{fontSize:12,color:'var(--t2)',marginBottom:16,lineHeight:1.6}}>
          How long a supervisor or manager has to review a submitted task before it auto-escalates to you. The clock starts when the worker submits the task.
        </div>
        {PRIORITIES.map(p=>(
          <div key={p} style={{display:'flex',alignItems:'center',gap:14,padding:'12px 0',borderBottom:'1px solid var(--border)'}}>
            <div style={{width:10,height:10,borderRadius:'50%',background:PRIORITY_COLORS[p],flexShrink:0}}/>
            <div style={{flex:1}}>
              <div style={{fontWeight:600,fontSize:13,textTransform:'capitalize'}}>{p} Priority</div>
              <div style={{fontSize:11,color:'var(--t2)',marginTop:1}}>Current: {fmtMinutes(sla[p]||DEFAULT_SLA[p])}</div>
            </div>
            <div style={{display:'flex',gap:6,alignItems:'center'}}>
              {[[30,'30m'],[60,'1h'],[240,'4h'],[480,'8h'],[1440,'1d'],[2880,'2d'],[4320,'3d']].map(([mins,label])=>(
                <button key={mins} onClick={()=>setSla({...sla,[p]:mins})}
                  style={{fontSize:11,padding:'4px 10px',borderRadius:6,border:'1px solid var(--border)',cursor:'pointer',fontFamily:'inherit',fontWeight:600,
                    background:sla[p]===mins?PRIORITY_COLORS[p]:sla[p]===mins?PRIORITY_COLORS[p]:'var(--s3)',
                    color:sla[p]===mins?'#fff':'var(--t2)'}}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="section" style={{marginBottom:14}}>
        <div className="section-title">📊 Monthly Review Response Time</div>
        <div style={{fontSize:12,color:'var(--t2)',marginBottom:12,lineHeight:1.6}}>
          How long managers and supervisors have to complete their monthly performance review task.
        </div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {[[1440,'1 day'],[2880,'2 days'],[4320,'3 days'],[7200,'5 days'],[10080,'1 week'],[20160,'2 weeks']].map(([mins,label])=>(
            <button key={mins} onClick={()=>setReviewSLA(mins)}
              style={{fontSize:12,padding:'6px 14px',borderRadius:8,border:'1px solid var(--border)',cursor:'pointer',fontFamily:'inherit',fontWeight:600,
                background:reviewSLA===mins?'var(--brand)':'var(--s3)',
                color:reviewSLA===mins?'#fff':'var(--t2)'}}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{display:'flex',gap:10,marginBottom:20}}>
        <button className="btn btn-primary" disabled={saving} onClick={saveSLA} style={{flex:1}}>{saving?'Saving...':'💾 Save SLA Settings'}</button>
      </div>

      <div className="section">
        <div className="section-title">📋 Monthly Review Tasks</div>
        <div style={{fontSize:12,color:'var(--t2)',marginBottom:14,lineHeight:1.6}}>
          Generate monthly review tasks for all managers and supervisors. Each person gets a task to complete their monthly report. Response time: <strong>{fmtMinutes(reviewSLA)}</strong>.
        </div>
        <div style={{background:'var(--s3)',borderRadius:10,padding:14,marginBottom:14,fontSize:12}}>
          <div style={{fontWeight:600,marginBottom:4}}>📅 What gets created:</div>
          <div style={{color:'var(--t2)',lineHeight:1.8}}>
            • Task title: "Monthly Review — {new Date().toLocaleString('en-AU',{month:'long',year:'numeric'})}"<br/>
            • Assigned to: all managers and supervisors in {user.org}<br/>
            • Due: last day of current month<br/>
            • Priority: High · Compliance: Yes<br/>
            • Response time: {fmtMinutes(reviewSLA)}
          </div>
        </div>
        <button className="btn btn-primary" disabled={generating} onClick={generateMonthlyReview} style={{width:'100%'}}>
          {generating?'Generating...':'🚀 Generate Monthly Review Tasks'}
        </button>
      </div>
    </div>
  )
}


function HelpView({ user }) {
  const [desc, setDesc] = useState('')
  const [device, setDevice] = useState('')
  const [screenshot, setScreenshot] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [tickets, setTickets] = useState([])
  const [leaveRecords, setLeaveRecords] = useState([])
  const [notifications, setNotifications] = useState([])
  const [showNotifPanel, setShowNotifPanel] = useState(false)
  const appVersion = '1.0.0'

  useEffect(()=>{
    // Detect device
    const ua = navigator.userAgent
    const d = /iPhone|iPad/.test(ua)?'iOS':(/Android/.test(ua)?'Android':(/Mac/.test(ua)?'Mac':'Desktop'))
    setDevice(d)
    // Load user's tickets
    if(isConfigured()) {
      supabase.from('support_tickets').select('*').eq('user_id',user.id).order('created_at',{ascending:false})
        .then(({data})=>{ if(data) setTickets(data) })
    }
  },[])

  const submitTicket = async () => {
    if(!desc.trim()) return
    setSubmitting(true)
    const ticket = {
      id: 'TKT'+Date.now(),
      user_id: user.id,
      user_name: user.name,
      user_email: user.email,
      org: user.org,
      role: user.role,
      description: desc.trim(),
      device,
      app_version: appVersion,
      screenshot: screenshot||null,
      status: 'open',
      created_at: new Date().toISOString()
    }
    if(isConfigured()) {
      await supabase.from('support_tickets').insert(ticket)
    }
    setTickets(prev=>[ticket,...prev])
    setSubmitted(true); setSubmitting(false); setDesc(''); setScreenshot(null)
    setTimeout(()=>setSubmitted(false), 4000)
  }

  const STATUS_COLORS = { open:'#F59E0B', in_progress:'#3B82F6', resolved:'#10B981', closed:'#6B7280' }

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-title">Help & Support</div>
        <div className="ph-sub">Report an issue or get help with Taksyn</div>
      </div>

      {submitted&&<div style={{background:'rgba(16,185,129,.08)',border:'1px solid rgba(16,185,129,.2)',borderRadius:10,padding:14,marginBottom:16,display:'flex',alignItems:'center',gap:10}}>
        <span style={{fontSize:20}}>✅</span>
        <div><div style={{fontWeight:700,color:'var(--green)'}}>Ticket submitted!</div><div style={{fontSize:12,color:'var(--t2)',marginTop:2}}>The Taksyn support team will get back to you shortly.</div></div>
      </div>}

      <div className="section" style={{marginBottom:14}}>
        <div className="section-title">🛠 Report a Technical Issue</div>
        <div className="form-field">
          <label className="form-label">Description <span style={{color:'var(--red)'}}>*</span></label>
          <textarea className="comment-box" style={{minHeight:100}} placeholder="Describe the issue you're experiencing. Include what you were doing when it happened..." value={desc} onChange={e=>setDesc(e.target.value)}/>
        </div>
        <div className="two-col">
          <div style={{background:'var(--s3)',borderRadius:8,padding:'8px 12px',fontSize:12}}>
            <div style={{color:'var(--t2)',fontSize:10,fontWeight:600,textTransform:'uppercase',marginBottom:2}}>Device</div>
            <div style={{fontWeight:600}}>{device||'Detecting...'}</div>
          </div>
          <div style={{background:'var(--s3)',borderRadius:8,padding:'8px 12px',fontSize:12}}>
            <div style={{color:'var(--t2)',fontSize:10,fontWeight:600,textTransform:'uppercase',marginBottom:2}}>App Version</div>
            <div style={{fontWeight:600}}>v{appVersion}</div>
          </div>
        </div>
        <div className="form-field" style={{marginTop:12}}>
          <label className="form-label">Screenshot (optional)</label>
          {screenshot
            ? <div style={{display:'flex',alignItems:'center',gap:10}}>
                <img src={screenshot} alt="screenshot" style={{height:60,borderRadius:6,border:'1px solid var(--border)'}}/>
                <button className="btn btn-secondary btn-sm" onClick={()=>setScreenshot(null)}>✕ Remove</button>
              </div>
            : <button className="btn btn-secondary" onClick={()=>document.getElementById('support-img').click()}>📷 Attach Screenshot</button>
          }
          <input id="support-img" type="file" accept="image/*" style={{display:'none'}} onChange={e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>setScreenshot(ev.target.result); r.readAsDataURL(f); e.target.value='' }}/>
        </div>
        <button className="btn btn-primary" disabled={!desc.trim()||submitting} onClick={submitTicket} style={{width:'100%',marginTop:4}}>
          {submitting?'Submitting...':'🚀 Submit Support Ticket'}
        </button>
      </div>

      <div className="section">
        <div className="section-title">📋 My Tickets</div>
        {tickets.length===0
          ? <div style={{fontSize:13,color:'var(--t2)',textAlign:'center',padding:16}}>No tickets yet — we hope everything is working smoothly! 😊</div>
          : tickets.map((t,i)=>(
            <div key={i} style={{padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:600,marginBottom:3,color:'var(--text)'}}>{t.description?.slice(0,80)}{t.description?.length>80?'...':''}</div>
                  <div style={{fontSize:10,color:'var(--t2)'}}>{new Date(t.created_at).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})} · {t.device} · v{t.app_version}</div>
                </div>
                <span style={{fontSize:10,padding:'2px 8px',borderRadius:10,fontWeight:600,background:(STATUS_COLORS[t.status]||'#6B7280')+'22',color:STATUS_COLORS[t.status]||'#6B7280',whiteSpace:'nowrap'}}>{t.status?.replace('_',' ').toUpperCase()}</span>
              </div>
              {t.response&&<div style={{marginTop:6,background:'rgba(0,168,126,.06)',border:'1px solid rgba(0,168,126,.15)',borderRadius:6,padding:'6px 10px',fontSize:12}}><span style={{color:'var(--brand)',fontWeight:600}}>💬 Taksyn Support:</span> {t.response}</div>}
            </div>
          ))
        }
      </div>

      <div className="section">
        <div className="section-title">📚 Quick Help</div>
        {[['How do I complete a task?','Time In → do the task → Time Out → Submit for Review. Your supervisor will then approve or send it back.'],
          ['Why is my task showing as overdue?','The due date has passed. Complete and submit it as soon as possible.'],
          ['How do I add evidence/photos?','Open the task → tap Take Photo or Gallery in the Evidence section.'],
          ['Who do I contact for account issues?','Submit a ticket above and the Taksyn support team will assist you.']
        ].map(([q,a],i)=>(
          <div key={i} style={{padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:4,color:'var(--text)'}}>❓ {q}</div>
            <div style={{fontSize:12,color:'var(--t2)',lineHeight:1.5}}>{a}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SupportView({ user, tickets=[], setTickets }) {
  const [filter, setFilter] = useState('open')
  const [showArchive, setShowArchive] = useState(false)
  const [archiveSearch, setArchiveSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [response, setResponse] = useState('')
  const [updating, setUpdating] = useState(false)

  // tickets loaded from App-level state

  const STATUS_COLORS = { open:'#F59E0B', in_progress:'#3B82F6', resolved:'#10B981', closed:'#6B7280' }
  const filtered = filter==='all' ? tickets.filter(t=>!['resolved','closed'].includes(t.status)) : tickets.filter(t=>t.status===filter)

  const updateTicket = async (id, changes) => {
    setUpdating(true)
    if(isConfigured()) await supabase.from('support_tickets').update(changes).eq('id',id)
    if(setTickets) setTickets(prev=>prev.map(t=>t.id===id?{...t,...changes}:t))
    setSelected(prev=>prev?.id===id?{...prev,...changes}:prev)
    setUpdating(false)
  }

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-top">
          <div>
            <div className="ph-title">Support Centre</div>
            <div className="ph-sub">{tickets.filter(t=>t.status==='open').length} open · {tickets.filter(t=>t.status==='in_progress').length} in progress · {tickets.length} total</div>
          </div>
          <button className={'btn btn-sm '+(showArchive?'btn-primary':'btn-secondary')} onClick={()=>setShowArchive(!showArchive)}>📦 {showArchive?'Active Tickets':'Archive'}</button>
        </div>
      </div>

      {showArchive ? (
        <div className="anim">
          <div className="section">
            <div className="section-title" style={{marginBottom:12}}>📦 Archived Tickets — Resolved & Closed</div>
            <input className="form-input" placeholder="Search by user, org or description..." value={archiveSearch} onChange={e=>setArchiveSearch(e.target.value)} style={{fontSize:12,marginBottom:12}}/>
            {(()=>{
              const archived = tickets
                .filter(t=>['resolved','closed'].includes(t.status))
                .filter(t=>!archiveSearch||t.description?.toLowerCase().includes(archiveSearch.toLowerCase())||t.user_name?.toLowerCase().includes(archiveSearch.toLowerCase())||t.org?.toLowerCase().includes(archiveSearch.toLowerCase()))
                .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))
              if(archived.length===0) return <div className="empty"><div className="empty-icon">📦</div><div className="empty-text">No archived tickets</div></div>
              return archived.map((t,i)=>(
                <div key={i} onClick={()=>{setSelected(t);setShowArchive(false)}} style={{background:'var(--s3)',border:'1px solid var(--border)',borderRadius:10,padding:12,marginBottom:8,cursor:'pointer',borderLeft:'4px solid '+(t.status==='resolved'?'#10B981':'#6B7280')}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:12,fontWeight:600,marginBottom:2}}>{t.description?.slice(0,80)}{t.description?.length>80?'...':''}</div>
                      <div style={{fontSize:11,color:'var(--t2)'}}>{t.user_name} · {t.org} · {new Date(t.created_at).toLocaleDateString('en-AU')}</div>
                    </div>
                    <span style={{fontSize:10,padding:'2px 8px',borderRadius:10,fontWeight:600,background:t.status==='resolved'?'rgba(16,185,129,.12)':'var(--s4)',color:t.status==='resolved'?'var(--green)':'var(--t2)',whiteSpace:'nowrap',alignSelf:'flex-start'}}>{t.status.toUpperCase()}</span>
                  </div>
                  {t.response&&<div style={{fontSize:11,color:'var(--green)',marginTop:4}}>💬 Replied</div>}
                </div>
              ))
            })()}
          </div>
        </div>
      ) : (
        <div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:14}}>
            {[['open','Open'],['in_progress','In Progress'],['all','All Active']].map(([v,l])=>(
              <button key={v} className={'btn btn-sm '+(filter===v?'btn-primary':'btn-secondary')} onClick={()=>setFilter(v)}>
                {l} <span style={{opacity:.6}}>({v==='all'?tickets.filter(t=>!['resolved','closed'].includes(t.status)).length:tickets.filter(t=>t.status===v).length})</span>
              </button>
            ))}
          </div>
          {selected ? (
            <div className="anim">
              <button className="back-btn" onClick={()=>setSelected(null)}><IC n="x" s={14}/> Back to tickets</button>
              <div className="section">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12,flexWrap:'wrap',gap:8}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:15}}>{selected.id}</div>
                    <div style={{fontSize:12,color:'var(--t2)',marginTop:2}}>{selected.user_name} · {selected.org} · {ROLE_LABELS[selected.role]}</div>
                    <div style={{fontSize:11,color:'var(--t2)',marginTop:1}}>{selected.user_email} · {selected.device} · v{selected.app_version}</div>
                    <div style={{fontSize:11,color:'var(--t2)',marginTop:1}}>{new Date(selected.created_at).toLocaleString('en-AU',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</div>
                  </div>
                  <select value={selected.status} onChange={e=>updateTicket(selected.id,{status:e.target.value})} style={{fontSize:12,fontWeight:700,border:'2px solid '+(STATUS_COLORS[selected.status]||'var(--border)'),borderRadius:8,padding:'6px 10px',background:(STATUS_COLORS[selected.status]||'#6B7280')+'22',color:STATUS_COLORS[selected.status]||'var(--t2)',cursor:'pointer',outline:'none',fontFamily:'inherit'}}>
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
                <div style={{background:'var(--s3)',borderRadius:8,padding:12,fontSize:13,lineHeight:1.6,marginBottom:14}}>{selected.description}</div>
                {selected.screenshot&&<img src={selected.screenshot} alt="screenshot" style={{width:'100%',maxWidth:400,borderRadius:8,border:'1px solid var(--border)',marginBottom:14}}/>}
                <div className="form-field">
                  <label className="form-label">Reply to User</label>
                  <textarea className="comment-box" style={{minHeight:80}} placeholder="Type your response..." value={response||selected.response||''} onChange={e=>setResponse(e.target.value)}/>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <button className="btn btn-primary" disabled={!response.trim()||updating} onClick={()=>{ updateTicket(selected.id,{response:response.trim(),status:'resolved'}); setResponse('') }}>✅ Send & Resolve</button>
                  <button className="btn btn-secondary" disabled={!response.trim()||updating} onClick={()=>{ updateTicket(selected.id,{response:response.trim()}); setResponse('') }}>💬 Send Reply</button>
                </div>
              </div>
            </div>
          ) : (
            <div>
              {filtered.length===0
                ? <div className="empty"><div className="empty-icon">🎉</div><div className="empty-text">No {filter==='all'?'active':filter} tickets</div></div>
                : filtered.map((t,i)=>(
                  <div key={i} onClick={()=>setSelected(t)} style={{background:'#fff',border:'1px solid var(--border)',borderRadius:10,padding:14,marginBottom:8,cursor:'pointer',borderLeft:'4px solid '+(STATUS_COLORS[t.status]||'var(--border)')}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:4,flexWrap:'wrap'}}>
                          <span style={{fontSize:11,fontWeight:700,color:'var(--t2)'}}>{t.id}</span>
                          <RolePill role={t.role}/>
                          <span style={{fontSize:11,color:'var(--t2)'}}>{t.org}</span>
                        </div>
                        <div style={{fontSize:13,fontWeight:600,marginBottom:3}}>{t.description?.slice(0,100)}{t.description?.length>100?'...':''}</div>
                        <div style={{fontSize:11,color:'var(--t2)'}}>{t.user_name} · {t.user_email} · {t.device}</div>
                        <div style={{fontSize:10,color:'var(--t3)',marginTop:2}}>{new Date(t.created_at).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
                      </div>
                      <div style={{display:'flex',flexDirection:'column',gap:4,alignItems:'flex-end'}}>
                        <span style={{fontSize:10,padding:'2px 8px',borderRadius:10,fontWeight:600,background:(STATUS_COLORS[t.status]||'#6B7280')+'22',color:STATUS_COLORS[t.status]||'#6B7280',whiteSpace:'nowrap'}}>{t.status?.replace('_',' ').toUpperCase()}</span>
                        {t.screenshot&&<span style={{fontSize:10,color:'var(--t2)'}}>📷</span>}
                        {t.response&&<span style={{fontSize:10,color:'var(--green)'}}>💬 Replied</span>}
                      </div>
                    </div>
                  </div>
                ))
              }
            </div>
          )}
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
  const [dragOver, setDragOver] = useState(null) // org id being dragged over
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [profileName, setProfileName] = useState('')
  const [profileMsg, setProfileMsg] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [undoStack, setUndoStack] = useState([])
  const [showUndo, setShowUndo] = useState(false)
  const [auditLog, setAuditLog] = useState([])
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false)
  const [tickets, setTickets] = useState([])
  const [leaveRecords, setLeaveRecords] = useState([])
  const [notifications, setNotifications] = useState([])
  const [orgSLA, setOrgSLA] = useState(DEFAULT_SLA)
  const orgSLARef = useRef(DEFAULT_SLA)
  const updateOrgSLA = (val) => { setOrgSLA(val); orgSLARef.current = val }
  const [showNotifPanel, setShowNotifPanel] = useState(false)
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

  const loadTickets = async () => {
    if(!isConfigured()) return
    const {data} = await supabase.from('support_tickets').select('*').order('created_at',{ascending:false}).limit(500)
    if(data) setTickets(data)
  }

  const loadTasks = async () => {
    if(!isConfigured()) return
    const { data } = await supabase.from('tasks').select('*').order('created_at',{ascending:false})
    if(data) {
      const newTasks = data.map(t=>({...t, subtasks:parseSafe(t.subtasks), evidence:parseSafe(t.evidence), comments:parseSafe(t.comments,[])}))
      setTasks(prev=>{
        // Generate notifications from status changes
        if(prev.length>0 && user) {
          const newNotifs = generateNotifications(newTasks, user, prev)
          if(newNotifs.length>0) {
            setNotifications(n=>{
              const existingIds = new Set(n.map(x=>x.id))
              const fresh = newNotifs.filter(x=>!existingIds.has(x.id))
              return [...fresh,...n].slice(0,50)
            })
          }
        }
        // SLA breach auto-escalation
        if(user && isConfigured()) {
          newTasks.filter(t=>
            t.status==='awaiting_review' &&
            t.submitted_at &&
            !t.escalation &&
            t.org?.toLowerCase()===user.org?.toLowerCase()
          ).forEach(t=>{
            const sla = getSLAStatus(t, orgSLARef.current)
            if(sla?.status==='breached') {
              supabase.from('tasks').update({escalation:true, status:'escalated', lastIntervention:'SLA breach — auto-escalated'}).eq('id',t.id).then(()=>{})
              setNotifications(n=>[{id:t.id+'_sla_breach', type:'sla', title:'SLA Breached 🚨', body:`"${t.title}" review deadline exceeded — auto-escalated`, taskId:t.id, at:new Date().toISOString(), read:false, color:'#EF4444'},...n].slice(0,50))
            }
          })
        }
        return newTasks
      })
    }
    loadAuditLog()
  }

  // keep topbar fixed on mobile

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
          if(data) { const u={...data,email:session.user.email}; setUser(u); localStorage.setItem('taksyn-user',JSON.stringify(u)); setNeedsPasswordSetup(false); if(isConfigured()&&!data.email) supabase.from('profiles').update({email:session.user.email}).eq('id',session.user.id).then(()=>{}) }
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

  useEffect(()=>{
    if(user&&isConfigured()) {
      loadTasks()
      if(user.role==='super_admin') loadTickets()
      // Load org SLA settings
      if(isConfigured()&&user.org) {
        supabase.from('organisations').select('sla_settings').eq('name',user.org).single()
          .then(({data})=>{ if(data?.sla_settings) updateOrgSLA({...DEFAULT_SLA,...JSON.parse(data.sla_settings)}) })
          .catch(()=>{})
      }
      // Load leave records for org
      if(isConfigured()&&user.org) {
        supabase.from('leave_records').select('*').eq('org',user.org)
          .then(({data})=>{ if(data) setLeaveRecords(data) }).catch(()=>{})
      }
      let reloadTimer = null
      const channel = supabase
        .channel('tasks-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, ()=>{
          // Debounce to avoid wiping optimistic updates
          clearTimeout(reloadTimer)
          reloadTimer = setTimeout(()=>loadTasks(), 1500)
        })
        .subscribe()
      return ()=>{ supabase.removeChannel(channel) }
    }
  },[user])

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
  const pageProps = { tasks, setTasks, user, setPage, loadTasks, search, pushUndo, auditLog, setAuditLog, tickets, setTickets, leaveRecords, orgSLA, setOrgSLA:updateOrgSLA }
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
          <button className="tb-icon-btn" onClick={()=>setShowNotifPanel(v=>!v)}>
            <IC n="bell" s={16}/>
            {notifications.filter(n=>!n.read).length>0&&<div className="tb-badge">{notifications.filter(n=>!n.read).length}</div>}
          </button>
          <div className="tb-user" onClick={()=>{setShowProfile(true);setProfileName(user.name);setProfileMsg('')}}>
            <Avatar name={user.name} role={user.role} size={26} avatarUrl={user.avatar_url}/>
            <div><div className="tb-user-name">{user.name?.split(' ')[0]}</div><div className="tb-user-role">{ROLE_LABELS[user.role]}</div></div>
          </div>
        </div>

        {/* Notification Panel */}
        {showNotifPanel&&(
          <>
            <div style={{position:'fixed',inset:0,zIndex:249}} onClick={()=>setShowNotifPanel(false)}/>
            <div className="notif-panel">
              <div style={{padding:'12px 14px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
                <div style={{fontWeight:700,fontSize:14}}>🔔 Notifications</div>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  {notifications.filter(n=>!n.read).length>0&&(
                    <button style={{fontSize:11,color:'var(--brand)',background:'none',border:'none',cursor:'pointer',fontFamily:'inherit',fontWeight:600}} onClick={()=>setNotifications(prev=>prev.map(n=>({...n,read:true})))}>Mark all read</button>
                  )}
                  <button style={{background:'none',border:'none',cursor:'pointer',color:'var(--t2)',fontSize:18,lineHeight:1}} onClick={()=>setShowNotifPanel(false)}>×</button>
                </div>
              </div>
              <div style={{overflowY:'auto',flex:1}}>
                {notifications.length===0 ? (
                  <div style={{padding:'40px 20px',textAlign:'center',color:'var(--t2)'}}>
                    <div style={{fontSize:28,marginBottom:8}}>🔔</div>
                    <div style={{fontSize:13}}>No notifications yet</div>
                  </div>
                ) : notifications.map((n,i)=>(
                  <div key={i} className={'notif-entry '+(n.read?'':'unread')} onClick={()=>{ setNotifications(prev=>prev.map((x,j)=>j===i?{...x,read:true}:x)); setShowNotifPanel(false); navigate('tasks') }}>
                    <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                      <div style={{width:8,height:8,borderRadius:'50%',background:n.color||'var(--brand)',marginTop:5,flexShrink:0}}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:n.read?400:600,color:'var(--text)'}}>{n.title}</div>
                        <div style={{fontSize:12,color:'var(--t2)',marginTop:2,lineHeight:1.4}}>{n.body}</div>
                        <div style={{fontSize:10,color:'var(--t3)',marginTop:3}}>{new Date(n.at).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {notifications.length>0&&(
                <div style={{padding:'8px 14px',borderTop:'1px solid var(--border)',flexShrink:0}}>
                  <button style={{fontSize:11,color:'var(--red)',background:'none',border:'none',cursor:'pointer',fontFamily:'inherit'}} onClick={()=>setNotifications([])}>Clear all</button>
                </div>
              )}
            </div>
          </>
        )}

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
                  {user.department&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:6}}><span style={{color:'var(--t2)',fontSize:11,textTransform:'uppercase',fontWeight:600,letterSpacing:'.6px'}}>Department</span><span style={{fontSize:12,fontWeight:600}}>{user.department}</span></div>}
                </div>
                {profileMsg&&<div style={{background:'rgba(16,185,129,.08)',border:'1px solid rgba(16,185,129,.2)',borderRadius:6,padding:'8px 12px',fontSize:13,color:'var(--green)',marginBottom:14}}>{profileMsg}</div>}
                <div className="form-field"><label className="form-label">Display Name</label><input className="form-input" value={profileName} onChange={e=>setProfileName(e.target.value)}/></div>
                <button className="btn btn-secondary btn-sm" style={{marginBottom:16}} onClick={async()=>{ if(!profileName.trim()) return; if(isConfigured()) await supabase.from('profiles').update({name:profileName.trim()}).eq('id',user.id); setUser(prev=>({...prev,name:profileName.trim()})); setProfileMsg('✓ Name updated') }}>Update Name</button>

                {['client_admin','super_admin'].includes(user.role)&&<>
                <div className="form-field">
                  <label className="form-label">Industry</label>
                  <select className="form-input" value={user.industry||''} onChange={async e=>{
                    const ind = e.target.value
                    setUser(prev=>({...prev,industry:ind,department:''}))
                    if(isConfigured()) await supabase.from('profiles').update({industry:ind,department:''}).eq('id',user.id)
                    setProfileMsg('✓ Industry updated')
                  }}>
                    <option value="">— Select industry —</option>
                    {Object.keys(DEPARTMENTS).map(k=><option key={k} value={k}>{k.replace('_',' ')}</option>)}
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">Department / Position</label>
                  <select className="form-input" value={user.department||''} onChange={async e=>{
                    const dept = e.target.value
                    setUser(prev=>({...prev,department:dept}))
                    if(isConfigured()) await supabase.from('profiles').update({department:dept}).eq('id',user.id)
                    setProfileMsg('✓ Department updated')
                  }}>
                    <option value="">— Select department —</option>
                    {(DEPARTMENTS[user.industry||'General']||DEPARTMENTS.General).map(d=><option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                </>}

                <div style={{background:'var(--s3)',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:13}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span style={{color:'var(--t2)',fontSize:11,textTransform:'uppercase',fontWeight:600,letterSpacing:'.6px'}}>Organisation</span>
                    <span style={{fontWeight:700,color:'var(--brand)'}}>{user.org||'—'}</span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:6}}>
                    <span style={{color:'var(--t2)',fontSize:11,textTransform:'uppercase',fontWeight:600,letterSpacing:'.6px'}}>Role</span>
                    <RolePill role={user.role}/>
                  </div>
                  {user.department&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:6}}>
                    <span style={{color:'var(--t2)',fontSize:11,textTransform:'uppercase',fontWeight:600,letterSpacing:'.6px'}}>Department</span>
                    <span style={{fontSize:12,fontWeight:600}}>{user.department}</span>
                  </div>}
                  <div style={{marginTop:8,paddingTop:8,borderTop:'1px solid var(--border)'}}>
                    <div style={{fontSize:11,color:'var(--t2)',marginBottom:4}}>Department / Position</div>
                    <select className="form-input" style={{fontSize:12}} value={user.department||''} onChange={async e=>{ const d=e.target.value; setUser(prev=>({...prev,department:d})); if(isConfigured()) await supabase.from('profiles').update({department:d}).eq('id',user.id) }}>
                      <option value="">— Not set —</option>
                      {(DEPARTMENTS[user.industry||'General']||DEPARTMENTS.General).map(d=><option key={d} value={d}>{d}</option>)}
                      {Object.values(DEPARTMENTS).flat().filter((d,i,a)=>a.indexOf(d)===i).sort().map(d=><option key={'all-'+d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  {['client_admin','manager'].includes(user.role)&&(
                    <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid var(--border)'}}>
                      <div style={{fontSize:11,color:'var(--t2)',marginBottom:6}}>Organisation Logo (used in reports)</div>
                      <div style={{display:'flex',alignItems:'center',gap:10}}>
                        {user.avatar_url&&<img src={user.avatar_url} alt="org logo" style={{height:32,objectFit:'contain',borderRadius:4,border:'1px solid var(--border)'}}/>}
                        <button className="btn btn-secondary btn-sm" onClick={()=>document.getElementById('org-logo-inp').click()}>
                          {user.avatar_url?'Change Logo':'Upload Logo'}
                        </button>
                        <input id="org-logo-inp" type="file" accept="image/*" style={{display:'none'}} onChange={async e=>{
                          const f=e.target.files[0]; if(!f) return
                          const r=new FileReader()
                          r.onload=async ev=>{
                            const d=ev.target.result
                            setUser(prev=>({...prev,avatar_url:d}))
                            if(isConfigured()) await supabase.from('profiles').update({avatar_url:d}).eq('id',user.id)
                            setProfileMsg('✓ Organisation logo updated — will appear in reports')
                          }
                          r.readAsDataURL(f); e.target.value=''
                        }}/>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{borderTop:'1px solid var(--border)',paddingTop:16,marginBottom:4}}>
                  <div style={{fontSize:12,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:12}}>Update Email</div>
                  <div className="form-field"><label className="form-label">New Email Address</label><input className="form-input" type="email" value={newEmail} onChange={e=>setNewEmail(e.target.value)} placeholder={user.email}/></div>
                  <button className="btn btn-secondary btn-sm" style={{marginBottom:16}} disabled={!newEmail.trim()||newEmail===user.email} onClick={async()=>{
                    if(!newEmail.trim()||newEmail===user.email) return
                    const {error} = await supabase.auth.updateUser({email:newEmail.trim()})
                    if(error) { setProfileMsg('✗ '+error.message); return }
                    // Also update profiles table so admins see the new email
                    await supabase.from('profiles').update({email:newEmail.trim()}).eq('id',user.id)
                    setUser(prev=>({...prev,email:newEmail.trim()}))
                    setProfileMsg('✓ Confirmation sent to '+newEmail+' — check your inbox to confirm the change')
                    setNewEmail('')
                  }}>Update Email</button>
                </div>

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
                {page==='dashboard'   && <DashboardView   {...pageProps} tickets={tickets} leaveRecords={leaveRecords}/>}
                {page==='tasks'       && (user.role==='super_admin' ? <SuperAdminTaskStats tasks={tasks} /> : <TasksView {...pageProps}/>)}
                {page==='evidence'    && hasAccess(user.role,2) && <EvidenceView   {...pageProps}/>}
                {page==='escalations' && hasAccess(user.role,2) && <EscalationsView {...pageProps}/>}
                {page==='reports'     && hasAccess(user.role,3) && <ReportsView    {...pageProps}/>}
                {page==='audit'       && hasAccess(user.role,2) && <AuditLogView   {...pageProps}/>}
                {page==='orgs'        && user.role==='super_admin' && <OrganisationsView {...pageProps}/>}
                {page==='users'       && hasAccess(user.role,4) && <UsersView      {...pageProps}/>}
                {page==='tiers'       && hasAccess(user.role,4) && <TiersView      {...pageProps}/>}
                {page==='support'     && user.role==='super_admin' && <SupportView {...pageProps}/>}
                {page==='help'        && <HelpView {...pageProps}/>}
                {page==='projects'    && hasAccess(user.role,2) && <ProjectsView {...pageProps}/>}
                {page==='performance' && hasAccess(user.role,4) && <PerformanceView {...pageProps}/>}
                {page==='leave'       && <LeaveView {...pageProps}/>}
                {page==='teams'       && hasAccess(user.role,2) && <TeamsView {...pageProps}/>}
                {page==='sla'         && user.role==='client_admin' && <SLASettingsView {...pageProps}/>}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
