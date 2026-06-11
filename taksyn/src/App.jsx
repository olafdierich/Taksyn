import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase.js'

const ROLES = ['super_admin','client_admin','manager','supervisor','worker']
const ROLE_LABELS = { super_admin:'Super Admin', client_admin:'Client Admin', manager:'Manager', supervisor:'Supervisor', worker:'Staff Member' }
const ROLE_COLORS = { super_admin:'#F59E0B', client_admin:'#8B5CF6', manager:'#3B82F6', supervisor:'#10B981', worker:'#6B7280' }
const TIERS = {
  Personal:     { color:'#6B7280', base:'$4',   perUser:'$2', users:'Max 4',    storage:'0.5GB', images:'—',     retention:'30 days',  features:['Basic task tracking','Simple checklists','Reminders'], locked:['Photo evidence','Escalation','Compliance reporting'] },
  Starter:      { color:'#3B82F6', base:'$19',  perUser:'$9', users:'1-10',     storage:'5GB',   images:'2/task',retention:'6 months', features:['Task assignment','Photo evidence','Basic reporting'], locked:['Escalation'] },
  Growth:       { color:'#10B981', base:'$39',  perUser:'$8', users:'11-30',    storage:'15GB',  images:'3/task',retention:'12 months',features:['Escalation cascade','GPS tracking','Performance tracking'], locked:[] },
  Professional: { color:'#8B5CF6', base:'$149', perUser:'$7', users:'31-100',   storage:'50GB',  images:'5/task',retention:'24 months',features:['Multi-site support','Advanced escalation','Audit-ready reporting'], locked:[] },
  Enterprise:   { color:'#F59E0B', base:'$399', perUser:'$6', users:'Unlimited',storage:'100GB+',images:'5/task',retention:'Custom',   features:['Full compliance suite','API integrations','White-labelling','Response Time SLAs'], locked:[] },
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
const PRESET_INDUSTRIES = ['Aged Care','Disability Care','Allied Health','Clinical','Community Services','Hospitality','Food & Beverage','Housekeeping','Mining & Resources','Oil & Gas','Construction','Engineering','Transport & Logistics','Administration','Compliance & Quality','IT & Technology','Security','Retail','Manufacturing','Project Management']
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
  if(remaining <= 0) return { status:'breached', remaining:0, pct:100, label:'Response Time Exceeded', color:'#EF4444' }
  if(remaining <= slaMinutes * 0.25) return { status:'warning', remaining, pct, label:remaining<60?Math.round(remaining)+'m left':Math.round(remaining/60)+'h left', color:'#F97316' }
  return { status:'ok', remaining, pct, label:remaining<60?Math.round(remaining)+'m left':Math.round(remaining/60)+'h left', color:'#10B981' }
}

const isRecurring = t => t.recurrence && t.recurrence !== '' && t.recurrence !== 'once' && t.recurrence !== null
const isOneOff = t => !isRecurring(t)
const hasAccess = (userRole, requiredLevel) => (ROLE_LEVEL[userRole]||0) >= requiredLevel
const PAGE_ACCESS = { dashboard:1, tasks:1, evidence:2, escalations:2, reports:3, users:4, tiers:4, orgs:5, support:5, help:1, projects:2, performance:4, leave:1, teams:2, sla:4, company_settings:4, platform_industries:5, roles_departments:4, platform_settings:5, my_account:1 }
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
        alerts.push({ type:'overdue_worker', task:t, msg:`Staff Member task overdue: "${t.title}" assigned to ${t.assigned_user_name||'staff member'}`, level:'red' })
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
        alerts.push({ type:'sla_breach', task:t, msg:`Response time exceeded: "${t.title}" — review overdue (${t.priority} priority)`, level:'red' })
      } else if(sla?.status==='warning') {
        alerts.push({ type:'sla_warning', task:t, msg:`Response time warning: "${t.title}" — only ${sla.label} to review (${t.priority} priority)`, level:'amber' })
      }
    }
  })

  return alerts
}

const NOTIF_TYPE_ICONS = {
  overdue:'🔴', submitted:'🟡', approved:'✅', rejected:'⚠️',
  escalated:'🚨', assigned:'📋', comment:'💬', sla:'🔒',
}
const DEFAULT_NOTIF_PREFS = {
  overdue:true, submitted:true, approved:true, rejected:true,
  escalated:true, assigned:true, comment:true, sla:true, sound:false
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
        notifs.push({ id:t.id+'_submitted', type:'submitted', title:'Task submitted for review', body:`"${t.title}" submitted by ${t.completed_by||t.assigned_user_name||'staff member'}`, taskId:t.id, at:new Date().toISOString(), read:false, color:'#F59E0B' })
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

// Writes one row to audit_logs — fire-and-forget, safe to call anywhere.
const logAuditEvent = (user, action, entityType=null, entityId=null, entityName=null, details=null) => {
  if (!isConfigured() || !user) return
  const entry = {
    organisation_id: user.org||'',
    user_id: user.id||null,
    user_name: user.name||'',
    action,
    entity_type: entityType||null,
    entity_id: entityId!=null ? String(entityId) : null,
    entity_name: entityName||null,
    details: details!=null ? (typeof details==='object' ? JSON.stringify(details) : String(details)) : null
  }
  // secondary log disabled — audit_log inserts handled via mkAuditEntry
}

const mkAuditEntry = (event_type, user, org, detail={}, task_id=null, task_title=null, old_value=null, new_value=null) => ({
  id: Date.now()+'-'+Math.random().toString(36).slice(2,5),
  event_type,
  taskId: task_id,
  taskTitle: task_title,
  task_title,
  by: user?.name||'',
  byRole: user?.role||'',
  org: org||user?.org||'',
  at: new Date().toISOString(),
  details: detail ? (typeof detail==='object' ? JSON.stringify(detail) : String(detail)) : null,
  old_value: old_value!=null ? String(old_value) : null,
  new_value: new_value!=null ? String(new_value) : null,
  isIntervention: user?.role==='super_admin',
  interventionReason: detail?.interventionReason||null,
})

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
.app{display:flex;flex-direction:column;height:100%;position:fixed;top:0;left:0;right:0;bottom:0;padding-top:52px}
.topbar{position:fixed;top:0;left:0;right:0;display:flex;align-items:center;gap:12px;padding:0 16px;height:52px;background:#fff;border-bottom:1px solid var(--border);flex-shrink:0;z-index:300}
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
.main{display:flex;flex:1;overflow:hidden;min-height:0;position:relative}
.sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:250}
.sidebar-overlay.open{display:block}
.sidebar{width:var(--sidebar-w);flex-shrink:0;background:#fff;border-right:1px solid var(--border);display:flex;flex-direction:column;overflow-y:auto;overflow-x:hidden;transition:transform .25s,width .25s;z-index:160}
.sidebar.collapsed{width:52px}
@media(max-width:768px){.sidebar{position:absolute;top:0;left:0;bottom:0;transform:translateX(-100%);width:var(--sidebar-w) !important;z-index:260}.sidebar.mobile-open{transform:translateX(0)}}
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
.cl-item{display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)}
.cl-item:last-child{border-bottom:none}
.cl-body{flex:1;min-width:0}
.cl-text{font-size:13px;font-weight:500;line-height:1.4}
.cl-text.done{text-decoration:line-through;color:var(--t2)}
.cl-mandatory{color:var(--red);font-weight:800;margin-left:4px}
.cl-note{font-size:11px;color:var(--t2);margin-top:3px;font-style:italic}
.cl-photo-thumb{width:40px;height:40px;border-radius:6px;object-fit:cover;border:1px solid var(--border);flex-shrink:0;cursor:pointer}
.cl-actions{display:flex;gap:4px;align-items:center;margin-top:6px;flex-wrap:wrap}
.cl-action-btn{background:none;border:1px solid var(--border);border-radius:5px;padding:3px 8px;font-size:10px;cursor:pointer;color:var(--t2);font-family:inherit;white-space:nowrap;transition:all .15s}
.cl-action-btn:hover{background:var(--s3)}
.cl-prog{display:flex;align-items:center;gap:10px;padding:8px 0 12px}
.cl-prog-bar{flex:1;height:6px;background:var(--s3);border-radius:3px;overflow:hidden}
.cl-prog-fill{height:100%;border-radius:3px;background:var(--brand);transition:width .3s}
.cl-warn{background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:10px 14px;margin-bottom:10px;font-size:12px;color:var(--red)}
.cl-build-item{display:flex;gap:6px;align-items:center;margin-bottom:6px}
.cl-flag-btn{padding:5px 8px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s}
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
.btn-back-dashboard{justify-content:center}
@media(max-width:768px){.btn-back-dashboard{width:100%}}
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
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:400;display:flex;align-items:flex-end;justify-content:center;padding:0;backdrop-filter:blur(3px)}
@media(min-width:600px){.modal-overlay{align-items:center;padding:20px}}
.modal{background:#fff;border-radius:16px 16px 0 0;width:100%;max-width:520px;max-height:95vh;overflow-y:auto;box-shadow:0 -4px 40px rgba(0,0,0,.15);display:flex;flex-direction:column}
@media(min-width:600px){.modal{border-radius:14px;max-height:85vh}}
.modal-hdr{display:flex;align-items:center;justify-content:space-between;padding:18px 20px 12px;position:sticky;top:0;background:#fff;z-index:10;border-bottom:1px solid var(--border);flex-shrink:0}
.modal-title{font-size:15px;font-weight:700}
.modal-close{background:none;border:none;color:var(--t2);cursor:pointer;font-size:22px;line-height:1;padding:2px;flex-shrink:0}
.modal-body{padding:16px 20px;overflow-y:auto;flex:1;padding-bottom:calc(20px + env(safe-area-inset-bottom,0))}
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
.notif-entry.unread{background:rgba(59,130,246,.04);border-left:3px solid #3B82F6}
.notif-entry.unread:hover{background:rgba(59,130,246,.08)}
.notif-entry.read{border-left:3px solid var(--green)}
.notif-entry.read:hover{background:var(--s3)}
.notif-group-lbl{padding:5px 14px 3px;font-size:10px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.8px;background:var(--s3);border-bottom:1px solid var(--border)}
.notif-actions{display:flex;gap:2px;align-items:center;flex-shrink:0;margin-left:4px}
.notif-icon-btn{background:none;border:none;cursor:pointer;padding:3px 5px;border-radius:4px;font-size:12px;line-height:1;color:var(--t3);font-family:inherit;transition:all .15s}
.notif-icon-btn:hover{color:var(--text)}
.notif-icon-btn.del{min-width:28px;min-height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:17px;padding:4px}
.notif-icon-btn.del:hover,.notif-icon-btn.del:active{color:var(--red);background:rgba(239,68,68,.12)}
.notif-icon-btn.chk:hover{color:var(--green)}
.notif-summary{padding:8px 14px;background:rgba(59,130,246,.04);border-bottom:1px solid var(--border);font-size:11px;color:var(--t2)}
.notif-settings-panel{padding:10px 14px;border-bottom:1px solid var(--border);background:var(--s3)}
.bottom-nav{display:none}
.org-actions{display:flex;gap:6px;flex-wrap:wrap}
@media(max-width:768px){.org-actions>.btn,.org-actions>label{flex:1 1 auto;justify-content:center}}
.org-grid{display:grid;grid-template-columns:1fr;gap:12px}
@media(min-width:600px){.org-grid{grid-template-columns:repeat(2,1fr)}}
@media(min-width:1024px){.org-grid{grid-template-columns:repeat(3,1fr)}}
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
    settings:'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  }
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d={paths[n]||paths.check} /></svg>
}

const StatusBadge = ({ status }) => { const c = STATUS_CFG[status]||STATUS_CFG.pending; return <span className="badge" style={{color:c.color,background:c.bg}}>{c.label}</span> }
const PriBadge = ({ priority }) => { const c = PRIORITY_CFG[priority]||PRIORITY_CFG.medium; return <span className="badge" style={{color:c.color,background:c.color+'22'}}>{c.label}</span> }
const RolePill = ({ role }) => <span className="role-pill" style={{color:avatarColor(role),background:avatarColor(role)+'22'}}>{ROLE_LABELS[role]||role}</span>
const POSITION_ROLE_COLORS = { manager:'#8B5CF6', supervisor:'#F59E0B', worker:'#3B82F6' }
const PositionChip = ({ pos, onRemove }) => {
  const c = POSITION_ROLE_COLORS[pos.role]||'#6B7280'
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 8px',borderRadius:12,fontSize:10,fontWeight:600,background:c+'18',color:c,border:'1px solid '+c+'44',whiteSpace:'nowrap'}}>
      {CAT_ICONS[pos.department]||'🏢'} {pos.position_title||ROLE_LABELS[pos.role]} · {pos.department}
      {pos.is_primary&&<span style={{fontSize:9,opacity:.7}}>★</span>}
      {onRemove&&<button onClick={onRemove} style={{background:'none',border:'none',cursor:'pointer',color:c,fontSize:12,lineHeight:1,padding:'0 0 0 2px',fontFamily:'inherit'}}>×</button>}
    </span>
  )
}
const getUserDeptRole = (u, dept) => {
  const positions = u.positions||[]
  const match = positions.find(p=>p.department===dept)
  if (match) return (match.position_title||ROLE_LABELS[match.role]||match.role)+' ('+dept+')'
  return ROLE_LABELS[u.role]||u.role
}
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
        {task.compliance&&!task.evidence?.length&&!['awaiting_review','approved','completed'].includes(task.status)&&<span style={{fontSize:11,color:'#8B5CF6',background:'rgba(139,92,246,.08)',padding:'2px 6px',borderRadius:4,fontWeight:600}}>📷 required</span>}
        {task.compliance&&<span className="badge" style={{background:'rgba(139,92,246,.1)',color:'#8B5CF6'}}>🔒</span>}
        {task.project&&<span style={{fontSize:11,color:'#3B82F6',background:'rgba(59,130,246,.08)',padding:'2px 7px',borderRadius:4}}>📁 {task.project}</span>}

        {dur&&<span style={{fontSize:11,color:'var(--t2)'}}>⏱ {dur}</span>}
        {task.gps_start&&<a href={"https://www.google.com/maps?q="+task.gps_start} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:'var(--blue)',textDecoration:'none'}} onClick={e=>e.stopPropagation()}>📍 GPS ↗</a>}
      </div>

      {(()=>{
        const subs = Array.isArray(task.subtasks)?task.subtasks:parseSafe(task.subtasks)
        if(!subs.length) return null
        const done = subs.filter(s=>s.done).length
        const pct = Math.round(done/subs.length*100)
        return <div className="mini-prog" style={{marginTop:6}}><div className="mini-prog-bar"><div className="mini-prog-fill" style={{width:pct+'%',background:pct===100?'var(--green)':'var(--brand)'}}/></div><span style={{fontSize:10,color:'var(--t2)'}}>{done}/{subs.length} items</span></div>
      })()}
      {task.escalation&&<div className="esc-flag">⚠️ Escalated</div>}
    </div>
  )
}

function AuthView({ onAuth }) {
  // Parse URL params once synchronously so initial state is correct — avoids the login→register flash
  const _sp = new URLSearchParams(window.location.search)
  const _isInvite = _sp.get('invite')==='true' && _sp.get('secret')==='taksyn-secret-2024'

  const [mode, setMode] = useState(_isInvite ? 'register' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [org, setOrg] = useState('')
  const [signupType, setSignupType] = useState(_isInvite ? 'staff' : 'organisation')
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(_isInvite && _sp.get('secret')!=='taksyn-secret-2024' ? 'Invalid invite link — please ask your admin for a new one' : '')
  const [success, setSuccess] = useState('')
  const [orgChoices, setOrgChoices] = useState(null)
  const [showPw, setShowPw] = useState(false)
  const [pendingAuthUser, setPendingAuthUser] = useState(null)
  const [inviteToken, setInviteToken] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [orgs, setOrgs] = useState([])
  // Invite params: set immediately from URL, names resolved async
  const [inviteParams, setInviteParams] = useState(_isInvite ? {
    orgId: _sp.get('org')||'',
    orgName: null,   // filled in async
    teamId: _sp.get('team')||null,
    teamName: null,  // filled in async
    role: _sp.get('role')||'worker',
    position: _sp.get('position')||'',
    linkId: _sp.get('link')||null
  } : null)

  useEffect(()=>{
    // Supabase email-invite token (in URL hash)
    const hash = window.location.hash
    const hashParams = new URLSearchParams(hash.replace('#','?').replace('#','&'))
    const accessToken = hashParams.get('access_token')
    const type = hashParams.get('type')
    if (accessToken && (type==='invite' || type==='recovery')) {
      window.__taksyn_invite_flow = true
      setInviteToken(accessToken)
      window.history.replaceState(null, '', window.location.pathname)
    }

    // Resolve org/team names for the invite card, then clear the URL
    if (_isInvite && isConfigured()) {
      const orgId  = _sp.get('org')||''
      const teamId = _sp.get('team')||''
      Promise.all([
        supabase.from('organisations').select('id,name').eq('id', orgId).single(),
        teamId ? supabase.from('teams').select('id,name').eq('id', teamId).single() : Promise.resolve({data:null})
      ]).then(([{data:orgData}, {data:teamData}])=>{
        setInviteParams(prev => prev ? {...prev, orgName:orgData?.name||orgId, teamName:teamData?.name||null} : prev)
      }).catch(()=>{
        setInviteParams(prev => prev ? {...prev, orgName:orgId} : prev)
      })
      window.history.replaceState(null, '', window.location.pathname)
    }

    // Load orgs list for the staff registration dropdown (organisations table has RLS disabled)
    if (isConfigured()) {
      supabase.from('organisations').select('id,name').order('name')
        .then(({data})=>{ if(data) setOrgs(data) }).catch(()=>{})
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
        if (!name.trim()) { setError('Please enter your full name'); setLoading(false); return }
        let orgName, assignedRole
        if (inviteParams) {
          orgName = inviteParams.orgName
          assignedRole = inviteParams.role
        } else if (signupType==='organisation') {
          if (!org.trim()) { setError('Please enter your organisation name'); setLoading(false); return }
          orgName = org.trim()
          assignedRole = 'client_admin'
        } else {
          if (!inviteCode.trim()) { setError('Please select your organisation'); setLoading(false); return }
          orgName = inviteCode.trim()
          assignedRole = 'worker'
        }
        const { data:signUpData, error:e } = await supabase.auth.signUp({
          email, password,
          options:{ data:{ name:name.trim(), role:assignedRole, org:orgName } }
        })
        if (e) throw e
        if (signUpData?.user) {
          const uid = signUpData.user.id
          await supabase.from('profiles').upsert({ id:uid, name:name.trim(), role:assignedRole, org:orgName, tier:'Growth' })
          await supabase.from('org_members').upsert(
            { user_id:uid, org:orgName, role:assignedRole, tier:'Growth' },
            { onConflict: 'user_id,org' }
          )
          if (inviteParams?.teamId) {
            await supabase.from('team_members').insert({
              id: 'TM'+Date.now(), team_id:inviteParams.teamId, user_id:uid,
              user_name:name.trim(), role:assignedRole, org:orgName,
              added_by:'invite_link', added_at:new Date().toISOString()
            }).catch(()=>{})
          }
          // user_positions table removed
          if (inviteParams?.linkId) {
            // Mark this specific invite link as used by ID
            supabase.from('invite_links').update({ used_at:new Date().toISOString(), used_by:name.trim() })
              .eq('id', inviteParams.linkId).then(()=>{}).catch(()=>{})
          }
          // Auto sign-in if Supabase returned a session (email confirmation disabled in project)
          if (inviteParams && signUpData.session) {
            const { data:profile } = await supabase.from('profiles').select('*').eq('id',uid).single()
            if (profile) {
              const userData = {...profile, email:signUpData.user.email, role:assignedRole, org:orgName}
              onAuth(userData)
              return
            }
          }
        }
        setSuccess(inviteParams || signupType==='staff'
          ? 'Account created! Check your email to confirm, then sign in.'
          : 'Account created! Check your email to confirm, then sign in as your org admin.')
        setMode('login'); setLoading(false)
      } else {
        // Race login against 10s timeout using the main persistent client
        const loginResult = await Promise.race([
          supabase.auth.signInWithPassword({ email, password }),
          new Promise((_,reject) => setTimeout(()=>reject(new Error('Login timed out. Please try again.')), 10000))
        ])
        const { data, error:e } = loginResult
        if (e) throw e
        if (data?.user) {
          const { data:profile } = await supabase.from('profiles').select('*').eq('id',data.user.id).single()
          if (profile) {
            // Check org_members for multiple org memberships
            const { data:memberships } = await supabase.from('org_members').select('*').eq('user_id',data.user.id)
            if (memberships && memberships.length > 1) {
              // Multiple orgs — show picker
              // Enrich memberships with resolved org names (org_members.org may store an ID)
              const {data:orgRows} = await supabase.from('organisations').select('id,name').catch(()=>({data:[]}))
              const enriched = memberships.map(m => {
                const orgRow = orgRows?.find(o=>o.id===m.org||o.name===m.org)
                return {...m, orgName: orgRow?.name || m.org}
              })
              setPendingAuthUser({...profile, email:data.user.email})
              setOrgChoices(enriched)
              setLoading(false)
              return
            } else if (memberships && memberships.length === 1) {
              // Single org from org_members — use that role/org
              // Prefer profile.org (always a name) over m.org (may be an ID)
              const m = memberships[0]
              const userData = {...profile, email:data.user.email, role:m.role, org:profile.org||m.org, tier:m.tier||'Growth'}
              onAuth(userData)
            } else {
              // No org_members entry — use profile directly (legacy/super_admin)
              const userData = {...profile, email:data.user.email}
              onAuth(userData)
            }
          } else {
            const userData = { id:data.user.id, email:data.user.email, name:data.user.email.split('@')[0], role:'worker', tier:'Growth', org:'My Organisation' }
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
            {[...orgChoices].sort((a,b)=>(a.orgName||a.org).localeCompare(b.orgName||b.org)||(a.role.localeCompare(b.role))).map((m,i)=>(
              <button key={i} onClick={()=>{
                // Prefer resolved org name; fall back to m.org which may be an ID
                const userData = {...pendingAuthUser, role:m.role, org:m.orgName||pendingAuthUser.org||m.org, tier:m.tier||'Growth'}
                onAuth(userData)
              }} style={{padding:'14px 16px',borderRadius:8,border:'1px solid var(--border)',background:'var(--s3)',cursor:'pointer',textAlign:'left',transition:'all .15s'}}
              onMouseOver={e=>e.currentTarget.style.borderColor='var(--brand)'}
              onMouseOut={e=>e.currentTarget.style.borderColor='var(--border)'}>
                <div style={{fontWeight:700,fontSize:14}}>{m.orgName||m.org}</div>
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
        {mode==='register'&&!inviteParams&&(
          <div style={{display:'flex',gap:8,marginBottom:4}}>
            <button onClick={()=>setSignupType('organisation')} style={{flex:1,padding:'8px',borderRadius:6,border:'2px solid '+(signupType==='organisation'?'var(--brand)':'var(--border)'),background:signupType==='organisation'?'var(--brand-lt)':'none',color:signupType==='organisation'?'var(--brand)':'var(--t2)',cursor:'pointer',fontSize:12,fontWeight:600}}>🏢 New Organisation</button>
            <button onClick={()=>setSignupType('staff')} style={{flex:1,padding:'8px',borderRadius:6,border:'2px solid '+(signupType==='staff'?'var(--brand)':'var(--border)'),background:signupType==='staff'?'var(--brand-lt)':'none',color:signupType==='staff'?'var(--brand)':'var(--t2)',cursor:'pointer',fontSize:12,fontWeight:600}}>👤 Join Organisation</button>
          </div>
        )}
        {mode==='register'&&inviteParams&&(
          <div style={{background:'rgba(16,185,129,.07)',border:'1px solid rgba(16,185,129,.25)',borderRadius:8,padding:'10px 14px',marginBottom:8}}>
            <div style={{fontSize:11,fontWeight:700,color:'#10B981',marginBottom:6,textTransform:'uppercase',letterSpacing:'.6px'}}>✓ You have been invited</div>
            <div style={{display:'flex',flexDirection:'column',gap:3}}>
              <div style={{fontSize:12,color:'var(--t1)'}}><span style={{color:'var(--t2)'}}>Organisation: </span><strong>{inviteParams.orgName||<span style={{color:'var(--t3)',fontStyle:'italic'}}>Loading…</span>}</strong></div>
              {(inviteParams.teamId)&&<div style={{fontSize:12,color:'var(--t1)'}}><span style={{color:'var(--t2)'}}>Team: </span><strong>{inviteParams.teamName||<span style={{color:'var(--t3)',fontStyle:'italic'}}>Loading…</span>}</strong></div>}
              <div style={{fontSize:12,color:'var(--t1)'}}><span style={{color:'var(--t2)'}}>Role: </span><strong>{ROLE_LABELS[inviteParams.role]||inviteParams.role}</strong></div>
              {inviteParams.position&&<div style={{fontSize:12,color:'var(--t1)'}}><span style={{color:'var(--t2)'}}>Position: </span><strong>{inviteParams.position}</strong></div>}
            </div>
          </div>
        )}
        {mode==='register'&&<div className="auth-field"><label className="auth-label">Full Name</label><input className="auth-input" placeholder="Your full name" value={name} onChange={e=>setName(e.target.value)} /></div>}
        <div className="auth-field"><label className="auth-label">Email</label><input className="auth-input" type="email" placeholder="you@organisation.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleSubmit()} /></div>
        {mode!=='forgot'&&<div className="auth-field"><label className="auth-label">Password</label><div style={{position:'relative'}}><input className="auth-input" type={showPw?'text':'password'} placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleSubmit()} style={{paddingRight:36}}/><button type="button" onClick={()=>setShowPw(!showPw)} style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'var(--t2)',fontSize:16,lineHeight:1,padding:2}}>{showPw?'👁':'🔒'}</button></div></div>}
        {mode==='register'&&signupType==='organisation'&&!inviteParams&&<div className="auth-field"><label className="auth-label">Organisation Name</label><input className="auth-input" placeholder="e.g. Sunrise Aged Care" value={org} onChange={e=>setOrg(e.target.value)} /></div>}
        {mode==='register'&&signupType==='staff'&&!inviteParams&&(
          <div className="auth-field">
            <label className="auth-label">Organisation</label>
            {orgs.length>0
              ? <select className="auth-input" value={inviteCode} onChange={e=>setInviteCode(e.target.value)} style={{cursor:'pointer'}}>
                  <option value="">— Select your organisation —</option>
                  {orgs.map(o=><option key={o.id} value={o.name}>{o.name}</option>)}
                </select>
              : <input className="auth-input" placeholder="Enter your exact organisation name" value={inviteCode} onChange={e=>setInviteCode(e.target.value)} />
            }
          </div>
        )}
        {mode==='register'&&!inviteParams&&<div style={{fontSize:11,color:'var(--t2)',marginBottom:8,padding:'6px 10px',background:'var(--s3)',borderRadius:6}}>{signupType==='organisation'?'🏢 You will be set up as the Client Admin for your organisation':'👤 You will join as a Staff Member — your admin can change your role'}</div>}
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
  if (user.role==='super_admin') return <SuperAdminDashboard user={user} setPage={setPage} tickets={tickets}/>
  // Filter tasks by org
  const visibleAll = visibleTasks(tasks, user)
  const visible = visibleAll
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
  const isCA=user.role==='client_admin', isMgr=user.role==='manager', isSup=user.role==='supervisor', isWkr=user.role==='worker'
  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-title">{isCA?'Organisation Dashboard':isMgr?'Team Dashboard':isSup?'Supervisor Dashboard':'My Tasks Today'}</div>
        <div className="ph-sub">{isWkr?'Hello '+user.name.split(' ')[0]+' — your tasks for today':user.org+' · '+visible.length+' tasks'}</div>
      </div>
      <div className="stat-grid">
        {(isCA||isMgr)&&<><Stat label="Total Tasks" val={visible.length} sub={pending+" pending"} icon="📋"/><Stat label="Completion" val={rate+"%"} sub={done+" done"} color="#10B981" bg="rgba(16,185,129,.1)" icon="✅"/><Stat label="Overdue" val={overdue} sub={overdue>0?'Action needed':'On track'} color={overdue>0?'#EF4444':'#10B981'} bg={overdue>0?'rgba(239,68,68,.1)':'rgba(16,185,129,.1)'} icon="⏰"/><Stat label="Escalations" val={esc} sub={esc>0?'Active':'Clear'} color={esc>0?'#EF4444':'#6B7280'} bg="rgba(107,114,128,.1)" icon="🚨"/></>}
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
      {isMgr&&false&&awards.week&&<div className="section"><div className="section-title">🏆 Staff Recognition</div><div className="award-card"><div className="award-icon">🥇</div><div><div className="award-title">Staff Member of the Week</div><div className="award-name">{awards.week.name}</div><div className="award-sub">{awards.week.count} tasks completed</div></div></div></div>}
      <div className="two-col">
        <div className="section">
          {(isCA||isMgr)&&<><div className="section-title">Compliance Score</div><div style={{display:'flex',alignItems:'center',gap:16}}><div className="score-ring"><div className="score-val">{pct(compDone,compT.length)}%</div><div className="score-lbl">Score</div></div><div><div style={{fontSize:13,marginBottom:3}}>{compDone}/{compT.length} compliance tasks done</div><div style={{fontSize:12,color:'var(--t2)'}}>{compT.filter(t=>t.status==='overdue').length} critical overdue</div></div></div></>}
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
        {visible.filter(t=>!['completed','approved'].includes(t.status)||isRecurring(t)).slice(0,5).map(t=><TaskCard key={t.id} task={t} onClick={()=>setPage('tasks')}/>)}
        {visible.filter(t=>!['completed','approved'].includes(t.status)||isRecurring(t)).length===0&&<div className="empty"><div className="empty-icon">🎉</div><div className="empty-text">All tasks complete!</div></div>}
      </div>
    </div>
  )
}

function SuperAdminDashboard({ user, setPage, tickets=[] }) {
  const [stats, setStats] = useState({ orgs:0, users:0 })
  const [recentAudit, setRecentAudit] = useState([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searching, setSearching] = useState(false)

  const ACTION_LABEL = {
    'task.created':'Task Created','task.assigned':'Task Assigned','task.status_changed':'Status Changed',
    'task.approved':'Approved','task.rejected':'Sent Back','task.escalated':'Escalated',
    'task.deleted':'Task Deleted','task.comment_added':'Comment Added','task.evidence_added':'Evidence Added',
    'task.checklist_toggled':'Checklist','checklist_item_completed':'Item Completed',
    'leave.submitted':'Leave Submitted','leave.cancelled':'Leave Cancelled',
    'member.invited':'Member Invited','member.role_changed':'Role Changed',
    'member.edited':'Member Updated','member.removed':'Member Removed',
    'session.logout':'Signed Out',
  }

  useEffect(()=>{
    if(!isConfigured()) return
    supabase.from('organisations').select('id',{count:'exact',head:true}).then(({count})=>setStats(p=>({...p,orgs:count||0}))).catch(()=>{})
    supabase.from('profiles').select('id',{count:'exact',head:true}).then(({count})=>setStats(p=>({...p,users:count||0}))).catch(()=>{})
    setAuditLoading(true)
    supabase.from('audit_log').select('id,event_type,by,org,at')
      .order('at',{ascending:false}).limit(10)
      .then(({data})=>{ if(data) setRecentAudit(data) }).catch(()=>{}).finally(()=>setAuditLoading(false))
  },[])

  const doSearch = async () => {
    const s = search.trim()
    if(!s||!isConfigured()) return
    setSearching(true)
    const [orgRes, userRes] = await Promise.all([
      supabase.from('organisations').select('id,name,plan,status').ilike('name','%'+s+'%').limit(5),
      supabase.from('profiles').select('id,name,role,org').ilike('name','%'+s+'%').limit(5)
    ])
    setSearchResults({ orgs:orgRes.data||[], users:userRes.data||[] })
    setSearching(false)
  }

  const openTickets = tickets.filter(t=>t.status==='open'||t.status==='in_progress').length
  const fmtTs = (d) => {
    if(!d) return '—'
    const dt=new Date(d), now=new Date()
    const t=dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
    if(dt.toDateString()===now.toDateString()) return 'Today '+t
    return dt.toLocaleDateString('en-AU',{day:'numeric',month:'short'})+' '+t
  }

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-title">Platform Support Dashboard</div>
        <div className="ph-sub">Organisation structure and support tools — operational data is private to each org</div>
      </div>

      <div style={{background:'rgba(245,158,11,.06)',border:'1px solid rgba(245,158,11,.25)',borderRadius:10,padding:'10px 14px',marginBottom:16,fontSize:12,color:'#92400E',display:'flex',gap:8,alignItems:'center'}}>
        <span style={{fontSize:15,flexShrink:0}}>🔒</span>
        <span>You have read/write access to organisation settings and user management only. Task content, evidence, checklists, leave, and reports are strictly private to each organisation.</span>
      </div>

      <div className="stat-grid" style={{marginBottom:20}}>
        <Stat label="Organisations" val={stats.orgs} sub="on platform" icon="🏢" color="#8B5CF6" bg="rgba(139,92,246,.1)"/>
        <Stat label="Total Users" val={stats.users} sub="across all orgs" icon="👥" color="#3B82F6" bg="rgba(59,130,246,.1)"/>
        <Stat label="Open Tickets" val={openTickets} sub={openTickets>0?'Need attention':'All clear'} icon="🎫" color={openTickets>0?'#EF4444':'#10B981'} bg={openTickets>0?'rgba(239,68,68,.1)':'rgba(16,185,129,.1)'}/>
        <Stat label="Audit Events" val={recentAudit.length>0?'Live':0} sub="activity tracked" icon="📋" color="#6B7280" bg="rgba(107,114,128,.1)"/>
      </div>

      <div className="section" style={{marginBottom:14}}>
        <div className="section-title">Quick Search</div>
        <div style={{display:'flex',gap:8}}>
          <input className="form-input" placeholder="Search organisation or user name…" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==='Enter'&&doSearch()} style={{flex:1,fontSize:13}}/>
          <button className="btn btn-primary" onClick={doSearch} disabled={searching}>{searching?'Searching…':'Search'}</button>
        </div>
        {searchResults&&(
          <div style={{marginTop:12}}>
            {searchResults.orgs.length>0&&(
              <div style={{marginBottom:10}}>
                <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:6}}>Organisations</div>
                {searchResults.orgs.map(o=>(
                  <div key={o.id} onClick={()=>setPage('orgs')} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',marginBottom:4,cursor:'pointer',background:'var(--s2)'}}>
                    <span style={{fontSize:14}}>🏢</span>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:600}}>{o.name}</div>
                      <div style={{fontSize:11,color:'var(--t2)'}}>{o.plan||'—'} plan · {o.status||'active'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {searchResults.users.length>0&&(
              <div>
                <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:6}}>Users</div>
                {searchResults.users.map(u=>(
                  <div key={u.id} onClick={()=>setPage('users')} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',marginBottom:4,cursor:'pointer',background:'var(--s2)'}}>
                    <span style={{fontSize:14}}>👤</span>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:600}}>{u.name}</div>
                      <div style={{fontSize:11,color:'var(--t2)'}}>{ROLE_LABELS[u.role]||u.role} · {u.org}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {searchResults.orgs.length===0&&searchResults.users.length===0&&(
              <div style={{fontSize:13,color:'var(--t2)',padding:'10px 0'}}>No results found for "{search}"</div>
            )}
          </div>
        )}
      </div>

      <div className="two-col">
        <div className="section">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
            <div className="section-title" style={{margin:0}}>🎫 Open Tickets</div>
            <button className="btn btn-secondary btn-sm" style={{fontSize:11}} onClick={()=>setPage('support')}>View All</button>
          </div>
          {openTickets===0
            ? <div style={{fontSize:13,color:'var(--t2)',padding:'8px 0'}}>No open tickets 🎉</div>
            : tickets.filter(t=>t.status==='open'||t.status==='in_progress').slice(0,4).map((t,i)=>(
              <div key={i} onClick={()=>setPage('support')} style={{padding:'8px 0',borderBottom:'1px solid var(--border)',cursor:'pointer'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
                  <div style={{fontSize:12,fontWeight:600,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.user_name} · {t.org}</div>
                  <span style={{fontSize:10,padding:'2px 7px',borderRadius:10,fontWeight:600,background:t.status==='open'?'rgba(245,158,11,.15)':'rgba(59,130,246,.15)',color:t.status==='open'?'#F59E0B':'#3B82F6',flexShrink:0}}>{t.status?.replace('_',' ').toUpperCase()}</span>
                </div>
                <div style={{fontSize:11,color:'var(--t2)'}}>{fmtTs(t.created_at)}</div>
              </div>
            ))}
        </div>
        <div className="section">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
            <div className="section-title" style={{margin:0}}>📋 Recent Activity</div>
            <button className="btn btn-secondary btn-sm" style={{fontSize:11}} onClick={()=>setPage('audit')}>View All</button>
          </div>
          {auditLoading
            ? <div style={{padding:'12px 0'}}><div className="spinner" style={{margin:'0 auto'}}/></div>
            : recentAudit.length===0
              ? <div style={{fontSize:13,color:'var(--t2)',padding:'8px 0'}}>No recent events</div>
              : recentAudit.map((e,i)=>(
                <div key={e.id||i} style={{padding:'7px 0',borderBottom:'1px solid var(--border)'}}>
                  <div style={{fontSize:12,fontWeight:600}}>{ACTION_LABEL[e.event_type]||e.event_type}</div>
                  <div style={{fontSize:11,color:'var(--t2)'}}>{e.by||'—'} · {e.org||'—'}</div>
                  <div style={{fontSize:10,color:'var(--t3)'}}>{fmtTs(e.at)}</div>
                </div>
              ))}
        </div>
      </div>

      <div className="section" style={{marginTop:14}}>
        <div className="section-title">Quick Navigation</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:8}}>
          {[['orgs','🏢','Organisations','View & manage orgs'],['users','👥','Users','Fix role & access issues'],['teams','👤','Teams','View team structure'],['audit','📋','Audit Log','Structural activity only'],['support','🎫','Support Tickets','Resolve user issues'],['notifications','📢','Announcements','Platform-wide messages'],['platform_industries','🏭','Platform Industries','Manage global industry list']].map(([pg,icon,label,sub])=>(
            <div key={pg} onClick={()=>setPage(pg)} style={{padding:'12px',borderRadius:10,border:'1px solid var(--border)',background:'var(--s2)',cursor:'pointer',textAlign:'center'}}>
              <div style={{fontSize:22,marginBottom:4}}>{icon}</div>
              <div style={{fontSize:12,fontWeight:700}}>{label}</div>
              <div style={{fontSize:10,color:'var(--t2)',marginTop:2}}>{sub}</div>
            </div>
          ))}
        </div>
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
  const [newTask, setNewTask] = useState({ title:'', category:'Hospitality', department:'', industry:'', priority:'medium', due_date:'', compliance:false, recurrence:'once', assigned_role:'worker', assigned_user_id:'', assigned_user_name:'', assigned_user_email:'', project:'', subtasks:[] })
  const [selectedTplId, setSelectedTplId] = useState('')
  const [taskGlobalIndustries, setTaskGlobalIndustries] = useState([])
  const [taskOrgIndustries, setTaskOrgIndustries] = useState([])
  const [orgProjects, setOrgProjects] = useState([])
  const [templates, setTemplates] = useState([])
  const [clNoteOpen, setClNoteOpen] = useState(null) // {taskId, idx}
  const [clNoteText, setClNoteText] = useState('')
  const [mandatoryWarn, setMandatoryWarn] = useState(null)
  const [photoWarn, setPhotoWarn] = useState(false)
  // Multi-completion checklist state
  const [clCompletions, setClCompletions] = useState({}) // {taskId: {itemId: [rows]}}
  const [clExpanded, setClExpanded] = useState(new Set()) // keys 'taskId::itemId'
  const [clMarkOpen, setClMarkOpen] = useState(null) // {taskId, idx, itemId, label}
  const [clMarkNote, setClMarkNote] = useState('')
  const [clFlash, setClFlash] = useState(null) // 'taskId::itemId' — brief ✓ flash

  useEffect(()=>{
    if(!isConfigured()||!user.org) return
    supabase.from('organisations').select('id').eq('name',user.org).maybeSingle()
      .then(({data:orgRow})=>{
        const orgId = orgRow?.id; if(!orgId) return
        supabase.from('checklist_templates').select('*').eq('organisation_id',orgId).order('name')
          .then(({data})=>{ if(data) setTemplates(data.map(t=>({...t,items:parseSafe(t.items)}))) })
          .catch(()=>{})
      }).catch(()=>{})
  },[user.org])

  useEffect(()=>{
    if(isConfigured()&&user.org) {
      supabase.from('projects').select('*').eq('org',user.org).eq('status','active').order('name')
        .then(({data})=>{ if(data) setOrgProjects(data) })
        .catch(()=>{}) // table may not exist yet
    }
  },[user.org])

  useEffect(()=>{
    if(!isConfigured()) return
    if(user.role==='super_admin') {
      supabase.from('profiles').select('*').then(({data})=>{ if(data) setTeamUsers(data) })
    } else if(user.org) {
      supabase.from('org_members').select('user_id,role').eq('org',user.org)
        .then(async({data:members})=>{
          if(!members?.length) return
          const ids = members.map(m=>m.user_id)
          const {data:profiles} = await supabase.from('profiles').select('*').in('id',ids)
          if(profiles) setTeamUsers(profiles.map(p=>({
            ...p,
            role:members.find(m=>m.user_id===p.id)?.role||p.role,
            positions:[]
          })))
        }).catch(()=>{})
    }
  },[user.org])
  useEffect(()=>{ if(isConfigured()&&user.role==='super_admin') supabase.from('organisations').select('name,status').eq('status','active').order('name').then(({data})=>{ if(data) setOrgsList(data.map(o=>o.name)) }) },[])
  useEffect(()=>{
    if(!isConfigured()) return
    supabase.from('global_industries').select('name').order('name')
      .then(({data})=>{ if(data?.length) setTaskGlobalIndustries(data.map(d=>d.name)) }).catch(()=>{})
    if(user.org) {
      supabase.from('organisations').select('id').eq('name',user.org).maybeSingle()
        .then(({data:orgRow})=>{
          if(!orgRow?.id) return
          supabase.from('org_industries').select('name').eq('organisation_id',orgRow.id)
            .then(({data})=>{ if(data?.length) setTaskOrgIndustries(data.map(d=>d.name)) }).catch(()=>{})
        }).catch(()=>{})
    }
  },[user.org])

  const taskAllIndustries = [...(taskGlobalIndustries.length?taskGlobalIndustries:PRESET_INDUSTRIES), ...taskOrgIndustries.filter(d=>!(taskGlobalIndustries.length?taskGlobalIndustries:PRESET_INDUSTRIES).includes(d))]

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
  const activeFiltered = searchFiltered.filter(t=>activeStatuses.includes(t.status) || isRecurring(t) || ['completed','approved'].includes(t.status)&&isRecurring(t)) 
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
      if (prev?.status !== changes.status) {
        const statusTypeMap = { approved:'task_approved', rejected:'task_rejected', completed:'task_completed', escalated:'task_escalated' }
        const evType = statusTypeMap[changes.status] || 'status_change'
        const entry = mkAuditEntry(evType, user, task?.org||user?.org,
          { interventionReason: _interventionReason||null },
          id, prev?.title||id, prev?.status||null, changes.status)
        setAuditLog(log=>[entry,...log])
        if (isConfigured()) {
          const {error} = await supabase.from('audit_log').insert(entry)
          if (error) console.warn('audit_log insert error:', error.message, entry)
        }
        const auditAction = changes.status==='approved'?'task.approved':changes.status==='rejected'?'task.rejected':changes.status==='escalated'?'task.escalated':'task.status_changed'
        logAuditEvent(user, auditAction, 'task', id, prev?.title||id, (prev?.status||'?')+' → '+changes.status)
      } else {
        const editableFields = ['title','priority','due_date','category','department','description']
        const changesMap = {}
        editableFields.filter(f=>f in changes && changes[f]!==prev?.[f]).forEach(f=>{changesMap[f]=changes[f]})
        if (Object.keys(changesMap).length>0) {
          const edEntry = mkAuditEntry('task_edited', user, task?.org||user?.org, { changes:changesMap }, id, prev?.title||id,
            Object.keys(changesMap).join(','), Object.values(changesMap).join(','))
          setAuditLog(log=>[edEntry,...log])
          if (isConfigured()) {
            const {error} = await supabase.from('audit_log').insert(edEntry)
            if (error) console.warn('audit_log insert error:', error.message, edEntry)
          }
        }
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
    if ('evidence' in changes) {
      const prev = tasks.find(t=>t.id===id)
      const oldLen = parseSafe(prev?.evidence)?.length||0
      const newLen = Array.isArray(changes.evidence)?changes.evidence.length:(parseSafe(changes.evidence)?.length||0)
      if (newLen!==oldLen) {
        const evEntry = mkAuditEntry(newLen>oldLen?'evidence_added':'evidence_removed', user, prev?.org||user?.org, {}, id, prev?.title||id, String(oldLen)+' photo'+(oldLen!==1?'s':''), String(newLen)+' photo'+(newLen!==1?'s':''))
        setAuditLog(log=>[evEntry,...log])
        if (isConfigured()) {
          const {error} = await supabase.from('audit_log').insert(evEntry)
          if (error) console.warn('audit_log insert error:', error.message)
        }
      }
    }
    if ('assigned_user_id' in changes) {
      const prev = tasks.find(t=>t.id===id)
      if (prev && String(changes.assigned_user_id||'')!==String(prev.assigned_user_id||'')) {
        const toName = changes.assigned_user_name||teamUsers.find(u=>u.id===changes.assigned_user_id)?.name||'—'
        const rEntry = mkAuditEntry('task_reassigned', user, prev?.org||user?.org, {}, id, prev?.title||id, prev.assigned_user_name||'Unassigned', toName)
        setAuditLog(log=>[rEntry,...log])
        if (isConfigured()) {
          const {error} = await supabase.from('audit_log').insert(rEntry)
          if (error) console.warn('audit_log insert error:', error.message)
        }
        logAuditEvent(user, 'task.assigned', 'task', id, prev?.title||id, (prev.assigned_user_name||'Unassigned')+' → '+toName)
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
    const s = subs[idx]; if(!s) return
    const newDone = !s.done
    const histEntry = { action:newDone?'checked':'unchecked', by:user.name, byId:user.id, at:new Date().toISOString() }
    const newSubs = subs.map((x,i)=>i===idx?{...x,done:newDone,history:[...(x.history||[]),histEntry]}:x)
    update(tid, { subtasks: newSubs })
    const auditEntry = mkAuditEntry('checklist_toggled', user, task.org||user.org, { action:newDone?'checked':'unchecked', item:s.text }, tid, task.title, newDone?'unchecked':'checked', newDone?'checked':'unchecked')
    setAuditLog(log=>[auditEntry,...log])
    if(isConfigured()) supabase.from('audit_log').insert(auditEntry).then(({error})=>{ if(error) console.warn('audit_log insert error:', error.message) })
    logAuditEvent(user, 'task.checklist_toggled', 'task', tid, task.title, (newDone?'Checked':'Unchecked')+': '+s.text)
  }

  const addSubNote = (tid, idx, note) => {
    const task = tasks.find(t=>t.id===tid)
    const subs = parseSafe(task.subtasks)
    const histEntry = { action:'noted', by:user.name, byId:user.id, at:new Date().toISOString(), note }
    update(tid, { subtasks: subs.map((x,i)=>i===idx?{...x,note,history:[...(x.history||[]),histEntry]}:x) })
  }

  const addSubPhoto = (tid, idx, photoUrl) => {
    const task = tasks.find(t=>t.id===tid)
    const subs = parseSafe(task.subtasks)
    const histEntry = { action:'photo_added', by:user.name, byId:user.id, at:new Date().toISOString() }
    update(tid, { subtasks: subs.map((x,i)=>i===idx?{...x,photo:photoUrl,history:[...(x.history||[]),histEntry]}:x) })
  }

  const checkMandatory = (tid) => {
    const task = tasks.find(t=>t.id===tid)
    const todayStr = new Date().toISOString().slice(0,10)
    const taskCompletions = clCompletions[tid] || {}
    return parseSafe(task.subtasks).filter((s,idx)=>{
      if (!s.mandatory) return false
      const itemId = s.id || String(idx)
      const rows = taskCompletions[itemId] || []
      const doneToday = rows.some(r=>r.completed_at&&r.completed_at.slice(0,10)===todayStr)
      return !doneToday && !s.done
    }).map(s=>s.text)
  }

  const markChecklistItem = async (tid, idx, note) => {
    const task = tasks.find(t=>t.id===tid)
    if (!task) return
    const subs = parseSafe(task.subtasks)
    const s = subs[idx]; if (!s) return
    const itemId = s.id || String(idx)
    const now = new Date().toISOString()
    const orgId = task.org || user.org

    const row = {
      task_id: tid, checklist_item_id: itemId, checklist_item_label: s.text||'',
      completed_by: user.id, completed_by_name: user.name,
      completed_at: now, note: note||null, organisation_id: orgId
    }

    if (isConfigured()) {
      const { data, error } = await supabase.from('checklist_completions').insert(row).select().single()
      if (!error && data) {
        setClCompletions(prev => {
          const taskMap = { ...(prev[tid]||{}) }
          taskMap[itemId] = [...(taskMap[itemId]||[]), data]
          return { ...prev, [tid]: taskMap }
        })
      }
    } else {
      setClCompletions(prev => {
        const taskMap = { ...(prev[tid]||{}) }
        taskMap[itemId] = [...(taskMap[itemId]||[]), {...row, id: 'local-'+Date.now()}]
        return { ...prev, [tid]: taskMap }
      })
    }

    const flashKey = tid+'::'+itemId
    setClFlash(flashKey)
    setTimeout(()=>setClFlash(f=>f===flashKey?null:f), 1500)

    logAuditEvent(user, 'checklist_item_completed', 'task', tid, task.title,
      'Completed: '+s.text+(note?' — '+note:''))
  }

  // Load completions for currently selected task
  useEffect(()=>{
    const selId = selected
    if (!selId || !isConfigured()) return
    supabase.from('checklist_completions').select('*').eq('task_id', selId).order('completed_at',{ascending:true})
      .then(({data})=>{
        if (!data) return
        const map = {}
        data.forEach(row=>{
          if (!map[row.checklist_item_id]) map[row.checklist_item_id] = []
          map[row.checklist_item_id].push(row)
        })
        setClCompletions(prev=>({ ...prev, [selId]: map }))
      }).catch(()=>{})
  },[selected])

  const startTask = (tid) => {
    const doStart = (extra={}) => update(tid, { status:"in_progress", started_at:new Date().toISOString(), ...extra })
    if (gpsEnabled === false || !navigator.geolocation) { doStart(); return }
    navigator.geolocation.getCurrentPosition(
      pos => {
        if (gpsEnabled === null) { localStorage.setItem('taksyn_gps_enabled','true'); setGpsEnabled(true) }
        doStart({ gps_start: pos.coords.latitude.toFixed(4)+","+pos.coords.longitude.toFixed(4) })
      },
      () => {
        if (gpsEnabled === null) { localStorage.setItem('taksyn_gps_enabled','false'); setGpsEnabled(false) }
        doStart()
      }
    )
  }

  const submitTask = (tid) => {
    const missing = checkMandatory(tid)
    if (missing.length > 0) { setMandatoryWarn(missing); return }
    const task = tasks.find(t=>t.id===tid)
    if (task.compliance && parseSafe(task.evidence).length === 0) { setPhotoWarn(true); return }
    const updatedComments = comment.trim() ? [...(task.comments||[]), user.name+': '+comment.trim()] : task.comments||[]
    const doSubmit = (extra={}) => {
      update(tid, { status:'awaiting_review', completed_by:user.name, submitted_at:new Date().toISOString(), comments:updatedComments, ...extra })
      setCelebration(true); setComment(''); setSelected(null)
    }
    if (gpsEnabled === false || !navigator.geolocation) { doSubmit(); return }
    navigator.geolocation.getCurrentPosition(
      pos => {
        if (gpsEnabled === null) { localStorage.setItem('taksyn_gps_enabled','true'); setGpsEnabled(true) }
        doSubmit({ gps_end: pos.coords.latitude.toFixed(4)+","+pos.coords.longitude.toFixed(4) })
      },
      () => {
        if (gpsEnabled === null) { localStorage.setItem('taksyn_gps_enabled','false'); setGpsEnabled(false) }
        doSubmit()
      }
    )
  }

  const addComment = (tid) => {
    if (!comment.trim()) return
    const task = tasks.find(t=>t.id===tid)
    const entry = { id: Date.now()+'', author: user.name, authorId: user.id, text: comment.trim(), timestamp: new Date().toISOString(), edits: [] }
    update(tid, { comments:[...(parseSafe(task.comments)||[]), entry] })
    const cmEntry = mkAuditEntry('comment_added', user, task?.org||user.org, {}, tid, task?.title, null, comment.trim().slice(0,200))
    setAuditLog(prev=>[cmEntry,...prev])
    if (isConfigured()) supabase.from('audit_log').insert(cmEntry).then(({error})=>{ if(error) console.warn('audit_log insert error:', error.message) })
    logAuditEvent(user, 'task.comment_added', 'task', tid, task?.title, '"'+comment.trim().slice(0,200)+'"')
    setComment('')
  }

  const createTask = () => {
    if (!newTask.title.trim() || creating) return
    setCreating(true)
    const taskData = {...newTask}
    // Close and reset immediately — no await before this
    setShowCreate(false)
    setUserSearch('')
    setSelectedTplId('')
    setNewTask({title:'',category:'Hospitality',department:'',industry:'',priority:'medium',due_date:'',compliance:false,recurrence:'once',assigned_role:'worker',assigned_user_id:'',assigned_user_name:'',assigned_user_email:'',project:'',subtasks:[]})
    // Do the async work in background
    const t = { id:'T'+Date.now(), ...taskData, status:'pending', subtasks:taskData.subtasks||[], evidence:[], comments:[], escalation:false, created_by:user.name, org:user.org, created_at:new Date().toISOString() }
    setTasks(prev=>[...prev,t])
    const cEntry = mkAuditEntry('task_created', user, user.org, { priority:t.priority, category:t.category, assignedTo:t.assigned_user_name||t.assigned_role }, t.id, t.title, null, t.title)
    setAuditLog(prev=>[cEntry,...prev])
    if (isConfigured()) supabase.from('audit_log').insert(cEntry).then(({error})=>{ if(error) console.warn('audit_log insert error:', error.message) })
    logAuditEvent(user, 'task.created', 'task', t.id, t.title, t.priority+' priority'+(t.assigned_user_name?' · '+t.assigned_user_name:''))
    if (isConfigured()) {
      supabase.from('tasks').insert({ ...t, subtasks:JSON.stringify(t.subtasks), evidence:'[]', comments:'[]' })
        .then(({error})=>{ if(error) console.error('Task save error:', error) })
        .finally(()=>setCreating(false))
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
              <div className="form-field">
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                  <label className="form-label" style={{margin:0}}>Checklist</label>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setEditTask({...editTask,subtasks:[...(editTask.subtasks||[]),{id:Date.now()+'',text:'',done:false,mandatory:false,requirePhoto:false,note:'',photo:null,history:[]}]})}>+ Add Item</button>
                </div>
                {(editTask.subtasks||[]).map((s,i)=>(
                  <div key={s.id||i} className="cl-build-item">
                    <input className="form-input" style={{flex:1,fontSize:12}} placeholder={"Item "+(i+1)} value={s.text} onChange={e=>setEditTask({...editTask,subtasks:(editTask.subtasks||[]).map((x,j)=>j===i?{...x,text:e.target.value}:x)})}/>
                    <button type="button" className="cl-flag-btn" title="Mandatory" style={{border:'1px solid '+(s.mandatory?'var(--red)':'var(--border)'),background:s.mandatory?'rgba(239,68,68,.08)':'none',color:s.mandatory?'var(--red)':'var(--t2)'}} onClick={()=>setEditTask({...editTask,subtasks:(editTask.subtasks||[]).map((x,j)=>j===i?{...x,mandatory:!x.mandatory}:x)})}><strong>*</strong></button>
                    <button type="button" className="cl-flag-btn" title="Require photo" style={{border:'1px solid '+(s.requirePhoto?'#3B82F6':'var(--border)'),background:s.requirePhoto?'rgba(59,130,246,.08)':'none',color:s.requirePhoto?'#3B82F6':'var(--t2)'}} onClick={()=>setEditTask({...editTask,subtasks:(editTask.subtasks||[]).map((x,j)=>j===i?{...x,requirePhoto:!x.requirePhoto}:x)})}>📷</button>
                    <button type="button" className="cl-flag-btn" style={{border:'1px solid rgba(239,68,68,.2)',background:'rgba(239,68,68,.04)',color:'var(--red)'}} onClick={()=>setEditTask({...editTask,subtasks:(editTask.subtasks||[]).filter((_,j)=>j!==i)})}>×</button>
                  </div>
                ))}
                {!(editTask.subtasks||[]).length&&<div style={{fontSize:11,color:'var(--t3)',marginTop:4}}>No checklist items</div>}
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
              <div className="form-field"><label className="form-label">Instructions for Staff Member</label><textarea className="comment-box" style={{minHeight:80}} placeholder="e.g. Please re-clean the bathroom…" value={rejectNote} onChange={e=>setRejectNote(e.target.value)}/></div>
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
        <div className="modal-overlay" onClick={()=>{ setShowCreate(false); setSelectedTplId('') }}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr"><div className="modal-title">Create New Task</div><button className="modal-close" onClick={()=>{ setShowCreate(false); setSelectedTplId('') }}>×</button></div>
            <div className="modal-body">
              <div className="form-field"><label className="form-label">Task Title</label><input className="form-input" value={newTask.title} onChange={e=>setNewTask({...newTask,title:e.target.value})} placeholder="e.g. Daily Safety Inspection"/></div>
              <div className="two-col">
                <div className="form-field"><label className="form-label">Category</label><select className="form-select" value={newTask.category} onChange={e=>setNewTask({...newTask,category:e.target.value,department:''})}>{Object.keys(CAT_ICONS).map(c=><option key={c}>{c}</option>)}</select></div>
                <div className="form-field"><label className="form-label">Department</label><select className="form-select" value={newTask.department||''} onChange={e=>setNewTask({...newTask,department:e.target.value})}><option value="">— Select —</option>{(DEPARTMENTS[newTask.category]||DEPARTMENTS.General).map(d=><option key={d} value={d}>{d}</option>)}</select></div>
                <div className="form-field"><label className="form-label">Industry <span style={{fontSize:10,color:'var(--t2)',fontWeight:400,textTransform:'none'}}>— optional</span></label><select className="form-select" value={newTask.industry||''} onChange={e=>setNewTask({...newTask,industry:e.target.value})}><option value="">— Select —</option>{taskAllIndustries.map(k=><option key={k} value={k}>{k}</option>)}</select></div>
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
                      {teamUsers.filter(u=>(assignableRoles.includes(u.role))&&(!userSearch||u.name?.toLowerCase().includes(userSearch.toLowerCase()))).map(u=><option key={u.id} value={u.id}>{u.name} — {getUserDeptRole(u, newTask.department||newTask.category)}</option>)}
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
              <div className="form-field">
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
                  <label className="form-label" style={{margin:0}}>Checklist Template <span style={{fontSize:10,color:'var(--t2)',fontWeight:400}}>— optional</span></label>
                  {selectedTplId&&<span style={{fontSize:11,color:'var(--brand)',cursor:'pointer',fontWeight:500}} onClick={()=>{ setSelectedTplId(''); setNewTask({...newTask,subtasks:[]}) }}>✕ Clear</span>}
                </div>
                <select className="form-select" value={selectedTplId} onChange={e=>{
                  const tmpl=templates.find(t=>t.id===e.target.value)
                  if(tmpl){
                    setSelectedTplId(e.target.value)
                    setNewTask({...newTask, priority:tmpl.priority||newTask.priority, subtasks:(tmpl.items||[]).map(it=>({id:Date.now()+Math.random()+'',text:it.label||it.text||'',done:false,mandatory:!!(it.required||it.mandatory),requirePhoto:!!it.requirePhoto,note:'',photo:null,history:[]}))})
                  } else { setSelectedTplId('') }
                }}>
                  <option value="">— None (build from scratch) —</option>
                  {templates.map(t=><option key={t.id} value={t.id}>{t.name} · {PRIORITY_CFG[t.priority]?.label||'Medium'} · {t.items?.length||0} items</option>)}
                </select>
                {selectedTplId&&templates.find(t=>t.id===selectedTplId)?.description&&(
                  <div style={{fontSize:11,color:'var(--t2)',marginTop:4}}>{templates.find(t=>t.id===selectedTplId).description}</div>
                )}
              </div>
              <div className="form-field">
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                  <label className="form-label" style={{margin:0}}>Checklist Items</label>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setNewTask({...newTask,subtasks:[...(newTask.subtasks||[]),{id:Date.now()+'',text:'',done:false,mandatory:false,requirePhoto:false,note:'',photo:null,history:[]}]})}>+ Add Item</button>
                </div>
                {(newTask.subtasks||[]).map((s,i)=>(
                  <div key={s.id||i} className="cl-build-item">
                    <input className="form-input" style={{flex:1,fontSize:12}} placeholder={"Item "+(i+1)} value={s.text} onChange={e=>setNewTask({...newTask,subtasks:(newTask.subtasks||[]).map((x,j)=>j===i?{...x,text:e.target.value}:x)})}/>
                    <button type="button" className="cl-flag-btn" title="Mandatory — blocks submit" style={{border:'1px solid '+(s.mandatory?'var(--red)':'var(--border)'),background:s.mandatory?'rgba(239,68,68,.08)':'none',color:s.mandatory?'var(--red)':'var(--t2)'}} onClick={()=>setNewTask({...newTask,subtasks:(newTask.subtasks||[]).map((x,j)=>j===i?{...x,mandatory:!x.mandatory}:x)})}><strong>*</strong></button>
                    <button type="button" className="cl-flag-btn" title="Require photo evidence" style={{border:'1px solid '+(s.requirePhoto?'#3B82F6':'var(--border)'),background:s.requirePhoto?'rgba(59,130,246,.08)':'none',color:s.requirePhoto?'#3B82F6':'var(--t2)'}} onClick={()=>setNewTask({...newTask,subtasks:(newTask.subtasks||[]).map((x,j)=>j===i?{...x,requirePhoto:!x.requirePhoto}:x)})}>📷</button>
                    <button type="button" className="cl-flag-btn" style={{border:'1px solid rgba(239,68,68,.2)',background:'rgba(239,68,68,.04)',color:'var(--red)'}} onClick={()=>setNewTask({...newTask,subtasks:(newTask.subtasks||[]).filter((_,j)=>j!==i)})}>×</button>
                  </div>
                ))}
                {!(newTask.subtasks||[]).length&&<div style={{fontSize:11,color:'var(--t3)',marginTop:4}}>No checklist items — optional</div>}
              </div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className="btn btn-secondary" onClick={()=>{ setShowCreate(false); setSelectedTplId('') }}>Cancel</button>
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
          {(()=>{
            const subs = parseSafe(sel.subtasks)
            if(!subs.length) return null
            const doneCount = subs.filter(s=>s.done).length
            const pctVal = Math.round(doneCount/subs.length*100)
            const pctColor = pctVal===100?'var(--green)':pctVal>=50?'var(--amber)':'var(--brand)'
            const isWorker = user.role==='worker'
            return (
              <div className="section">
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                  <div className="section-title" style={{marginBottom:0}}>Checklist</div>
                  <div style={{fontSize:12,fontWeight:700,color:pctColor}}>{doneCount}/{subs.length} · {pctVal}%</div>
                </div>
                <div className="cl-prog">
                  <div className="cl-prog-bar"><div className="cl-prog-fill" style={{width:pctVal+'%',background:pctColor}}/></div>
                </div>
                {mandatoryWarn&&<div className="cl-warn">⚠️ <strong>Cannot submit — complete mandatory items first:</strong><ul style={{margin:'6px 0 0 16px',padding:0}}>{mandatoryWarn.map((m,i)=><li key={i}>{m}</li>)}</ul><button className="cl-action-btn" style={{marginTop:8}} onClick={()=>setMandatoryWarn(null)}>Dismiss</button></div>}
                {subs.map((s,idx)=>{
                  const itemId = s.id || String(idx)
                  const flashKey = sel.id+'::'+itemId
                  const isFlashing = clFlash===flashKey
                  const taskCompletions = clCompletions[sel.id] || {}
                  const itemRows = taskCompletions[itemId] || []
                  const todayStr = new Date().toISOString().slice(0,10)
                  const todayRows = itemRows.filter(r=>r.completed_at&&r.completed_at.slice(0,10)===todayStr)
                  const todayCount = todayRows.length
                  const isExpandedKey = sel.id+'::'+itemId
                  const isHistExpanded = clExpanded.has(isExpandedKey)
                  const isMarkOpen = clMarkOpen&&clMarkOpen.taskId===sel.id&&clMarkOpen.idx===idx
                  const canAct = isWorker || ['supervisor','manager','client_admin'].includes(user.role)
                  const isNoteOpen = clNoteOpen&&clNoteOpen.taskId===sel.id&&clNoteOpen.idx===idx
                  return (
                    <div key={s.id||idx} className="cl-item">
                      <div className={'checkbox'+(isFlashing?' checked':(todayCount>0?' checked':''))} style={{cursor: canAct?'pointer':'default',marginTop:1,transition:'background 0.3s'}} onClick={()=>{ if(!canAct) return; if(isMarkOpen){ setClMarkOpen(null); setClMarkNote('') } else { setClMarkOpen({taskId:sel.id,idx,itemId,label:s.text}); setClMarkNote('') } }}>
                        {(isFlashing||todayCount>0)&&<svg width="10" height="8" viewBox="0 0 10 8"><path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                      <div className="cl-body">
                        <div style={{display:'flex',alignItems:'center',gap:4,flexWrap:'wrap'}}>
                          <span className="cl-text">{s.text||'(untitled)'}</span>
                          {s.mandatory&&<span className="cl-mandatory" title="Mandatory">*</span>}
                          {s.requirePhoto&&<span style={{fontSize:10,color:'#3B82F6',fontWeight:600}} title="Photo required">📷</span>}
                          {todayCount>0&&(
                            <span style={{fontSize:10,fontWeight:700,color:'#10B981',background:'rgba(16,185,129,.12)',border:'1px solid rgba(16,185,129,.25)',borderRadius:10,padding:'1px 7px',cursor:'pointer'}} onClick={()=>setClExpanded(prev=>{ const n=new Set(prev); n.has(isExpandedKey)?n.delete(isExpandedKey):n.add(isExpandedKey); return n })}>
                              {todayCount}× today {isHistExpanded?'▲':'▼'}
                            </span>
                          )}
                        </div>
                        {isHistExpanded&&(
                          <div style={{marginTop:4,borderLeft:'2px solid rgba(16,185,129,.3)',paddingLeft:8}}>
                            {todayRows.map((r,ri)=>(
                              <div key={r.id||ri} style={{fontSize:11,color:'var(--t2)',marginBottom:2}}>
                                <span style={{color:'var(--t3)'}}>{new Date(r.completed_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
                                {' '}<span style={{fontWeight:600}}>{r.completed_by_name}</span>
                                {r.note&&<span style={{color:'var(--t2)'}}> — {r.note}</span>}
                              </div>
                            ))}
                            {itemRows.length>todayRows.length&&(
                              <div style={{fontSize:10,color:'var(--t3)',marginTop:2}}>{itemRows.length-todayRows.length} more from previous days</div>
                            )}
                          </div>
                        )}
                        {s.note&&<div className="cl-note">💬 {s.note}</div>}
                        {s.photo&&<img src={s.photo} alt="evidence" className="cl-photo-thumb" style={{marginTop:4}} onClick={()=>window.open(s.photo,'_blank')}/>}
                        {isMarkOpen&&canAct?(
                          <div style={{marginTop:6}}>
                            <textarea style={{width:'100%',padding:'6px 8px',borderRadius:6,border:'1px solid var(--border)',background:'var(--s2)',fontSize:12,resize:'none',fontFamily:'inherit',boxSizing:'border-box',minHeight:52}} placeholder="Optional note for this completion…" value={clMarkNote} onChange={e=>setClMarkNote(e.target.value)}/>
                            <div style={{display:'flex',gap:6,marginTop:4}}>
                              <button className="btn btn-primary btn-sm" onClick={async ()=>{ await markChecklistItem(sel.id,idx,clMarkNote||null); setClMarkOpen(null); setClMarkNote('') }}>✓ Mark Done</button>
                              <button className="btn btn-secondary btn-sm" onClick={()=>{setClMarkOpen(null);setClMarkNote('')}}>Cancel</button>
                            </div>
                          </div>
                        ):(
                          <div className="cl-actions">
                            {canAct&&<button className="cl-action-btn" style={{color:'#10B981',borderColor:'rgba(16,185,129,.3)',fontWeight:600}} onClick={()=>{ setClMarkOpen({taskId:sel.id,idx,itemId,label:s.text}); setClMarkNote('') }}>✓ Mark done</button>}
                            <button className="cl-action-btn" onClick={()=>{setClNoteOpen({taskId:sel.id,idx});setClNoteText(s.note||'')}}>{s.note?'✏️ Edit Note':'+ Note'}</button>
                            {s.requirePhoto&&!s.photo&&(
                              <>
                                <button className="cl-action-btn" style={{color:'#3B82F6',borderColor:'rgba(59,130,246,.3)'}} onClick={()=>document.getElementById('cl-cam-'+sel.id+'-'+idx).click()}>📷 Add Photo</button>
                                <input id={'cl-cam-'+sel.id+'-'+idx} type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={async e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=ev=>addSubPhoto(sel.id,idx,ev.target.result); r.readAsDataURL(f); e.target.value='' }}/>
                              </>
                            )}
                          </div>
                        )}
                        {isNoteOpen&&(
                          <div style={{marginTop:6}}>
                            <textarea style={{width:'100%',padding:'6px 8px',borderRadius:6,border:'1px solid var(--border)',background:'var(--s2)',fontSize:12,resize:'none',fontFamily:'inherit',boxSizing:'border-box',minHeight:52}} placeholder="Add a note for this item…" value={clNoteText} onChange={e=>setClNoteText(e.target.value)}/>
                            <div style={{display:'flex',gap:6,marginTop:4}}>
                              <button className="btn btn-primary btn-sm" onClick={()=>{ addSubNote(sel.id,idx,clNoteText); setClNoteOpen(null); setClNoteText('') }}>Save Note</button>
                              <button className="btn btn-secondary btn-sm" onClick={()=>{setClNoteOpen(null);setClNoteText('')}}>Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}
          <div className="section">
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8,gap:8,flexWrap:'wrap'}}>
              <div className="section-title" style={{marginBottom:0}}>
                Evidence {parseSafe(sel.evidence).length>0?'('+parseSafe(sel.evidence).length+'/5)':''}
              </div>
              {sel.compliance
                ? <span style={{fontSize:11,fontWeight:700,color:'#8B5CF6',background:'rgba(139,92,246,.1)',border:'1px solid rgba(139,92,246,.25)',borderRadius:4,padding:'2px 8px'}}>🔒 Required for compliance</span>
                : <span style={{fontSize:11,color:'var(--t2)'}}>Optional</span>
              }
            </div>
            {sel.compliance&&parseSafe(sel.evidence).length===0&&user.role==='worker'&&(
              <div style={{background:'rgba(139,92,246,.06)',border:'1px solid rgba(139,92,246,.2)',borderRadius:8,padding:'10px 12px',marginBottom:10,fontSize:12,color:'#7C3AED'}}>
                📷 This is a compliance task — at least 1 photo is required before you can submit for review.
              </div>
            )}
            {photoWarn&&parseSafe(sel.evidence).length===0&&(
              <div className="cl-warn" style={{marginBottom:10}}>
                ⚠️ <strong>Cannot submit — photo evidence is required for compliance tasks.</strong> Add at least one photo below.
                <button className="cl-action-btn" style={{marginLeft:8}} onClick={()=>setPhotoWarn(false)}>Dismiss</button>
              </div>
            )}
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
                <input id="cam-inp" type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={async e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=async ev=>{ await update(sel.id,{evidence:[...parseSafe(sel.evidence),{url:ev.target.result,ts:new Date().toISOString(),by:user.name}]}); setPhotoWarn(false) }; r.readAsDataURL(f); e.target.value='' }}/>
                <input id="gal-inp" type="file" accept="image/*" style={{display:'none'}} onChange={async e=>{ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=async ev=>{ await update(sel.id,{evidence:[...parseSafe(sel.evidence),{url:ev.target.result,ts:new Date().toISOString(),by:user.name}]}); setPhotoWarn(false) }; r.readAsDataURL(f); e.target.value='' }}/>
                {parseSafe(sel.evidence).length===0&&(
                  <div className="evidence-zone" onClick={()=>document.getElementById('cam-inp').click()}>
                    <div style={{fontSize:24,marginBottom:5}}>📷</div>
                    <div style={{fontSize:13,color:'var(--t2)'}}>{sel.compliance?'Tap to add required photo evidence':'Tap to add photo (optional)'}</div>
                  </div>
                )}
              </div>
            )}
            {user.role!=='worker'&&!parseSafe(sel.evidence).length&&(
              sel.compliance
                ? <div style={{background:'rgba(239,68,68,.06)',border:'1px solid rgba(239,68,68,.2)',borderRadius:8,padding:'10px 12px',fontSize:12,color:'var(--red)'}}>⚠️ No photos attached — this is a compliance task and evidence should be required.</div>
                : <div style={{fontSize:13,color:'var(--t2)'}}>No evidence uploaded yet</div>
            )}
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
              {(()=>{
                const isOrphaned = !!sel.assigned_user_id && !teamUsers.find(u=>u.id===sel.assigned_user_id)
                return (
                  <div style={{fontSize:13,gridColumn:isOrphaned?'1 / -1':'auto'}}>
                    <span style={{color:'var(--t2)'}}>Assigned:</span>{' '}
                    <span style={isOrphaned?{color:'var(--t2)',textDecoration:'line-through'}:{}}>{sel.assigned_user_name||ROLE_LABELS[sel.assigned_role]}</span>
                    {isOrphaned&&<div style={{marginTop:4,display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                      <span style={{fontSize:11,color:'var(--red)',fontWeight:600}}>⚠️ Assigned user no longer in organisation</span>
                      {canApprove&&<button className="btn btn-secondary btn-sm" style={{fontSize:11,padding:'3px 8px'}} onClick={()=>{setEditTask({...sel,subtasks:parseSafe(sel.subtasks)});setShowEdit(true)}}>Reassign</button>}
                    </div>}
                  </div>
                )
              })()}
              <div style={{fontSize:13}}><span style={{color:'var(--t2)'}}>Schedule:</span> {RECURRENCE_LABELS[sel.recurrence||'once']}</div>
              {sel.project&&<div style={{fontSize:13}}><span style={{color:'var(--t2)'}}>Project:</span> <span style={{color:'#3B82F6',fontWeight:600}}>📁 {sel.project}</span></div>}
            </div>
          </div>
          {user.role==='worker'&&(
            <div style={{background:'var(--s3)',border:'1px solid var(--border)',borderRadius:10,padding:14,marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:10}}>Task Timer</div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:10}}>
                {!sel.started_at?<button className="btn btn-green" style={{flex:1}} onClick={()=>startTask(sel.id)}>▶ Time In</button>:<div style={{flex:1,background:'rgba(16,185,129,.1)',border:'1px solid rgba(16,185,129,.25)',borderRadius:6,padding:'8px 12px',fontSize:12,color:'var(--green)',fontWeight:600,textAlign:'center'}}>✓ In: {fmtTime(sel.started_at)}</div>}
                {sel.started_at&&!sel.completed_at?<button className="btn btn-amber" style={{flex:1}} onClick={()=>{ if(gpsEnabled===false||!navigator.geolocation){update(sel.id,{completed_at:new Date().toISOString()});return} navigator.geolocation.getCurrentPosition(pos=>update(sel.id,{completed_at:new Date().toISOString(),gps_end:pos.coords.latitude.toFixed(4)+','+pos.coords.longitude.toFixed(4)}),()=>update(sel.id,{completed_at:new Date().toISOString()})) }}>⏹ Time Out</button>:sel.completed_at?<div style={{flex:1,background:'rgba(245,158,11,.1)',border:'1px solid rgba(245,158,11,.25)',borderRadius:6,padding:'8px 12px',fontSize:12,color:'var(--amber)',fontWeight:600,textAlign:'center'}}>✓ Out: {fmtTime(sel.completed_at)}</div>:null}
              </div>
              {sel.started_at&&sel.completed_at&&<div style={{fontSize:12,color:'var(--t2)',marginBottom:10,textAlign:'center'}}>⏱ Duration: <strong>{fmtDuration(sel.started_at,sel.completed_at)}</strong></div>}
              {sel.started_at&&sel.completed_at&&!['awaiting_review','approved'].includes(sel.status)&&(
                <button
                  className="btn btn-primary"
                  style={{width:'100%',opacity:(sel.compliance&&parseSafe(sel.evidence).length===0)?0.55:1}}
                  onClick={()=>submitTask(sel.id)}
                >
                  {sel.compliance&&parseSafe(sel.evidence).length===0?'📷 Add Photo to Submit':'✅ Submit for Review'}
                </button>
              )}
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
                        const dEntry = mkAuditEntry('task_deleted', user, sel.org||user.org, { deleteScope }, sel.id, sel.title, sel.status, null)
                        setAuditLog(prev=>[dEntry,...prev])
                        if(isConfigured()) supabase.from('audit_log').insert(dEntry).then(({error})=>{ if(error) console.warn('audit_log insert error:', error.message) })
                        logAuditEvent(user, 'task.deleted', 'task', sel.id, sel.title, 'Deleted (scope: '+deleteScope+')')
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
                        <option value="">All Staff</option>
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
                              {assignedToWkr.length>0&&<div><div style={{fontSize:10,color:'var(--t2)',fontWeight:600,marginBottom:6,display:'flex',alignItems:'center',gap:6}}><span style={{width:8,height:8,borderRadius:'50%',background:'#6B7280',display:'inline-block'}}/> To Staff ({assignedToWkr.length})</div>{assignedToWkr.map(t=><TaskCard key={t.id} task={t} onClick={()=>setSelected(t.id)}/>)}</div>}
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


function EscalationsView({ tasks, setTasks, user, setAuditLog }) {
  const esc = tasks.filter(t=>t.escalation||t.status==='overdue'||t.status==='escalated')
  const resolve = async (id) => {
    const t = tasks.find(t=>t.id===id)
    setTasks(prev=>prev.map(t=>t.id===id?{...t,escalation:false,status:'in_progress'}:t))
    if(isConfigured()) await supabase.from('tasks').update({escalation:false,status:'in_progress'}).eq('id',id)
    const rEntry = mkAuditEntry('status_change', user, t?.org||user.org, {}, id, t?.title||id, t?.status||'escalated', 'in_progress')
    if(setAuditLog) setAuditLog(prev=>[rEntry,...prev])
    if(isConfigured()) supabase.from('audit_log').insert(rEntry).then(({error})=>{ if(error) console.warn('audit_log insert error:', error.message) })
    logAuditEvent(user, 'task.status_changed', 'task', id, t?.title||id, (t?.status||'escalated')+' → in_progress (acknowledged)')
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

function EvidenceView({ tasks, setTasks, user, setAuditLog }) {
  const relevant = tasks.filter(t=>t.evidence?.length>0||t.status==='awaiting_review')
  const approve = async (id) => {
    const t = tasks.find(t=>t.id===id)
    setTasks(prev=>prev.map(t=>t.id===id?{...t,status:'approved',reviewed_at:new Date().toISOString()}:t))
    if(isConfigured()) await supabase.from('tasks').update({status:'approved',reviewed_at:new Date().toISOString()}).eq('id',id)
    const aEntry = mkAuditEntry('task_approved', user, t?.org||user.org, {}, id, t?.title||id, 'awaiting_review', 'approved')
    if(setAuditLog) setAuditLog(prev=>[aEntry,...prev])
    if(isConfigured()) supabase.from('audit_log').insert(aEntry).then(({error})=>{ if(error) console.warn('audit_log insert error:', error.message) })
    logAuditEvent(user, 'task.approved', 'task', id, t?.title||id, 'awaiting_review → approved')
  }
  const reject = async (id) => {
    const t = tasks.find(t=>t.id===id)
    setTasks(prev=>prev.map(t=>t.id===id?{...t,status:'rejected',reviewed_at:new Date().toISOString()}:t))
    if(isConfigured()) await supabase.from('tasks').update({status:'rejected',reviewed_at:new Date().toISOString()}).eq('id',id)
    const rEntry = mkAuditEntry('task_rejected', user, t?.org||user.org, {}, id, t?.title||id, 'awaiting_review', 'rejected')
    if(setAuditLog) setAuditLog(prev=>[rEntry,...prev])
    if(isConfigured()) supabase.from('audit_log').insert(rEntry).then(({error})=>{ if(error) console.warn('audit_log insert error:', error.message) })
    logAuditEvent(user, 'task.rejected', 'task', id, t?.title||id, 'awaiting_review → rejected')
  }
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


function ReportsView({ tasks, user, setAuditLog }) {
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
  const [showFilters, setShowFilters] = useState(false)
  const [filterTitle, setFilterTitle] = useState('')
  const [filterWorker, setFilterWorker] = useState('')
  const [filterDept, setFilterDept] = useState('')
  const [filterIndustry, setFilterIndustry] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterStatuses, setFilterStatuses] = useState([])
  const [filterPriorities, setFilterPriorities] = useState([])
  const [filterCompliance, setFilterCompliance] = useState(false)
  const [filterProject, setFilterProject] = useState('')

  const isClientAdmin = ['client_admin','super_admin'].includes(user.role)
  const isSupervisorUp = ['supervisor','manager','client_admin','super_admin'].includes(user.role)

  const reportOptions = [
    ...(isSupervisorUp ? [{ value:'compliance', label:'📋 Compliance Report' }] : []),
    ...(isClientAdmin ? [
      { value:'worker', label:'👷 Staff Performance Report' },
      { value:'org', label:'🏢 Organisation Overview Report' },
    ] : []),
  ]

  useEffect(()=>{
    setOrgLogo(null) // reset on org change
    if(isConfigured() && user.org && user.role!=='super_admin') {
      supabase.from('organisations').select('logo').eq('name', user.org).maybeSingle()
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

  // --- Filter helpers & filtered dataset ---
  const workerOptions = [...new Set(pt.map(t=>t.assigned_user_name).filter(Boolean))].sort()
  const deptOptions = [...new Set(pt.map(t=>t.department).filter(Boolean))].sort()
  const industryOptions = [...new Set(pt.map(t=>t.industry).filter(Boolean))].sort()
  const categoryOptions = [...new Set(pt.map(t=>t.category).filter(Boolean))].sort()
  const projectOptions = [...new Set(pt.map(t=>t.project).filter(Boolean))].sort()
  const taskAllIndustries = [...(taskGlobalIndustries.length?taskGlobalIndustries:PRESET_INDUSTRIES), ...taskOrgIndustries.filter(d=>!(taskGlobalIndustries.length?taskGlobalIndustries:PRESET_INDUSTRIES).includes(d))]
  const activeFilterCount = [filterTitle, filterWorker, filterDept, filterIndustry, filterCategory, filterStatuses.length>0, filterPriorities.length>0, filterCompliance, filterProject].filter(Boolean).length
  const filteredPt = pt.filter(t=>{
    if(filterTitle && !t.title?.toLowerCase().includes(filterTitle.toLowerCase())) return false
    if(filterWorker && (t.assigned_user_name||t.assigned_user_id||'')!==filterWorker) return false
    if(filterDept && t.department!==filterDept) return false
    if(filterIndustry && t.industry!==filterIndustry) return false
    if(filterCategory && t.category!==filterCategory) return false
    if(filterStatuses.length>0 && !filterStatuses.includes(t.status)) return false
    if(filterPriorities.length>0 && !filterPriorities.includes(t.priority)) return false
    if(filterCompliance && !t.compliance) return false
    if(filterProject && t.project!==filterProject) return false
    return true
  })
  const clearFilters = ()=>{ setFilterTitle(''); setFilterWorker(''); setFilterDept(''); setFilterIndustry(''); setFilterCategory(''); setFilterStatuses([]); setFilterPriorities([]); setFilterCompliance(false); setFilterProject('') }
  const toggleFStatus = s => setFilterStatuses(prev=>prev.includes(s)?prev.filter(x=>x!==s):[...prev,s])
  const toggleFPriority = p => setFilterPriorities(prev=>prev.includes(p)?prev.filter(x=>x!==p):[...prev,p])

  // --- Shared stats helpers ---
  const pct = (a,b) => b>0 ? Math.round((a/b)*100) : 0
  const fmtDur = (s,e) => { if(!s||!e) return '—'; const m=Math.round((new Date(e)-new Date(s))/60000); return m<60?m+'m':Math.floor(m/60)+'h '+(m%60)+'m' }
  const pl = {weekly:'Last 7 Days',monthly:'Last Month',quarterly:'Last 3 Months',annual:'Last Year',custom:customStart+' to '+customEnd}[period]

  // --- Compliance report stats ---
  const total=filteredPt.length, done=filteredPt.filter(t=>['completed','approved'].includes(t.status)).length
  const approved=filteredPt.filter(t=>t.status==='approved').length, rejected=filteredPt.filter(t=>t.status==='rejected').length
  const overdue=filteredPt.filter(t=>t.status==='overdue').length
  const notOnTime=filteredPt.filter(t=>t.due_date&&t.completed_at&&new Date(t.completed_at)>new Date(t.due_date)).length
  const compT=filteredPt.filter(t=>t.compliance), compDone=compT.filter(t=>['completed','approved'].includes(t.status)).length
  const pendingReview=filteredPt.filter(t=>t.status==='awaiting_review').length
  const reviewed=filteredPt.filter(t=>['approved','rejected'].includes(t.status)).length
  const totalToReview=filteredPt.filter(t=>['awaiting_review','approved','rejected'].includes(t.status)).length
  const reviewedInTime=filteredPt.filter(t=>t.reviewed_at&&t.submitted_at&&(new Date(t.reviewed_at)-new Date(t.submitted_at))<=86400000).length
  const reviewedInTimePct=pct(reviewedInTime,totalToReview)
  const doneOnDay=filteredPt.filter(t=>t.due_date&&t.completed_at&&new Date(t.completed_at).toDateString()===new Date(t.due_date).toDateString()).length
  const tasksDueToday=filteredPt.filter(t=>t.due_date).length
  const doneOnDayPct=pct(doneOnDay,tasksDueToday)
  const reviewWithin1Day=filteredPt.filter(t=>t.reviewed_at&&t.submitted_at&&(new Date(t.reviewed_at)-new Date(t.submitted_at))<=86400000).length
  const reviewWithin1DayPct=pct(reviewWithin1Day,totalToReview)
  const reportWithinWeek=filteredPt.filter(t=>t.reviewed_at&&t.created_at&&(new Date(t.reviewed_at)-new Date(t.created_at))<=604800000).length
  const reportWithinWeekPct=pct(reportWithinWeek,filteredPt.length)

  // --- Worker performance stats ---
  const workerRoles = ['worker','supervisor','manager']
  const workerMap = {}
  filteredPt.forEach(t => {
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
  const uniqueWorkers = new Set(filteredPt.map(t=>t.assigned_user_id||t.assigned_user_name).filter(Boolean))
  const byRole = {}
  workerRoles.forEach(r => {
    const roleTasks = filteredPt.filter(t=>t.assigned_role===r)
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
    // Use a Blob URL so the current tab is never navigated away from.
    // window.open('','_blank') + document.write is blocked by mobile browsers as a popup
    // and can cause the current tab to reload, losing the session.
    try {
      const blob = new Blob([html], {type:'text/html;charset=utf-8'})
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(()=>URL.revokeObjectURL(url), 15000)
    } catch(e) {
      // Last-resort fallback: download as an HTML file
      const a = document.createElement('a')
      a.href = 'data:text/html;charset=utf-8,'+encodeURIComponent(html)
      a.download = 'taksyn-report.html'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  }

  const exportCompliancePDF = () => {
    const rows = filteredPt.map(t=>'<tr><td>'+t.id+'</td><td><strong>'+t.title+'</strong></td><td>'+t.category+'</td><td style="color:'+(t.status==='approved'?'#10B981':t.status==='rejected'?'#EF4444':'#1a2033')+'">'+t.status.replace('_',' ').toUpperCase()+'</td><td>'+(t.compliance?'✓ Yes':'—')+'</td><td>'+(t.due_date||'—')+'</td><td>'+(t.completed_at?new Date(t.completed_at).toLocaleDateString():'—')+'</td><td>'+(fmtDur(t.started_at,t.completed_at))+'</td><td>'+(t.assigned_user_name||ROLE_LABELS[t.assigned_role]||'—')+'</td></tr>').join('')
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
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Taksyn Staff Performance</title><style>${baseStyle}.sg{grid-template-columns:repeat(4,1fr)}</style></head><body>${reportHeader('Staff Performance Report')}<div class="sg"><div class="st"><div class="sv">${uniqueWorkers.size}</div><div class="sl">Total Staff</div></div><div class="st"><div class="sv">${filteredPt.length}</div><div class="sl">Total Tasks</div></div><div class="st"><div class="sv g">${done}</div><div class="sl">Completed</div></div><div class="st"><div class="sv" style="color:#8B5CF6">${pct(compDone,compT.length)}%</div><div class="sl">Overall Compliance</div></div></div><table><thead><tr><th>Name</th><th>Role</th><th>Assigned</th><th>Completed</th><th>Completion Rate</th><th>On Time %</th><th>Avg Duration</th><th>Reviews in 24h</th></tr></thead><tbody>${rows}</tbody></table>${reportFooter}</body></html>`
    openReport(html)
  }

  const exportOrgPDF = () => {
    const roleRows = workerRoles.map(r => '<tr><td><strong>'+ROLE_LABELS[r]+'</strong></td><td>'+byRole[r].tasks+'</td><td>'+byRole[r].done+'</td><td style="color:'+(pct(byRole[r].done,byRole[r].tasks)>=80?'#10B981':pct(byRole[r].done,byRole[r].tasks)>=50?'#F59E0B':'#EF4444')+'">'+pct(byRole[r].done,byRole[r].tasks)+'%</td><td style="color:'+(byRole[r].compRate>=80?'#10B981':byRole[r].compRate>=50?'#F59E0B':'#EF4444')+'">'+byRole[r].compRate+'%</td></tr>').join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Taksyn Organisation Overview</title><style>${baseStyle}.sg{grid-template-columns:repeat(4,1fr)}</style></head><body>${reportHeader('Organisation Overview Report')}<div class="sg"><div class="st"><div class="sv">${uniqueWorkers.size}</div><div class="sl">Active Workers</div></div><div class="st"><div class="sv">${filteredPt.length}</div><div class="sl">Total Tasks</div></div><div class="st"><div class="sv g">${done}</div><div class="sl">Tasks Completed</div></div><div class="st"><div class="sv" style="color:#8B5CF6">${pct(compDone,compT.length)}%</div><div class="sl">Overall Compliance</div></div></div><div class="sec"><div class="sec-title">Compliance Rate by Role</div><table><thead><tr><th>Role</th><th>Tasks Assigned</th><th>Completed</th><th>Completion Rate</th><th>Compliance Rate</th></tr></thead><tbody>${roleRows}</tbody></table></div><div class="sec"><div class="sec-title">All Tasks Summary</div><table><thead><tr><th>ID</th><th>Title</th><th>Assigned To</th><th>Role</th><th>Status</th><th>Due</th><th>Compliance</th></tr></thead><tbody>${filteredPt.map(t=>'<tr><td>'+t.id+'</td><td>'+t.title+'</td><td>'+(t.assigned_user_name||'—')+'</td><td>'+(ROLE_LABELS[t.assigned_role]||'—')+'</td><td>'+t.status.replace('_',' ').toUpperCase()+'</td><td>'+(t.due_date||'—')+'</td><td>'+(t.compliance?'✓':'—')+'</td></tr>').join('')}</tbody></table></div>${reportFooter}</body></html>`
    openReport(html)
  }

  const handleExport = () => {
    if (reportType==='compliance') exportCompliancePDF()
    else if (reportType==='worker') exportWorkerPDF()
    else if (reportType==='org') exportOrgPDF()
    if (setAuditLog) {
      const rEntry = mkAuditEntry('report_exported', user, user.org, { period }, null, null, null, reportType+' / '+period)
      setAuditLog(prev=>[rEntry,...prev])
      if (isConfigured()) supabase.from('audit_log').insert(rEntry).then(({error})=>{ if(error) console.warn('audit_log insert error:', error.message) })
    }
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
          <button className="btn btn-secondary btn-sm" onClick={()=>{ const csv='ID,Title,Category,Status,Priority,Compliance,Evidence,Due Date,Completed,Duration,Assigned To\n'+filteredPt.map(t=>[t.id,t.title,t.category,t.status,t.priority,t.compliance,parseSafe(t.evidence).length,t.due_date,t.completed_at||'',fmtDur(t.started_at,t.completed_at)||'',t.assigned_user_name||''].join(',')).join('\n'); const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='taksyn-report.csv';a.click() }}>📥 CSV</button>
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

      {/* Filter Panel */}
      <div className="section" style={{marginBottom:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <button
            className={'btn btn-sm '+(showFilters||activeFilterCount>0?'btn-primary':'btn-secondary')}
            onClick={()=>setShowFilters(s=>!s)}
            style={{display:'flex',alignItems:'center',gap:6}}
          >
            🔍 Filters
            {activeFilterCount>0&&<span style={{background:'rgba(255,255,255,0.3)',borderRadius:10,padding:'1px 7px',fontSize:10,fontWeight:800}}>{activeFilterCount}</span>}
            <span style={{fontSize:11,opacity:.7}}>{showFilters?'▲':'▼'}</span>
          </button>
          {activeFilterCount>0&&(
            <div style={{fontSize:12,color:'var(--t2)',display:'flex',alignItems:'center',gap:10}}>
              <span>Showing <strong style={{color:'var(--text)'}}>{filteredPt.length}</strong> of <strong style={{color:'var(--text)'}}>{pt.length}</strong> tasks · filters active</span>
              <button style={{background:'none',border:'none',cursor:'pointer',color:'var(--red)',fontSize:11,fontFamily:'inherit',fontWeight:600,padding:0}} onClick={clearFilters}>✕ Clear All</button>
            </div>
          )}
        </div>

        {showFilters&&(
          <div style={{marginTop:14,display:'flex',flexDirection:'column',gap:14}}>
            {/* Row 1: Title + Worker + Department */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:10}}>
              <div>
                <div style={{fontSize:10,fontWeight:700,color:'var(--t2)',marginBottom:4,textTransform:'uppercase',letterSpacing:'.5px'}}>Task Title</div>
                <input className="form-input" style={{fontSize:12,width:'100%'}} placeholder="Search by title…" value={filterTitle} onChange={e=>setFilterTitle(e.target.value)}/>
              </div>
              <div>
                <div style={{fontSize:10,fontWeight:700,color:'var(--t2)',marginBottom:4,textTransform:'uppercase',letterSpacing:'.5px'}}>Assigned Person</div>
                <select className="form-input" style={{fontSize:12,width:'100%'}} value={filterWorker} onChange={e=>setFilterWorker(e.target.value)}>
                  <option value="">All workers</option>
                  {workerOptions.map(w=><option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <div>
                <div style={{fontSize:10,fontWeight:700,color:'var(--t2)',marginBottom:4,textTransform:'uppercase',letterSpacing:'.5px'}}>Department</div>
                <select className="form-input" style={{fontSize:12,width:'100%'}} value={filterDept} onChange={e=>setFilterDept(e.target.value)}>
                  <option value="">All departments</option>
                  {deptOptions.map(d=><option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <div style={{fontSize:10,fontWeight:700,color:'var(--t2)',marginBottom:4,textTransform:'uppercase',letterSpacing:'.5px'}}>Industry</div>
                <select className="form-input" style={{fontSize:12,width:'100%'}} value={filterIndustry} onChange={e=>setFilterIndustry(e.target.value)}>
                  <option value="">All industries</option>
                  {industryOptions.map(d=><option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <div style={{fontSize:10,fontWeight:700,color:'var(--t2)',marginBottom:4,textTransform:'uppercase',letterSpacing:'.5px'}}>Category</div>
                <select className="form-input" style={{fontSize:12,width:'100%'}} value={filterCategory} onChange={e=>setFilterCategory(e.target.value)}>
                  <option value="">All categories</option>
                  {categoryOptions.map(c=><option key={c} value={c}>{CAT_ICONS[c]||'📋'} {c}</option>)}
                </select>
              </div>
              {projectOptions.length>0&&(
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--t2)',marginBottom:4,textTransform:'uppercase',letterSpacing:'.5px'}}>Project</div>
                  <select className="form-input" style={{fontSize:12,width:'100%'}} value={filterProject} onChange={e=>setFilterProject(e.target.value)}>
                    <option value="">All projects</option>
                    {projectOptions.map(p=><option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Status multi-select */}
            <div>
              <div style={{fontSize:10,fontWeight:700,color:'var(--t2)',marginBottom:6,textTransform:'uppercase',letterSpacing:'.5px'}}>Status</div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {[['pending','Pending','#6B7280'],['in_progress','In Progress','#3B82F6'],['awaiting_review','Awaiting Review','#F59E0B'],['approved','Approved','#10B981'],['rejected','Rejected','#EF4444'],['overdue','Overdue','#DC2626']].map(([v,l,col])=>(
                  <button key={v} onClick={()=>toggleFStatus(v)} style={{padding:'4px 11px',borderRadius:6,fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',border:'none',background:filterStatuses.includes(v)?col:'var(--s3)',color:filterStatuses.includes(v)?'#fff':'var(--t2)',transition:'all .15s'}}>{l}</button>
                ))}
              </div>
            </div>

            {/* Priority multi-select */}
            <div>
              <div style={{fontSize:10,fontWeight:700,color:'var(--t2)',marginBottom:6,textTransform:'uppercase',letterSpacing:'.5px'}}>Priority</div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {[['critical','Critical','#EF4444'],['high','High','#F59E0B'],['medium','Medium','#3B82F6'],['low','Low','#10B981']].map(([v,l,col])=>(
                  <button key={v} onClick={()=>toggleFPriority(v)} style={{padding:'4px 11px',borderRadius:6,fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',border:'none',background:filterPriorities.includes(v)?col:'var(--s3)',color:filterPriorities.includes(v)?'#fff':'var(--t2)',transition:'all .15s'}}>{l}</button>
                ))}
              </div>
            </div>

            {/* Compliance toggle + Clear */}
            <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
              <button className={'btn btn-sm '+(filterCompliance?'btn-primary':'btn-secondary')} onClick={()=>setFilterCompliance(c=>!c)}>
                🔒 Compliance tasks only
              </button>
              {activeFilterCount>0&&(
                <button className="btn btn-secondary btn-sm" onClick={clearFilters}>✕ Clear All Filters ({activeFilterCount})</button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Active filter summary banner */}
      {activeFilterCount>0&&!showFilters&&(
        <div style={{background:'rgba(59,130,246,.06)',border:'1px solid rgba(59,130,246,.2)',borderRadius:8,padding:'8px 14px',marginBottom:14,fontSize:12,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span>🔍 Showing <strong>{filteredPt.length}</strong> of <strong>{pt.length}</strong> tasks ({activeFilterCount} filter{activeFilterCount>1?'s':''} active)</span>
          <button style={{background:'none',border:'none',cursor:'pointer',color:'var(--red)',fontSize:11,fontFamily:'inherit',fontWeight:600}} onClick={clearFilters}>Clear filters</button>
        </div>
      )}

      {/* Compliance Report Preview */}
      {reportType==='compliance' && (
        <>
          <div className="section">
            <div className="section-title">Compliance Overview — {filteredPt.length} tasks</div>
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

      {/* Staff Performance Preview */}
      {reportType==='worker' && isClientAdmin && (
        <div className="section">
          <div className="section-title">Staff Performance — {filteredPt.length} tasks · {pl}</div>
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
            <div className="section-title">Organisation Summary — {filteredPt.length} tasks · {pl}</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:10,marginTop:10}}>
              {[['Active Workers',uniqueWorkers.size,''],['Total Tasks',filteredPt.length,''],['Completed',done,'g'],['Compliance Rate',pct(compDone,compT.length)+'%','p']].map(([l,v,c])=>(
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

function UsersView({ user, setAuditLog }) {
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteMethod, setInviteMethod] = useState('email')
  const [inviteOrg, setInviteOrg] = useState('')
  const [invitePositions, setInvitePositions] = useState([{industry:'',role:'',position:''}])
  const [showManageIndustries, setShowManageIndustries] = useState(false)
  const [newIndustry, setNewIndustry] = useState('')
  const [globalIndustries, setGlobalIndustries] = useState([])
  const [orgCustomRoles, setOrgCustomRoles] = useState([])
  const [orgCustomPositions, setOrgCustomPositions] = useState([])
  const [realUsers, setRealUsers] = useState([])
  const [editingUser, setEditingUser] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [userSearch, setUserSearch] = useState('')
  const [collapsedRoles, setCollapsedRoles] = useState({})
  const [orgCustomDepts, setOrgCustomDepts] = useState([]) // custom industry strings for this org
  const [orgsList, setOrgsList] = useState([])
  const [editOrgSearch, setEditOrgSearch] = useState('')
  const [userPositions, setUserPositions] = useState({})
  const [editPositions, setEditPositions] = useState([])
  const [newPosition, setNewPosition] = useState({ dept:'', role:'worker', title:'' })

  const baseIndustries = globalIndustries.length ? globalIndustries : PRESET_INDUSTRIES
  const allIndustries = [...baseIndustries, ...orgCustomDepts.filter(d=>!baseIndustries.includes(d))]

  const saveCustomIndustry = async () => {
    const name = newIndustry.trim()
    if (!name || allIndustries.includes(name)) return
    setOrgCustomDepts(prev=>[...prev, name])
    setNewIndustry('')
    if (isConfigured()) {
      const orgId = orgsList.find(o=>o.name===user.org)?.id
      supabase.from('org_industries').insert({ name, organisation_id:orgId||null, created_by: user.name, created_at: new Date().toISOString() }).catch(()=>{})
    }
  }

  const removeCustomIndustry = async (name) => {
    setOrgCustomDepts(prev=>prev.filter(d=>d!==name))
    if (isConfigured()) {
      const orgId = orgsList.find(o=>o.name===user.org)?.id
      if(orgId) supabase.from('org_industries').delete().eq('name', name).eq('organisation_id', orgId).catch(()=>{})
    }
  }

  useEffect(()=>{
    if(!isConfigured()) return
    supabase.from('global_industries').select('name').order('name')
      .then(({data})=>{ if(data?.length) setGlobalIndustries(data.map(d=>d.name)) }).catch(()=>{})
  },[])

  useEffect(()=>{
    if(!isConfigured()||!user.org) return
    supabase.from('organisations').select('id').eq('name', user.org).maybeSingle()
      .then(({data:orgRow})=>{
        if(!orgRow?.id) return
        supabase.from('org_industries').select('name').eq('organisation_id', orgRow.id)
          .then(({data})=>{ if(data?.length) setOrgCustomDepts(data.map(d=>d.name)) }).catch(()=>{})
      }).catch(()=>{})
  },[user.org])

  useEffect(()=>{
    if(!isConfigured()) return
    supabase.from('organisations').select('id,name').order('name')
      .then(({data})=>{ if(data) setOrgsList(data) })
  },[])

  const loadInviteOrgData = async (orgName) => {
    if(!isConfigured()||!orgName) return
    const cached = orgsList.find(o=>o.name===orgName)
    let orgId = cached?.id
    if(!orgId) {
      const {data} = await supabase.from('organisations').select('id').eq('name',orgName).maybeSingle()
      orgId = data?.id
    }
    if(!orgId) return
    const [rolesRes, posRes] = await Promise.all([
      supabase.from('org_custom_roles').select('industry_name,role_name').eq('organisation_id',orgId).order('sort_order',{nullsFirst:false}).order('role_name'),
      supabase.from('org_custom_positions').select('position_name').eq('organisation_id',orgId).order('sort_order',{nullsFirst:false}).order('position_name')
    ])
    setOrgCustomRoles(rolesRes.data||[])
    setOrgCustomPositions(posRes.data?.map(p=>p.position_name)||[])
  }

  const openInviteForm = async (method) => {
    if(method) setInviteMethod(method)
    setShowInvite(true)
    const targetOrg = user.role==='super_admin' ? inviteOrg.trim()||'' : user.org
    await loadInviteOrgData(targetOrg)
  }

  useEffect(()=>{
    if(user.role==='super_admin'&&inviteOrg.trim()) loadInviteOrgData(inviteOrg.trim())
  },[inviteOrg])

  useEffect(()=>{
    if(!isConfigured()||!user.id) return
    if(user.role==='super_admin') {
      supabase.from('profiles').select('*').then(({data})=>{ if(data) setRealUsers(data) }).catch(()=>{})
      return
    }
    supabase.from('profiles').select('*').eq('org', user.org)
      .then(({data:workforceMembers})=>{ setRealUsers(workforceMembers||[]) })
      .catch(()=>{})
  },[user.org])

  const deleteUser = async (id) => {
    if (!confirm('Remove this user from your organisation?\n\nTheir active tasks will be unassigned — work history is preserved.')) return
    const target = realUsers.find(u=>u.id===id)
    if(isConfigured()) {
      try {
        await supabase.from('org_members').delete().eq('user_id',id).eq('org',user.org)
      } catch(err) { console.error('Remove member org_members error:', err) }
      // user_positions table removed
      try {
        await supabase.from('tasks').update({ assigned_user_id: null })
          .eq('assigned_user_id', id).eq('org', user.org)
          .not('status', 'in', '("completed","approved")')
      } catch(err) { console.error('Remove member tasks error:', err) }
    }
    setRealUsers(prev=>prev.filter(u=>u.id!==id))
    setUserPositions(prev=>{ const n={...prev}; delete n[id]; return n })
    if (setAuditLog) {
      const rmEntry = mkAuditEntry('member_removed', user, user.org, { memberRole:target?.role||'' }, null, null, target?.name||id, null)
      setAuditLog(prev=>[rmEntry,...prev])
      if (isConfigured()) supabase.from('audit_log').insert(rmEntry).then(({error})=>{ if(error) console.warn('audit_log insert error:', error.message) })
    }
  }

  const saveEditUser = async () => {
    if (!editForm.name?.trim()) return
    const { id } = editingUser
    const updates = {
      name: editForm.name.trim(),
      role: editForm.role,
      industry: editForm.industry||'',
      phone: editForm.phone||'',
      notes: editForm.notes||'',
      email: editForm.email||''
    }
    if (isConfigured()) {
      await supabase.from('profiles').update(updates).eq('id', id)
      const targetOrg = editForm.org || user.org
      await supabase.from('org_members').upsert({ user_id: id, org: targetOrg, role: editForm.role }, { onConflict: 'user_id,org' })
    }
    setRealUsers(prev=>prev.map(u=>u.id===id?{...u,...updates}:u))
    if (setAuditLog) {
      const oldUser = realUsers.find(u=>u.id===id)
      const roleChanged = oldUser?.role && oldUser.role!==editForm.role
      const evType = roleChanged ? 'role_changed' : 'member_edited'
      const ov = roleChanged ? (ROLE_LABELS[oldUser.role]||oldUser.role) : null
      const nv = roleChanged ? (ROLE_LABELS[editForm.role]||editForm.role) : null
      const eEntry = mkAuditEntry(evType, user, user.org, { memberName:updates.name }, null, null, ov, nv)
      setAuditLog(prev=>[eEntry,...prev])
      if (isConfigured()) supabase.from('audit_log').insert(eEntry).then(({error})=>{ if(error) console.warn('audit_log insert error:', error.message) })
      if (roleChanged) logAuditEvent(user, 'member.role_changed', 'member', id, updates.name, (ROLE_LABELS[oldUser?.role]||oldUser?.role||'?')+' → '+(ROLE_LABELS[editForm.role]||editForm.role))
      else logAuditEvent(user, 'member.edited', 'member', id, updates.name, 'Profile updated')
    }
    // user_positions table removed — position edits not persisted
    setEditingUser(null)
    setEditForm({})
    setEditCustomDept('')
    setEditOrgSearch('')
    setEditPositions([])
    setNewPosition({ dept:'', role:'worker', title:'' })
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

  const resetInviteForm = () => {
    setInviteEmail(''); setInviteName(''); setInviteOrg('')
    setInvitePositions([{industry:'',role:'',position:''}])
  }

  const positionToSystemRole = (pos) => {
    if(pos==='Manager') return 'manager'
    if(pos==='Supervisor') return 'supervisor'
    if(pos==='Client Admin') return 'client_admin'
    return 'worker'
  }

  const sendInvite = async () => {
    const targetOrg = user.role==='super_admin' ? inviteOrg.trim() : user.org
    if (user.role==='super_admin' && !targetOrg) { alert('Please enter the organisation name'); return }
    if (!inviteEmail.trim() || !inviteName.trim()) { alert('Please enter name and email'); return }

    const validRows = invitePositions.filter(p=>p.role||p.industry||p.position)
    const roleOrder = ['client_admin','manager','supervisor','worker']
    const systemRole = validRows.length ? validRows.reduce((best,p)=>{ const r=positionToSystemRole(p.position); return roleOrder.indexOf(r)<roleOrder.indexOf(best)?r:best }, 'worker') : 'worker'
    const firstIndustry = validRows.find(p=>p.industry)?.industry || ''
    const rolesSummary = validRows.map(p=>[p.industry,p.role,p.position].filter(Boolean).join(' / ')).join('; ')
    const positionsSummary = rolesSummary ? '\n\nAssignments: '+rolesSummary : ''

    if (inviteMethod==='whatsapp') {
      const msg=encodeURIComponent('Hi '+inviteName+'! You have been invited to join Taksyn at '+targetOrg+'.'+positionsSummary+'\n\nSign up here: https://taksyn.vercel.app\n\nUse your email: '+inviteEmail+'\n\nOrganisation name to enter: '+targetOrg)
      window.open('https://wa.me/?text='+msg,'_blank')
      setShowInvite(false); resetInviteForm()
      return
    }

    if (!isConfigured()) { alert('Supabase not configured'); return }
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || supabase.supabaseUrl
      const res = await fetch(supabaseUrl+'/functions/v1/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), name: inviteName.trim(), role: systemRole, org: targetOrg, industry: firstIndustry, positions: rolesSummary, secret: import.meta.env.VITE_INVITE_SECRET || '' })
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error||result.message||'Invite failed ('+res.status+')')
      alert('Invite sent to '+inviteEmail+'!'+(rolesSummary?'\n\nAssignments: '+rolesSummary:''))
      logAuditEvent(user, 'member.invited', 'member', null, inviteName.trim(), ROLE_LABELS[systemRole]+' · '+inviteEmail.trim())
      setShowInvite(false); resetInviteForm()
    } catch(e) {
      alert('Failed to send invite: '+e.message)
    }
  }

  return (
    <div className="anim">
      {editingUser&&(
        <div className="modal-overlay" onClick={()=>{ setEditingUser(null); setEditForm({}); setEditOrgSearch(''); setEditPositions([]); setNewPosition({dept:'',role:'worker',title:''}) }}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr">
              <div className="modal-title">Edit Team Member</div>
              <button className="modal-close" onClick={()=>{ setEditingUser(null); setEditForm({}); setEditOrgSearch(''); setEditPositions([]); setNewPosition({dept:'',role:'worker',title:''}) }}>×</button>
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
                <div className="form-field" style={{gridColumn:'1/-1'}}>
                  <label className="form-label">Industry</label>
                  <select className="form-input" value={editForm.industry||''} onChange={e=>setEditForm({...editForm,industry:e.target.value})}>
                    <option value="">— Select industry —</option>
                    {[...PRESET_INDUSTRIES,...orgCustomDepts.filter(d=>!PRESET_INDUSTRIES.includes(d))].map(k=><option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-field">
                <label className="form-label">Notes</label>
                <textarea className="comment-box" style={{minHeight:60}} value={editForm.notes||''} onChange={e=>setEditForm({...editForm,notes:e.target.value})} placeholder="Any notes about this team member..."/>
              </div>
              {orgsList.length>0&&<div className="form-field">
                <label className="form-label">Organisation</label>
                <input className="form-input" value={editOrgSearch} onChange={e=>setEditOrgSearch(e.target.value)} placeholder="Search organisations..." style={{marginBottom:4}}/>
                <select className="form-input" value={editForm.org||''} onChange={e=>setEditForm({...editForm,org:e.target.value})}>
                  <option value="">— No organisation —</option>
                  {orgsList.filter(o=>o.name.toLowerCase().includes(editOrgSearch.toLowerCase())).map(o=><option key={o.id} value={o.name}>{o.name}</option>)}
                </select>
              </div>}
              <div className="form-field" style={{borderTop:'1px solid var(--border)',paddingTop:12,marginTop:4}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                  <label className="form-label" style={{margin:0}}>Positions</label>
                  <span style={{fontSize:10,color:'var(--t2)'}}>Multiple roles across industries</span>
                </div>
                {editPositions.map((pos,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:6,marginBottom:6,background:'var(--s3)',borderRadius:8,padding:'8px 10px'}}>
                    <div style={{flex:1,display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                      <PositionChip pos={pos}/>
                      {pos.is_primary&&<span style={{fontSize:10,color:'#F59E0B',fontWeight:600}}>PRIMARY</span>}
                    </div>
                    <div style={{display:'flex',gap:4,flexShrink:0}}>
                      {!pos.is_primary&&<button className="btn btn-secondary btn-sm" style={{fontSize:10,padding:'3px 7px'}} onClick={()=>setEditPositions(prev=>prev.map((p,j)=>({...p,is_primary:j===i})))}>★ Primary</button>}
                      <button className="btn btn-danger btn-sm" style={{fontSize:10,padding:'3px 7px'}} onClick={()=>setEditPositions(prev=>prev.filter((_,j)=>j!==i))}>×</button>
                    </div>
                  </div>
                ))}
                <div style={{background:'var(--s3)',borderRadius:8,padding:10,marginTop:6}}>
                  <div style={{fontSize:11,fontWeight:600,color:'var(--t2)',marginBottom:8}}>Add Position</div>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    <select className="form-select" value={newPosition.dept} onChange={e=>setNewPosition(p=>({...p,dept:e.target.value}))} style={{flex:1,minWidth:130,fontSize:12}}>
                      <option value="">— Industry —</option>
                      {allIndustries.map(d=><option key={d} value={d}>{d}</option>)}
                    </select>
                    <select className="form-select" value={newPosition.role} onChange={e=>setNewPosition(p=>({...p,role:e.target.value}))} style={{width:130,fontSize:12}}>
                      <option value="worker">Staff Member</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="manager">Manager</option>
                    </select>
                    <input className="form-input" placeholder="Position e.g. Nurse" value={newPosition.title} onChange={e=>setNewPosition(p=>({...p,title:e.target.value}))} style={{flex:1,minWidth:110,fontSize:12}}/>
                    <button className="btn btn-secondary btn-sm" disabled={!newPosition.dept} onClick={()=>{ if(!newPosition.dept) return; setEditPositions(prev=>[...prev,{department:newPosition.dept,role:newPosition.role,position_title:newPosition.title,is_primary:prev.length===0}]); setNewPosition({dept:'',role:'worker',title:''}) }}>+ Add</button>
                  </div>
                </div>
              </div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
                <button className="btn btn-secondary" onClick={()=>{ setEditingUser(null); setEditForm({}); setEditOrgSearch(''); setEditPositions([]); setNewPosition({dept:'',role:'worker',title:''}) }}>Cancel</button>
                <button className="btn btn-primary" disabled={!editForm.name?.trim()} onClick={saveEditUser}>Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showInvite&&(
        <div className="modal-overlay" onClick={()=>setShowInvite(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr"><div className="modal-title">Invite to Workforce</div><button className="modal-close" onClick={()=>setShowInvite(false)}>×</button></div>
            <div className="modal-body">
              <div className="two-col">
                <div className="form-field"><label className="form-label">Full Name</label><input className="form-input" value={inviteName} onChange={e=>setInviteName(e.target.value)} placeholder="Emma Wilson"/></div>
                <div className="form-field">
                  <label className="form-label">Email Address</label>
                  <input className="form-input" type="email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="emma@yourorg.com"
                    onBlur={()=>{
                      const existing = realUsers.find(u=>u.email?.toLowerCase()===inviteEmail.trim().toLowerCase())
                      if(existing) {
                        if(window.confirm(existing.name+' ('+existing.email+') is already a member of this organisation.\n\nWould you like to add a new role assignment to their existing account instead?')) {
                          setInviteName(existing.name)
                        }
                      }
                    }}/>
                </div>
              </div>
              {user.role==='super_admin'&&<div className="form-field"><label className="form-label">Organisation <span style={{color:'var(--red)'}}>*</span></label><input className="form-input" value={inviteOrg} onChange={e=>setInviteOrg(e.target.value)} placeholder="Exact organisation name"/></div>}
              <div className="form-field" style={{borderTop:'1px solid var(--border)',paddingTop:12}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                  <label className="form-label" style={{margin:0}}>Position Assignments</label>
                  <span style={{fontSize:10,color:'var(--t2)'}}>Industry · Role · Position</span>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto',gap:4,marginBottom:4,padding:'0 4px'}}>
                  {['Industry','Role','Position',''].map((h,i)=><div key={i} style={{fontSize:9,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.5px'}}>{h}</div>)}
                </div>
                {invitePositions.map((row,i)=>{
                  const rolesForIndustry = row.industry ? orgCustomRoles.filter(r=>r.industry_name===row.industry).map(r=>r.role_name) : []
                  const defaultPositions = ['Staff Member','Supervisor','Manager',...(['super_admin','client_admin'].includes(user.role)?['Client Admin']:[])]
                  const allPositions = [...defaultPositions, ...orgCustomPositions.filter(p=>!defaultPositions.includes(p))]
                  return (
                    <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto',gap:4,marginBottom:6,alignItems:'center'}}>
                      <select className="form-select" style={{fontSize:11}} value={row.industry} onChange={e=>setInvitePositions(prev=>prev.map((p,j)=>j===i?{...p,industry:e.target.value,role:''}:p))}>
                        <option value="">— Industry —</option>
                        {allIndustries.map(k=><option key={k} value={k}>{k}</option>)}
                      </select>
                      {rolesForIndustry.length>0 ? (
                        <select className="form-select" style={{fontSize:11}} value={row.role} onChange={e=>setInvitePositions(prev=>prev.map((p,j)=>j===i?{...p,role:e.target.value}:p))}>
                          <option value="">— Role —</option>
                          {rolesForIndustry.map(r=><option key={r} value={r}>{r}</option>)}
                        </select>
                      ) : (
                        <input className="form-input" style={{fontSize:11}} value={row.role} onChange={e=>setInvitePositions(prev=>prev.map((p,j)=>j===i?{...p,role:e.target.value}:p))} placeholder="Role / title"/>
                      )}
                      <select className="form-select" style={{fontSize:11}} value={row.position} onChange={e=>setInvitePositions(prev=>prev.map((p,j)=>j===i?{...p,position:e.target.value}:p))}>
                        <option value="">— Position —</option>
                        {allPositions.map(p=><option key={p} value={p}>{p}</option>)}
                      </select>
                      <button style={{background:'none',border:'none',cursor:invitePositions.length>1?'pointer':'default',opacity:invitePositions.length>1?1:.3,color:'var(--red)',fontSize:16,padding:'0 4px',lineHeight:1}} onClick={()=>invitePositions.length>1&&setInvitePositions(prev=>prev.filter((_,j)=>j!==i))}>×</button>
                    </div>
                  )
                })}
                <button className="btn btn-secondary btn-sm" style={{fontSize:11}} onClick={()=>setInvitePositions(prev=>[...prev,{industry:'',role:'',position:''}])}>+ Add another position</button>
              </div>
              {inviteName.trim()&&invitePositions.some(p=>p.role||p.position)&&(
                <div style={{background:'rgba(0,168,126,.06)',border:'1px solid rgba(0,168,126,.2)',borderRadius:8,padding:10,marginBottom:12,fontSize:12,color:'var(--text)',lineHeight:1.5}}>
                  <div style={{fontSize:10,fontWeight:700,color:'var(--brand)',marginBottom:4,textTransform:'uppercase',letterSpacing:'.8px'}}>Invite Summary</div>
                  <strong>{inviteName.trim()}</strong> will be invited to <strong>{user.role==='super_admin'?inviteOrg||'(org required)':user.org}</strong>
                  {invitePositions.filter(p=>p.role||p.position).map((p,i)=>(
                    <div key={i} style={{marginTop:3,color:'var(--t2)'}}>{[p.industry,p.role,p.position].filter(Boolean).join(' · ')}</div>
                  ))}
                </div>
              )}
              <div className="form-field">
                <label className="form-label">Send Via</label>
                <div style={{display:'flex',gap:8}}>
                  <button className={"btn btn-sm "+(inviteMethod==='email'?'btn-primary':'btn-secondary')} onClick={()=>setInviteMethod('email')}>📧 Email</button>
                  <button className={"btn btn-sm "+(inviteMethod==='whatsapp'?'btn-primary':'btn-secondary')} onClick={()=>setInviteMethod('whatsapp')}>💬 WhatsApp</button>
                </div>
              </div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className="btn btn-secondary" onClick={()=>{ setShowInvite(false); resetInviteForm() }}>Cancel</button>
                <button className="btn btn-primary" onClick={sendInvite}>{inviteMethod==='whatsapp'?'💬 Send via WhatsApp':'📧 Send Invite'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showManageIndustries&&(
        <div className="modal-overlay" onClick={()=>setShowManageIndustries(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr"><div className="modal-title">🏭 Manage Industries</div><button className="modal-close" onClick={()=>setShowManageIndustries(false)}>×</button></div>
            <div className="modal-body">
              <div style={{fontSize:12,color:'var(--t2)',marginBottom:10}}>Preset industries are always available. Add custom industries specific to your organisation.</div>
              <div style={{display:'flex',gap:8,marginBottom:12}}>
                <input className="form-input" value={newIndustry} onChange={e=>setNewIndustry(e.target.value)} placeholder="e.g. Childcare, Veterinary..." onKeyDown={e=>e.key==='Enter'&&saveCustomIndustry()}/>
                <button className="btn btn-primary" onClick={saveCustomIndustry} disabled={!newIndustry.trim()}>Add</button>
              </div>
              <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.6px',marginBottom:6}}>Preset Industries</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:14}}>
                {PRESET_INDUSTRIES.map(i=><span key={i} style={{fontSize:11,padding:'3px 10px',borderRadius:10,background:'var(--s3)',color:'var(--t2)',fontWeight:500}}>{i}</span>)}
              </div>
              {orgCustomDepts.length>0&&<>
                <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.6px',marginBottom:6}}>Custom Industries ({orgCustomDepts.length})</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                  {orgCustomDepts.map(i=>(
                    <span key={i} style={{display:'flex',alignItems:'center',gap:4,fontSize:11,padding:'3px 10px',borderRadius:10,background:'rgba(99,102,241,.1)',color:'#6366F1',fontWeight:600,border:'1px solid rgba(99,102,241,.2)'}}>
                      {i}
                      <span style={{cursor:'pointer',opacity:.7,fontWeight:700}} onClick={()=>removeCustomIndustry(i)}>×</span>
                    </span>
                  ))}
                </div>
              </>}
            </div>
          </div>
        </div>
      )}
      <div className="ph"><div className="ph-top"><div><div className="ph-title">Workforce</div><div className="ph-sub">Manage your organisation's workforce</div></div><div style={{display:'flex',gap:8}}>{['client_admin','super_admin'].includes(user.role)&&<button className="btn btn-secondary" onClick={()=>setShowManageIndustries(true)}>🏭 Industries</button>}{['client_admin','super_admin'].includes(user.role)&&<button className="btn btn-primary" onClick={()=>openInviteForm()}><IC n="plus" s={13}/> Invite</button>}</div></div></div>
      <div className="section">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div className="section-title" style={{margin:0}}>Workforce ({realUsers.length})</div>
          <input className="form-input" placeholder="Search by name or role..." value={userSearch} onChange={e=>setUserSearch(e.target.value)} style={{fontSize:12,padding:'5px 10px',maxWidth:220}}/>
        </div>
        {realUsers.length===0
          ? <div style={{fontSize:13,color:'var(--t2)'}}>No workforce members yet. Use the Invite button to add staff.</div>
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
                {(userPositions[u.id]?.length>0) ? (
                  <div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:3}}>
                    {userPositions[u.id].map((pos,pi)=><PositionChip key={pi} pos={pos}/>)}
                  </div>
                ) : (u.industry&&<div style={{fontSize:10,color:'var(--t2)',marginTop:1}}>🏭 {u.industry}</div>)}
              </div>
              <RolePill role={u.role}/>
              {['client_admin','super_admin'].includes(user.role)&&<button className="btn btn-secondary btn-sm" onClick={()=>{ setEditingUser(u); setEditForm({name:u.name,role:u.role,department:u.department||'',industry:u.industry||'',phone:u.phone||'',notes:u.notes||'',email:u.email||'',org:u.org||''}); setEditPositions(userPositions[u.id]?.map(p=>({...p}))||[]) }}>✏️ Edit</button>}
              {['client_admin','super_admin'].includes(user.role)&&<button className="btn btn-danger btn-sm" onClick={()=>deleteUser(u.id)}>Remove</button>}
            </div>
          ))}
        </div>
      ))
    })()
        }
      </div>
      {['client_admin','super_admin'].includes(user.role)&&<div className="section">
        <div className="section-title">Invite Options</div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button className="btn btn-primary" onClick={()=>openInviteForm('email')}>📧 Invite via Email</button>
          <button className="btn btn-green" onClick={()=>openInviteForm('whatsapp')}>💬 Invite via WhatsApp</button>
        </div>
      </div>}
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

const TIMEZONES = [
  'Australia/Sydney','Australia/Melbourne','Australia/Brisbane','Australia/Perth',
  'Australia/Adelaide','Australia/Darwin','Australia/Hobart',
  'Pacific/Auckland','Pacific/Fiji','Pacific/Honolulu',
  'Asia/Singapore','Asia/Kuala_Lumpur','Asia/Tokyo','Asia/Seoul','Asia/Hong_Kong',
  'Asia/Dubai','Asia/Kolkata','Asia/Bangkok',
  'Europe/London','Europe/Paris','Europe/Berlin','Europe/Amsterdam',
  'America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
  'America/Toronto','America/Vancouver','America/Sao_Paulo',
  'Africa/Johannesburg','UTC',
]

const COMPANY_COMPLETENESS_FIELDS = [
  { key:'name', label:'Company Name' },
  { key:'industry', label:'Industry' },
  { key:'abn', label:'ABN / Business Number' },
  { key:'website', label:'Website' },
  { key:'timezone', label:'Timezone' },
  { key:'address_street', label:'Street Address' },
  { key:'address_city', label:'City' },
  { key:'address_state', label:'State' },
  { key:'address_postcode', label:'Postcode' },
  { key:'address_country', label:'Country' },
  { key:'contact_name', label:'Primary Contact Name' },
  { key:'contact_email', label:'Primary Contact Email' },
  { key:'contact_phone', label:'Primary Contact Phone' },
  { key:'contact2_name', label:'Secondary Contact Name' },
  { key:'contact2_email', label:'Secondary Contact Email' },
  { key:'contact2_phone', label:'Secondary Contact Phone' },
  { key:'logo', label:'Company Logo' },
]

const NAV = {
  super_admin:  [['dashboard','Dashboard','home'],['orgs','Organisations','users'],['users','Users','users'],['support','Support Tickets','alert'],['audit','Audit Log','audit'],['platform_settings','Platform Settings','settings'],['my_account','My Account','settings']],
  client_admin: [['dashboard','Dashboard','home'],['tasks','Tasks','tasks'],['escalations','Escalations','alert'],['reports','Reports','chart'],['audit','Audit Log','audit'],['users','Workforce','users'],['teams','Teams','users'],['projects','Projects 🔜','tasks'],['leave','Team Leave','clock'],['performance','Performance','chart'],['sla','Response Time','clock'],['tiers','Plans','tier'],['roles_departments','Roles & Positions','settings'],['company_settings','Company Settings','settings'],['help','Help & Support','alert']],
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
  const [inviteTab, setInviteTab] = useState('invite')
const [existingUserSearch, setExistingUserSearch] = useState('')
const [existingUserRole, setExistingUserRole] = useState('client_admin')
const [existingUserMsg, setExistingUserMsg] = useState('')
  const [selectedOrgView, setSelectedOrgView] = useState(null) // org being viewed in context
  const [orgContextTab, setOrgContextTab] = useState('members')
  const [orgContextSLA, setOrgContextSLA] = useState(null)
  const [orgContextTickets, setOrgContextTickets] = useState([])
  const [orgContextAudit, setOrgContextAudit] = useState([])
  const [orgMembers, setOrgMembers] = useState([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [viewingMember, setViewingMember] = useState(null)
  const [editingMember, setEditingMember] = useState(null)
  const [memberEditForm, setMemberEditForm] = useState({})
  const [orgChangeSearch, setOrgChangeSearch] = useState('')
  const [showAddMember, setShowAddMember] = useState(false)
  const [allProfiles, setAllProfiles] = useState([])
  const [addMemberSearch, setAddMemberSearch] = useState('')
  const [addMemberSelectedId, setAddMemberSelectedId] = useState(null)
  const [addMemberRole, setAddMemberRole] = useState('worker')
  const [addMemberMsg, setAddMemberMsg] = useState('')
  const [loadingProfiles, setLoadingProfiles] = useState(false)
  const [showMemberOrgChange, setShowMemberOrgChange] = useState(false)
  const [memberOrgSearch, setMemberOrgSearch] = useState('')
  const [editOrgIndustries, setEditOrgIndustries] = useState([])
  const [editOrgCustomRoles, setEditOrgCustomRoles] = useState([])
  const [editOrgCustomPositions, setEditOrgCustomPositions] = useState([])
  const [editMemberPositions, setEditMemberPositions] = useState([])
  const [editMemberNewPos, setEditMemberNewPos] = useState({industry:'',role:'',position:''})
  const [inviteOrgPositions, setInviteOrgPositions] = useState([{industry:'',role:'',position:''}])

  const INDUSTRIES = PRESET_INDUSTRIES

  useEffect(()=>{
    if(isConfigured()) loadOrgs()
  },[])

  useEffect(()=>{
    if(!isConfigured()||!showInvite?.id) return
    const orgId = showInvite.id
    setInviteOrgPositions([{industry:'',role:'',position:''}])
    setEditOrgCustomRoles([])
    setEditOrgCustomPositions([])
    setEditOrgIndustries([])
    supabase.from('global_industries').select('name').order('name')
      .then(({data:gi}) => {
        supabase.from('org_industries').select('name').eq('organisation_id', orgId)
          .then(({data:oi}) => {
            const globalNames = gi?.map(i=>i.name)||[]
            const orgNames = oi?.map(i=>i.name)||[]
            const base = globalNames.length ? globalNames : PRESET_INDUSTRIES
            setEditOrgIndustries([...base,...orgNames.filter(n=>!base.includes(n))])
          }).catch(()=>{})
      }).catch(()=>{})
    supabase.from('org_custom_roles').select('industry_name,role_name').eq('organisation_id',orgId).order('sort_order',{nullsFirst:false}).order('role_name')
      .then(({data})=>{ setEditOrgCustomRoles(data||[]) }).catch(()=>{})
    supabase.from('org_custom_positions').select('position_name').eq('organisation_id',orgId).order('sort_order',{nullsFirst:false}).order('position_name')
      .then(({data})=>{ setEditOrgCustomPositions(data?.map(p=>p.position_name)||[]) }).catch(()=>{})
  },[showInvite])

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
    } else {
      // Fallback: query profiles directly by org name (handles name-mismatch in org_members)
      const { data: fallback } = await supabase.from('profiles').select('*').eq('org', orgName)
      setOrgMembers(fallback?.length ? fallback : [])
    }
    setLoadingMembers(false)
  }

  const saveMemberEdit = async () => {
    if (!memberEditForm.name?.trim()) return
    const newOrg = memberEditForm.org || editingMember.org
    const orgChanged = newOrg !== editingMember.org
    const updates = { name:memberEditForm.name.trim(), role:memberEditForm.role, department:memberEditForm.department||'', industry:memberEditForm.industry||'', phone:memberEditForm.phone||'', notes:memberEditForm.notes||'', email:memberEditForm.email||'', org:newOrg }
    if (isConfigured()) {
      await supabase.from('profiles').update(updates).eq('id', editingMember.id)
      if (orgChanged) {
        await supabase.from('org_members').delete().eq('user_id', editingMember.id).eq('org', editingMember.org)
        await supabase.from('org_members').insert({ user_id: editingMember.id, org: newOrg, role: memberEditForm.role })
      } else {
        await supabase.from('org_members').update({ role: memberEditForm.role }).eq('user_id', editingMember.id).eq('org', editingMember.org)
      }
      // user_positions table removed — position edits not persisted
    }
    if (orgChanged) {
      setOrgMembers(prev=>prev.filter(m=>m.id!==editingMember.id))
    } else {
      setOrgMembers(prev=>prev.map(m=>m.id===editingMember.id?{...m,...updates}:m))
    }
    setViewingMember(null)
    setEditingMember(null); setMemberEditForm({}); setOrgChangeSearch('')
    setEditMemberPositions([]); setEditOrgIndustries([]); setEditOrgCustomRoles([]); setEditOrgCustomPositions([])
  }

  const loadAllProfiles = async () => {
    setLoadingProfiles(true)
    const { data } = await supabase.from('profiles').select('id,name,email,role,org').order('name')
    if (data) setAllProfiles(data)
    setLoadingProfiles(false)
  }

  const openEditMember = async (member) => {
    setEditingMember(member)
    setMemberEditForm({name:member.name,role:member.role,department:member.department||'',industry:member.industry||'',phone:member.phone||'',notes:member.notes||'',email:member.email||'',org:member.org||''})
    setEditMemberPositions([])
    setEditMemberNewPos({industry:'',role:'',position:''})
    setEditOrgIndustries([])
    setEditOrgCustomRoles([])
    setEditOrgCustomPositions([])
    if(!isConfigured()) return
    // Load org ID for this member's org
    const orgName = member.org || selectedOrgView?.name
    if(!orgName) return
    const {data:orgRow} = await supabase.from('organisations').select('id').eq('name',orgName).maybeSingle()
    const orgId = orgRow?.id
    const [gi,oi,cr,cp,up] = await Promise.all([
      supabase.from('global_industries').select('name').order('name'),
      orgId ? supabase.from('org_industries').select('name').eq('organisation_id',orgId) : Promise.resolve({data:[]}),
      orgId ? supabase.from('org_custom_roles').select('industry_name,role_name').eq('organisation_id',orgId).order('sort_order',{nullsFirst:false}).order('role_name') : Promise.resolve({data:[]}),
      orgId ? supabase.from('org_custom_positions').select('position_name').eq('organisation_id',orgId).order('sort_order',{nullsFirst:false}).order('position_name') : Promise.resolve({data:[]}),
      Promise.resolve({data:[]})
    ])
    const globalNames = gi.data?.map(i=>i.name)||[]
    const orgNames = oi.data?.map(i=>i.name)||[]
    const baseInds = globalNames.length ? globalNames : PRESET_INDUSTRIES
    setEditOrgIndustries([...baseInds,...orgNames.filter(n=>!baseInds.includes(n))])
    setEditOrgCustomRoles(cr.data||[])
    setEditOrgCustomPositions(cp.data?.map(p=>p.position_name)||[])
    setEditMemberPositions(up.data?.map(p=>({...p}))||[])
  }

  const enterOrgContext = async (org) => {
    setSelectedOrgView(org)
    setOrgContextTab('members')
    setOrgContextSLA(null); setOrgContextTickets([]); setOrgContextAudit([])
    setViewingMember(null); setEditingMember(null); setShowAddMember(false)
    setAddMemberSearch(''); setAddMemberSelectedId(null); setAddMemberMsg('')
    loadOrgMembers(org.name)
    if (!isConfigured()) return
    supabase.from('organisations').select('sla_settings').eq('name', org.name).maybeSingle()
      .then(({data}) => { if(data?.sla_settings) try { setOrgContextSLA(JSON.parse(data.sla_settings)) } catch(e) {} }).catch(()=>{})
    supabase.from('support_tickets').select('*').eq('org', org.name).order('created_at',{ascending:false})
      .then(({data}) => { if(data) setOrgContextTickets(data) }).catch(()=>{})
    supabase.from('audit_log').select('*').eq('org', org.name).order('at',{ascending:false}).limit(200)
      .then(({data}) => { if(data) setOrgContextAudit(data) }).catch(()=>{})
  }

  const addMemberToOrg = async () => {
    if (!addMemberSelectedId) { setAddMemberMsg('Please select a user'); return }
    if (!selectedOrgView) return
    setLoading(true); setAddMemberMsg('')
    try {
      const { error } = await supabase.from('org_members').upsert(
        { user_id: addMemberSelectedId, org: selectedOrgView.name, role: addMemberRole },
        { onConflict: 'user_id,org' }
      )
      if (error) throw new Error(error.message)
      await supabase.from('profiles').update({ org: selectedOrgView.name, role: addMemberRole }).eq('id', addMemberSelectedId)
      const added = allProfiles.find(p => p.id === addMemberSelectedId)
      setOrgMembers(prev => [...prev, { ...(added||{}), id: addMemberSelectedId, role: addMemberRole, org: selectedOrgView.name }])
      setAddMemberMsg('✅ ' + (added?.name || 'User') + ' added to ' + selectedOrgView.name)
      setAddMemberSelectedId(null); setAddMemberSearch('')
    } catch(e) { setAddMemberMsg('Error: ' + e.message) }
    setLoading(false)
  }

  const changeViewingMemberOrg = async (newOrgName) => {
    if (!viewingMember || newOrgName === viewingMember.org) return
    setLoading(true)
    try {
      await supabase.from('org_members').delete().eq('user_id', viewingMember.id).eq('org', viewingMember.org)
      await supabase.from('org_members').insert({ user_id: viewingMember.id, org: newOrgName, role: viewingMember.role })
      await supabase.from('profiles').update({ org: newOrgName }).eq('id', viewingMember.id)
      setOrgMembers(prev => prev.filter(m => m.id !== viewingMember.id))
      setViewingMember(null); setShowMemberOrgChange(false); setMemberOrgSearch('')
    } catch(e) { alert('Error: ' + e.message) }
    setLoading(false)
  }

  const removeMemberFromOrg = async (m) => {
    if (!confirm('Remove '+m.name+' from '+selectedOrgView?.name+'?\n\nTheir Taksyn profile is preserved — only their org membership is removed.')) return
    if (isConfigured()) {
      await supabase.from('org_members').delete().eq('user_id', m.id).eq('org', selectedOrgView.name)
    }
    setOrgMembers(prev => prev.filter(mem => mem.id !== m.id))
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
      setOrgs(prev=>prev.map(o=>o.id===orgId?{...o,logo:logoData}:o))
    }
    r.readAsDataURL(file)
  }

  const  sendInviteToOrg= async () => {
    if (!inviteEmail.trim()||!inviteName.trim()) { alert('Please enter name and email'); return }
    if (!showInvite) return
    setLoading(true)
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || supabase.supabaseUrl
      const inviteSecret = import.meta.env.VITE_INVITE_SECRET || ''
      const validPos = inviteOrgPositions.filter(p=>p.role||p.industry||p.position)
      const rolesSummary = validPos.map(p=>[p.industry,p.role,p.position].filter(Boolean).join(' / ')).join('; ')
      const res = await fetch(supabaseUrl+'/functions/v1/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email:inviteEmail.trim(), name:inviteName.trim(), role:'client_admin', org:showInvite.name, positions:rolesSummary, secret:inviteSecret })
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error||result.message||'Invite failed ('+res.status+')')
      // Update org user count
      await supabase.from('organisations').update({admin_email:inviteEmail.trim(),admin_name:inviteName.trim()}).eq('id',showInvite.id)
      setOrgs(prev=>prev.map(o=>o.id===showInvite.id?{...o,admin_email:inviteEmail.trim(),admin_name:inviteName.trim()}:o))
      alert('Invite sent to '+inviteEmail+'!'+(rolesSummary?'\n\nAssignments: '+rolesSummary:''))
      setShowInvite(null); setInviteEmail(''); setInviteName(''); setInviteOrgPositions([{industry:'',role:'',position:''}])
    } catch(e) {
      alert('Failed: '+e.message)
    }
    setLoading(false)
  }

  const addExistingUserToOrg = async () => {
    if (!existingUserSearch.trim()) { setExistingUserMsg('Please enter an email address'); return }
    if (!showInvite) return
    setLoading(true)
    setExistingUserMsg('')
    try {
      const { data: profile, error } = await supabase.from('profiles').select('*').eq('email', existingUserSearch.trim().toLowerCase()).single()
      if (error || !profile) { setExistingUserMsg('No user found with that email address'); setLoading(false); return }
      const { error: memberError } = await supabase.from('org_members').upsert({ user_id: profile.id, org: showInvite.name, role: existingUserRole }, { onConflict: 'user_id,org' })
      if (memberError) throw new Error(memberError.message)
      await supabase.from('profiles').update({ org: showInvite.name, role: existingUserRole }).eq('id', profile.id)
      setExistingUserMsg('✅ ' + (profile.name || existingUserSearch) + ' added to ' + showInvite.name)
      setExistingUserSearch('')
    } catch(e) {
      setExistingUserMsg('Error: ' + e.message)
    }
    setLoading(false)
  }

  const filtered = orgs.filter(o=>!search||o.name.toLowerCase().includes(search.toLowerCase())||o.industry?.toLowerCase().includes(search.toLowerCase()))

  if (selectedOrgView) {
    const contextUser = {...user, org: selectedOrgView.name}
    return (
      <div className="anim">
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16,paddingBottom:12,borderBottom:'1px solid var(--border)',flexWrap:'wrap'}}>
          <button className="btn btn-secondary btn-sm" onClick={()=>{setSelectedOrgView(null);setViewingMember(null);setEditingMember(null);setShowAddMember(false);setAddMemberSearch('');setAddMemberSelectedId(null);setAddMemberMsg('')}}>
            ← Back to all organisations
          </button>
          <div style={{display:'flex',alignItems:'center',gap:10,flex:1,minWidth:0}}>
            {selectedOrgView.logo&&<img src={selectedOrgView.logo} alt={selectedOrgView.name} style={{height:28,objectFit:'contain',borderRadius:4,border:'1px solid var(--border)',flexShrink:0}}/>}
            <div style={{minWidth:0}}>
              <div style={{fontWeight:800,fontSize:16,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{selectedOrgView.name}</div>
              <div style={{fontSize:11,color:'var(--t2)'}}>{selectedOrgView.industry||'—'} · <span style={{color:TIERS[selectedOrgView.tier]?.color||'var(--t2)',fontWeight:600}}>{selectedOrgView.tier}</span></div>
            </div>
          </div>
        </div>
        <div style={{display:'flex',gap:2,background:'var(--s3)',borderRadius:8,padding:3,marginBottom:16,flexWrap:'wrap'}}>
          {[['members','👥 Members'],['teams','🏷 Teams'],['settings','⚙️ Settings'],['sla','⏱ Response Time'],['audit','📋 Audit Log'],['support','🎫 Support']].map(([k,l])=>(
            <button key={k} onClick={()=>setOrgContextTab(k)} style={{flex:'1 1 auto',padding:'6px 8px',borderRadius:6,border:'none',background:orgContextTab===k?'#fff':'transparent',color:orgContextTab===k?'var(--text)':'var(--t2)',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',boxShadow:orgContextTab===k?'0 1px 4px rgba(0,0,0,.1)':'none',whiteSpace:'nowrap'}}>{l}</button>
          ))}
        </div>
        {orgContextTab==='members'&&(
          <div>
            {(()=>{
              const filled = COMPANY_COMPLETENESS_FIELDS.filter(f=>selectedOrgView[f.key]&&String(selectedOrgView[f.key]).trim())
              const missing = COMPANY_COMPLETENESS_FIELDS.filter(f=>!selectedOrgView[f.key]||!String(selectedOrgView[f.key]).trim())
              const pct = Math.round((filled.length/COMPANY_COMPLETENESS_FIELDS.length)*100)
              const color = pct===100?'var(--green)':pct>=60?'var(--amber)':'var(--red)'
              return (
                <div className="section" style={{marginBottom:14}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                    <div style={{fontSize:12,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.6px'}}>Profile Completeness</div>
                    <div style={{fontSize:18,fontWeight:800,color}}>{pct}%</div>
                  </div>
                  <div style={{height:6,background:'var(--s3)',borderRadius:4,overflow:'hidden',marginBottom:8}}>
                    <div style={{height:'100%',width:pct+'%',background:color,borderRadius:4,transition:'width .3s'}}/>
                  </div>
                  <div style={{fontSize:11,color:'var(--t2)',marginBottom:missing.length?6:0}}>{filled.length} of {COMPANY_COMPLETENESS_FIELDS.length} fields completed</div>
                  {missing.length>0&&(
                    <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                      {missing.map(f=><span key={f.key} style={{fontSize:10,padding:'2px 7px',borderRadius:4,background:'rgba(239,68,68,.08)',color:'var(--red)',border:'1px solid rgba(239,68,68,.15)',fontWeight:500}}>{f.label}</span>)}
                    </div>
                  )}
                </div>
              )
            })()}
            <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
              <button className="btn btn-primary btn-sm" onClick={()=>{setShowAddMember(v=>!v);setAddMemberMsg('');setAddMemberSelectedId(null);setAddMemberSearch('');if(!allProfiles.length)loadAllProfiles()}}>
                {showAddMember?'✕ Cancel':'+ Add Member'}
              </button>
            </div>
            {showAddMember&&(
              <div className="section" style={{marginBottom:14}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>Add member to {selectedOrgView.name}</div>
                <input className="form-input" placeholder="Search by name or email..." value={addMemberSearch} onChange={e=>setAddMemberSearch(e.target.value)} style={{fontSize:13,marginBottom:6}}/>
                {loadingProfiles?(
                  <div style={{textAlign:'center',padding:12,color:'var(--t2)',fontSize:13}}>Loading users...</div>
                ):(
                  <div style={{maxHeight:200,overflowY:'auto',border:'1px solid var(--border)',borderRadius:6}}>
                    {allProfiles.filter(p=>!orgMembers.some(m=>m.id===p.id)).filter(p=>!addMemberSearch||p.name?.toLowerCase().includes(addMemberSearch.toLowerCase())||p.email?.toLowerCase().includes(addMemberSearch.toLowerCase())).map(p=>(
                      <div key={p.id} onClick={()=>setAddMemberSelectedId(p.id===addMemberSelectedId?null:p.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',cursor:'pointer',background:p.id===addMemberSelectedId?'var(--brand-lt)':'transparent',borderBottom:'1px solid var(--border)'}}>
                        <div style={{flex:1}}>
                          <div style={{fontWeight:600,fontSize:13,color:p.id===addMemberSelectedId?'var(--brand)':'inherit'}}>{p.name||'—'}</div>
                          <div style={{fontSize:11,color:'var(--t2)'}}>{p.email||'—'}{p.org&&<span> · {p.org}</span>}</div>
                        </div>
                        {p.id===addMemberSelectedId&&<span style={{fontSize:11,color:'var(--brand)',fontWeight:700}}>✓</span>}
                      </div>
                    ))}
                    {allProfiles.filter(p=>!orgMembers.some(m=>m.id===p.id)).length===0&&(
                      <div style={{padding:16,textAlign:'center',color:'var(--t2)',fontSize:13}}>All users are already members of this org</div>
                    )}
                  </div>
                )}
                {addMemberSelectedId&&(
                  <div style={{display:'flex',gap:8,alignItems:'center',marginTop:8,flexWrap:'wrap'}}>
                    <select className="form-input" value={addMemberRole} onChange={e=>setAddMemberRole(e.target.value)} style={{flex:1,fontSize:13,padding:'6px 10px'}}>
                      {ROLES.filter(r=>r!=='super_admin').map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                    <button className="btn btn-primary" onClick={addMemberToOrg} disabled={loading}>{loading?'Adding...':'Add to Org'}</button>
                  </div>
                )}
                {addMemberMsg&&(
                  <div style={{marginTop:8,fontSize:13,padding:'6px 10px',borderRadius:6,background:addMemberMsg.startsWith('✅')?'rgba(16,185,129,.12)':'rgba(239,68,68,.12)',color:addMemberMsg.startsWith('✅')?'var(--green)':'#EF4444'}}>{addMemberMsg}</div>
                )}
              </div>
            )}
            {loadingMembers?<div style={{textAlign:'center',padding:20,color:'var(--t2)'}}>Loading members...</div>:
            orgMembers.length===0?<div className="empty"><div className="empty-icon">👥</div><div className="empty-text">No members yet</div></div>:
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
                        {m.industry&&<div style={{fontSize:10,color:'var(--t2)',marginTop:1}}>🏭 {m.industry}</div>}
                      </div>
                      <RolePill role={m.role}/>
                      <button className="btn btn-secondary btn-sm" onClick={e=>{e.stopPropagation();setEditingMember(m);setMemberEditForm({name:m.name,role:m.role,department:m.department||'',industry:m.industry||'',phone:m.phone||'',notes:m.notes||'',email:m.email||'',org:m.org||''})}}>✏️ Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={e=>{e.stopPropagation();removeMemberFromOrg(m)}}>Remove</button>
                    </div>
                  ))}
                </div>
              ))}
            </div>}
          </div>
        )}
        {orgContextTab==='teams'&&<TeamsView user={contextUser}/>}
        {orgContextTab==='settings'&&<CompanySettingsView user={contextUser}/>}
        {orgContextTab==='sla'&&<SLASettingsView user={contextUser} orgSLA={orgContextSLA} setOrgSLA={setOrgContextSLA} tasks={[]} setTasks={()=>{}} loadTasks={()=>{}}/>}
        {orgContextTab==='audit'&&<AuditLogView user={contextUser} tasks={[]} auditLog={orgContextAudit} setAuditLog={setOrgContextAudit}/>}
        {orgContextTab==='support'&&<SupportView user={contextUser} tickets={orgContextTickets} setTickets={setOrgContextTickets}/>}
        {viewingMember&&(
          <div className="modal-overlay" onClick={()=>{setViewingMember(null);setShowMemberOrgChange(false);setMemberOrgSearch('')}}>
            <div className="modal" onClick={e=>e.stopPropagation()}>
              <div className="modal-hdr"><div className="modal-title">👤 Member Profile</div><button className="modal-close" onClick={()=>{setViewingMember(null);setShowMemberOrgChange(false);setMemberOrgSearch('')}}>×</button></div>
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
                  {[['Organisation',viewingMember.org],['Industry',viewingMember.industry],['Phone',viewingMember.phone]].map(([l,v])=>v?(
                    <div key={l} style={{background:'var(--s3)',borderRadius:8,padding:'8px 12px'}}>
                      <div style={{fontSize:10,color:'var(--t2)',fontWeight:600,textTransform:'uppercase',letterSpacing:'.6px',marginBottom:2}}>{l}</div>
                      <div style={{fontSize:13,fontWeight:600}}>{v}</div>
                    </div>
                  ):null)}
                </div>
                {viewingMember.notes&&<div style={{marginTop:10,background:'var(--s3)',borderRadius:8,padding:'8px 12px',fontSize:13,color:'var(--t2)',fontStyle:'italic'}}>{viewingMember.notes}</div>}
                <div style={{marginTop:14,borderTop:'1px solid var(--border)',paddingTop:12}}>
                  <button className="btn btn-secondary btn-sm" onClick={()=>{setShowMemberOrgChange(v=>!v);setMemberOrgSearch('')}}>
                    {showMemberOrgChange?'✕ Cancel':'🔄 Change Organisation'}
                  </button>
                  {showMemberOrgChange&&(
                    <div style={{marginTop:10}}>
                      <input className="form-input" placeholder="Filter organisations..." value={memberOrgSearch} onChange={e=>setMemberOrgSearch(e.target.value)} style={{fontSize:13,marginBottom:6}}/>
                      <div style={{maxHeight:180,overflowY:'auto',border:'1px solid var(--border)',borderRadius:6}}>
                        {[...orgs].sort((a,b)=>a.name.localeCompare(b.name)).filter(o=>!memberOrgSearch||o.name.toLowerCase().includes(memberOrgSearch.toLowerCase())).map(o=>(
                          <div key={o.id} onClick={()=>changeViewingMemberOrg(o.name)} style={{padding:'8px 12px',cursor:'pointer',fontSize:13,fontWeight:o.name===viewingMember.org?700:400,color:o.name===viewingMember.org?'var(--t2)':'inherit',background:o.name===viewingMember.org?'var(--s3)':'transparent',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                            {o.name}
                            {o.name===viewingMember.org&&<span style={{fontSize:11,color:'var(--t2)'}}>current</span>}
                          </div>
                        ))}
                      </div>
                      {loading&&<div style={{fontSize:12,color:'var(--t2)',marginTop:4}}>Moving...</div>}
                    </div>
                  )}
                </div>
                <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                  <button className="btn btn-secondary" onClick={()=>{setViewingMember(null);setShowMemberOrgChange(false);setMemberOrgSearch('')}}>Close</button>
                  <button className="btn btn-primary" onClick={()=>openEditMember(viewingMember)}>✏️ Edit Profile</button>
                </div>
              </div>
            </div>
          </div>
        )}
        {editingMember&&(()=>{
          const closeEdit = () => { setEditingMember(null); setOrgChangeSearch(''); setEditMemberPositions([]); setEditOrgIndustries([]); setEditOrgCustomRoles([]); setEditOrgCustomPositions([]) }
          const industryList = editOrgIndustries.length ? editOrgIndustries : PRESET_INDUSTRIES
          const DEFAULT_POSITIONS = ['Manager','Supervisor','Staff Member']
          const allPositions = [...DEFAULT_POSITIONS,...editOrgCustomPositions.filter(p=>!DEFAULT_POSITIONS.includes(p))]
          const rolesForInd = (ind) => ind ? editOrgCustomRoles.filter(r=>r.industry_name===ind).map(r=>r.role_name) : []
          return (
          <div className="modal-overlay" onClick={closeEdit}>
            <div className="modal" onClick={e=>e.stopPropagation()}>
              <div className="modal-hdr"><div className="modal-title">✏️ Edit Member</div><button className="modal-close" onClick={closeEdit}>×</button></div>
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
                <div className="form-field"><label className="form-label">System Role</label>
                  <select className="form-input" value={memberEditForm.role||'worker'} onChange={e=>setMemberEditForm({...memberEditForm,role:e.target.value})}>
                    {ROLES.filter(r=>r!=='super_admin').map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </div>
                <div className="form-field"><label className="form-label">Industry</label>
                  <select className="form-input" value={memberEditForm.industry||''} onChange={e=>setMemberEditForm({...memberEditForm,industry:e.target.value})}>
                    <option value="">— Select —</option>
                    {industryList.map(k=><option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                <div className="form-field"><label className="form-label">Organisation</label>
                  <input className="form-input" placeholder="Filter organisations..." value={orgChangeSearch} onChange={e=>setOrgChangeSearch(e.target.value)} style={{fontSize:13,marginBottom:4}}/>
                  <select className="form-input" value={memberEditForm.org||editingMember?.org||''} onChange={e=>setMemberEditForm({...memberEditForm,org:e.target.value})} size={4} style={{fontSize:13,height:'auto'}}>
                    {[...orgs].sort((a,b)=>a.name.localeCompare(b.name)).filter(o=>!orgChangeSearch||o.name.toLowerCase().includes(orgChangeSearch.toLowerCase())).map(o=><option key={o.id} value={o.name}>{o.name}</option>)}
                  </select>
                  {memberEditForm.org&&memberEditForm.org!==editingMember?.org&&(
                    <div style={{fontSize:11,color:'#F59E0B',marginTop:3}}>⚠️ Moving from <strong>{editingMember?.org}</strong> to <strong>{memberEditForm.org}</strong></div>
                  )}
                </div>
                <div className="form-field" style={{borderTop:'1px solid var(--border)',paddingTop:12,marginTop:4}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                    <label className="form-label" style={{margin:0}}>Positions</label>
                    <span style={{fontSize:10,color:'var(--t2)'}}>Multiple roles across industries</span>
                  </div>
                  {editMemberPositions.map((pos,i)=>{
                    const posRoles = rolesForInd(pos.department||pos.industry||'')
                    return (
                      <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto',gap:4,marginBottom:6,alignItems:'center'}}>
                        <select className="form-select" style={{fontSize:12}} value={pos.department||pos.industry||''} onChange={e=>setEditMemberPositions(prev=>prev.map((p,j)=>j===i?{...p,department:e.target.value,industry:e.target.value,role:'worker'}:p))}>
                          <option value="">— Industry —</option>
                          {industryList.map(d=><option key={d} value={d}>{d}</option>)}
                        </select>
                        {posRoles.length>0
                          ? <select className="form-select" style={{fontSize:12}} value={pos.position_title||pos.role_name||''} onChange={e=>setEditMemberPositions(prev=>prev.map((p,j)=>j===i?{...p,position_title:e.target.value}:p))}>
                              <option value="">— Role —</option>
                              {posRoles.map(r=><option key={r} value={r}>{r}</option>)}
                            </select>
                          : <input className="form-input" style={{fontSize:12}} placeholder="Role…" value={pos.position_title||''} onChange={e=>setEditMemberPositions(prev=>prev.map((p,j)=>j===i?{...p,position_title:e.target.value}:p))}/>
                        }
                        <select className="form-select" style={{fontSize:12}} value={pos.role||'worker'} onChange={e=>setEditMemberPositions(prev=>prev.map((p,j)=>j===i?{...p,role:e.target.value}:p))}>
                          {allPositions.map(p=><option key={p} value={p==='Manager'?'manager':p==='Supervisor'?'supervisor':'worker'}>{p}</option>)}
                        </select>
                        <button style={{padding:'4px 8px',borderRadius:6,border:'1px solid var(--border)',background:'transparent',color:'var(--red)',cursor:'pointer',fontSize:13,lineHeight:1}} onClick={()=>setEditMemberPositions(prev=>prev.filter((_,j)=>j!==i))}>×</button>
                      </div>
                    )
                  })}
                  <div style={{background:'var(--s3)',borderRadius:8,padding:10,marginTop:6}}>
                    <div style={{fontSize:11,fontWeight:600,color:'var(--t2)',marginBottom:8}}>Add Position</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto',gap:4,alignItems:'center'}}>
                      <select className="form-select" style={{fontSize:12}} value={editMemberNewPos.industry} onChange={e=>setEditMemberNewPos(p=>({...p,industry:e.target.value,role:''}))}>
                        <option value="">— Industry —</option>
                        {industryList.map(d=><option key={d} value={d}>{d}</option>)}
                      </select>
                      {rolesForInd(editMemberNewPos.industry).length>0
                        ? <select className="form-select" style={{fontSize:12}} value={editMemberNewPos.role} onChange={e=>setEditMemberNewPos(p=>({...p,role:e.target.value}))}>
                            <option value="">— Role —</option>
                            {rolesForInd(editMemberNewPos.industry).map(r=><option key={r} value={r}>{r}</option>)}
                          </select>
                        : <input className="form-input" style={{fontSize:12}} placeholder="Role…" value={editMemberNewPos.role} onChange={e=>setEditMemberNewPos(p=>({...p,role:e.target.value}))}/>
                      }
                      <select className="form-select" style={{fontSize:12}} value={editMemberNewPos.position} onChange={e=>setEditMemberNewPos(p=>({...p,position:e.target.value}))}>
                        <option value="">— Position —</option>
                        {allPositions.map(p=><option key={p} value={p==='Manager'?'manager':p==='Supervisor'?'supervisor':'worker'}>{p}</option>)}
                      </select>
                      <button className="btn btn-secondary btn-sm" disabled={!editMemberNewPos.industry} onClick={()=>{ if(!editMemberNewPos.industry) return; setEditMemberPositions(prev=>[...prev,{department:editMemberNewPos.industry,industry:editMemberNewPos.industry,role:editMemberNewPos.position||'worker',position_title:editMemberNewPos.role,is_primary:prev.length===0}]); setEditMemberNewPos({industry:'',role:'',position:''}) }}>+ Add</button>
                    </div>
                  </div>
                </div>
                <div className="form-field"><label className="form-label">Notes</label>
                  <textarea className="comment-box" style={{minHeight:60}} value={memberEditForm.notes||''} onChange={e=>setMemberEditForm({...memberEditForm,notes:e.target.value})} placeholder="Notes about this member..."/>
                </div>
                <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
                  <button className="btn btn-secondary" onClick={closeEdit}>Cancel</button>
                  <button className="btn btn-primary" disabled={!memberEditForm.name?.trim()} onClick={saveMemberEdit}>Save Changes</button>
                </div>
              </div>
            </div>
          </div>
          )
        })()}
      </div>
    )
  }

  return (
    <div className="anim">
      <div className="ph" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
        <div>
          <div className="ph-title">Organisations</div>
          <div className="ph-sub">{orgs.length} organisations · {orgs.filter(o=>o.status==='active').length} active</div>
        </div>
        <button className="btn btn-primary" style={{flexShrink:0}} onClick={()=>setShowCreate(true)}>+ New Organisation</button>
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
        <div className="org-grid">
          {filtered.map(org=>(
            <div key={org.id} style={{background:'var(--s2)',border:'1px solid var(--border)',borderRadius:10,padding:'12px 14px',borderLeft:'4px solid '+(org.status==='active'?'var(--green)':'var(--border)')}}>
              {/* Name + chips row */}
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:5}}>
                {org.logo&&<img src={org.logo} alt={org.name} style={{height:28,width:'auto',maxWidth:80,objectFit:'contain',borderRadius:4,border:'1px solid var(--border)',flexShrink:0}}/>}
                <span style={{fontWeight:700,fontSize:14,cursor:'pointer',color:'var(--brand)',textDecoration:'underline',flex:'1 1 120px',minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} onClick={()=>enterOrgContext(org)}>{org.name}</span>
                <span style={{fontSize:10,padding:'2px 7px',borderRadius:10,fontWeight:600,flexShrink:0,background:org.status==='active'?'rgba(16,185,129,.12)':'var(--s3)',color:org.status==='active'?'var(--green)':'var(--t2)'}}>{org.status?.toUpperCase()}</span>
                <span style={{fontSize:10,padding:'2px 7px',borderRadius:10,background:'var(--s3)',color:TIERS[org.tier]?.color||'var(--t2)',fontWeight:600,flexShrink:0}}>{org.tier}</span>
              </div>
              {/* Metadata row */}
              <div style={{fontSize:11,color:'var(--t2)',display:'flex',gap:10,flexWrap:'wrap',marginBottom:10}}>
                <span>🏭 {org.industry||'—'}</span>
                {org.admin_name&&<span>👤 {org.admin_name}</span>}
                {org.admin_email&&<span style={{overflow:'hidden',textOverflow:'ellipsis',maxWidth:180}}>✉️ {org.admin_email}</span>}
                <span>📅 {new Date(org.created_at).toLocaleDateString('en-AU')}</span>
              </div>
              {org.notes&&<div style={{fontSize:11,color:'var(--t2)',marginBottom:8,fontStyle:'italic'}}>{org.notes}</div>}
              {/* Action buttons — wrap on narrow screens */}
              <div className="org-actions">
                <button className="btn btn-secondary btn-sm" onClick={()=>enterOrgContext(org)}>👥 View & Manage</button>
                <button className="btn btn-primary btn-sm" onClick={()=>{ setShowInvite(org); setInviteEmail(''); setInviteName('') }}>✉️ Invite Admin</button>
                <label style={{display:'flex',alignItems:'center',gap:5,padding:'5px 10px',borderRadius:6,fontSize:12,fontWeight:600,cursor:'pointer',border:'1px dashed '+(dragOver===org.id?'var(--brand)':'var(--border)'),background:dragOver===org.id?'var(--brand-lt)':'transparent',color:dragOver===org.id?'var(--brand)':'var(--t2)'}}
                  onDragOver={e=>{ e.preventDefault(); setDragOver(org.id) }}
                  onDragLeave={()=>setDragOver(null)}
                  onDrop={e=>{ e.preventDefault(); setDragOver(null); const f=e.dataTransfer.files[0]; if(f&&f.type.startsWith('image/')) uploadOrgLogo(org.id,f) }}>
                  🖼 {org.logo?'Update Logo':'Add Logo'}
                  <input type="file" accept="image/*" style={{display:'none'}} onChange={e=>{ const f=e.target.files[0]; if(f) uploadOrgLogo(org.id,f); e.target.value='' }}/>
                </label>
                <button className="btn btn-secondary btn-sm" style={{color:org.status==='active'?'var(--red)':'var(--green)'}} onClick={()=>toggleStatus(org)}>
                  {org.status==='active'?'Deactivate':'Reactivate'}
                </button>
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
  <div className="modal-overlay" onClick={()=>{ setShowInvite(null); setInviteOrgPositions([{industry:'',role:'',position:''}]) }}>
    <div className="modal" onClick={e=>e.stopPropagation()}>
      <div className="modal-hdr">
        <div className="modal-title">Add to Organisation</div>
        <button className="modal-close" onClick={()=>{ setShowInvite(null); setInviteOrgPositions([{industry:'',role:'',position:''}]) }}>×</button>
      </div>
      <div className="modal-body">
        <div style={{background:'var(--s3)',borderRadius:8,padding:'10px 14px',marginBottom:14,fontSize:13}}>
          <span style={{color:'var(--t2)'}}>Organisation: </span>
          <strong>{showInvite.name}</strong>
        </div>
        <div className="tabs" style={{marginBottom:14}}>
          <button className={'tab '+(inviteTab==='invite'?'active':'')} onClick={()=>setInviteTab('invite')}>✉️ Invite New User</button>
          <button className={'tab '+(inviteTab==='existing'?'active':'')} onClick={()=>setInviteTab('existing')}>👤 Add Existing User</button>
        </div>

        {inviteTab==='invite' && (
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <input className="form-input" placeholder="Full Name *" value={inviteName} onChange={e=>setInviteName(e.target.value)} style={{fontSize:13}}/>
            <input className="form-input" type="email" placeholder="Email Address *" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} style={{fontSize:13}}/>
            <div style={{borderTop:'1px solid var(--border)',paddingTop:10}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.6px'}}>Position Assignments</div>
                <span style={{fontSize:10,color:'var(--t2)'}}>Industry · Role · Position</span>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto',gap:4,marginBottom:4,padding:'0 2px'}}>
                {['Industry','Role','Position',''].map((h,i)=><div key={i} style={{fontSize:9,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.5px'}}>{h}</div>)}
              </div>
              {inviteOrgPositions.map((row,i)=>{
                const rolesForInd = row.industry ? editOrgCustomRoles.filter(r=>r.industry_name===row.industry).map(r=>r.role_name) : []
                const defaultPos = ['Staff Member','Supervisor','Manager','Client Admin']
                const allPos = [...defaultPos,...editOrgCustomPositions.filter(p=>!defaultPos.includes(p))]
                return (
                  <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto',gap:4,marginBottom:6,alignItems:'center'}}>
                    <select className="form-select" style={{fontSize:11}} value={row.industry} onChange={e=>setInviteOrgPositions(prev=>prev.map((p,j)=>j===i?{...p,industry:e.target.value,role:''}:p))}>
                      <option value="">— Industry —</option>
                      {(editOrgIndustries.length?editOrgIndustries:PRESET_INDUSTRIES).map(k=><option key={k} value={k}>{k}</option>)}
                    </select>
                    {rolesForInd.length>0 ? (
                      <select className="form-select" style={{fontSize:11}} value={row.role} onChange={e=>setInviteOrgPositions(prev=>prev.map((p,j)=>j===i?{...p,role:e.target.value}:p))}>
                        <option value="">— Role —</option>
                        {rolesForInd.map(r=><option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (
                      <input className="form-input" style={{fontSize:11}} value={row.role} onChange={e=>setInviteOrgPositions(prev=>prev.map((p,j)=>j===i?{...p,role:e.target.value}:p))} placeholder="Role / title"/>
                    )}
                    <select className="form-select" style={{fontSize:11}} value={row.position} onChange={e=>setInviteOrgPositions(prev=>prev.map((p,j)=>j===i?{...p,position:e.target.value}:p))}>
                      <option value="">— Position —</option>
                      {allPos.map(p=><option key={p} value={p}>{p}</option>)}
                    </select>
                    <button style={{background:'none',border:'none',cursor:inviteOrgPositions.length>1?'pointer':'default',opacity:inviteOrgPositions.length>1?1:.3,color:'var(--red)',fontSize:16,padding:'0 4px',lineHeight:1}} onClick={()=>inviteOrgPositions.length>1&&setInviteOrgPositions(prev=>prev.filter((_,j)=>j!==i))}>×</button>
                  </div>
                )
              })}
              <button className="btn btn-secondary btn-sm" style={{fontSize:11}} onClick={()=>setInviteOrgPositions(prev=>[...prev,{industry:'',role:'',position:''}])}>+ Add another position</button>
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:6}}>
              <button className="btn btn-ghost" onClick={()=>{ setShowInvite(null); setInviteOrgPositions([{industry:'',role:'',position:''}]) }}>Cancel</button>
              <button className="btn btn-primary" onClick={sendInviteToOrg} disabled={loading}>{loading?'Sending...':'Send Invite'}</button>
            </div>
          </div>
        )}

        {inviteTab==='existing' && (
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <input
              className="form-input"
              type="email"
              placeholder="Search by email address..."
              value={existingUserSearch}
              onChange={e=>{setExistingUserSearch(e.target.value);setExistingUserMsg('')}}
              style={{fontSize:13}}
            />
            <select className="form-input" value={existingUserRole} onChange={e=>setExistingUserRole(e.target.value)} style={{fontSize:13,padding:'8px 10px'}}>
              <option value="client_admin">Client Admin</option>
              <option value="client_user">Client User</option>
              <option value="staff">Staff</option>
            </select>
            {existingUserMsg && (
              <div style={{fontSize:13,padding:'8px 12px',borderRadius:6,background:existingUserMsg.startsWith('✅')?'rgba(16,185,129,.12)':'rgba(239,68,68,.12)',color:existingUserMsg.startsWith('✅')?'var(--green)':'#EF4444',border:'1px solid '+(existingUserMsg.startsWith('✅')?'var(--green)':'#EF4444')+'44'}}>
                {existingUserMsg}
              </div>
            )}
            <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:6}}>
              <button className="btn btn-ghost" onClick={()=>setShowInvite(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={addExistingUserToOrg} disabled={loading}>{loading?'Adding...':'Add to Org'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  </div>
)}
    </div>
  )
}

function PlatformIndustriesView({ user }) {
  const [industries, setIndustries] = useState([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [editId, setEditId] = useState(null)
  const [editName, setEditName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(()=>{
    if(!isConfigured()) return
    setLoading(true)
    supabase.from('global_industries').select('*').order('name')
      .then(({data})=>{ if(data) setIndustries(data) }).catch(()=>{}).finally(()=>setLoading(false))
  },[])

  const addIndustry = async () => {
    const name = newName.trim()
    if(!name||!isConfigured()) return
    if(industries.find(i=>i.name.toLowerCase()===name.toLowerCase())) return
    setSaving(true)
    const {data,error} = await supabase.from('global_industries').insert({name,created_by:user.name,created_at:new Date().toISOString()}).select().single()
    if(!error&&data) { setIndustries(prev=>[...prev,data]); setNewName('') }
    setSaving(false)
  }

  const deleteIndustry = async (id) => {
    if(!window.confirm('Delete this industry? This cannot be undone.')) return
    await supabase.from('global_industries').delete().eq('id',id).catch(()=>{})
    setIndustries(prev=>prev.filter(i=>i.id!==id))
  }

  const saveEdit = async () => {
    const name = editName.trim()
    if(!name||!editId) return
    setSaving(true)
    await supabase.from('global_industries').update({name}).eq('id',editId).catch(()=>{})
    setIndustries(prev=>prev.map(i=>i.id===editId?{...i,name}:i))
    setEditId(null); setEditName('')
    setSaving(false)
  }

  const moveOrder = async (id, dir) => {
    const idx = industries.findIndex(i=>i.id===id)
    if(idx<0) return
    const swap = industries[idx+dir]
    if(!swap) return
    const a = industries[idx], b = swap
    setIndustries(prev=>{
      const next=[...prev]
      next[idx]=b; next[idx+dir]=a
      return next
    })
  }

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-title">Platform Industries</div>
        <div className="ph-sub">Global industry list available to all organisations as preset options</div>
      </div>
      <div className="section">
        <div style={{display:'flex',gap:8,marginBottom:16}}>
          <input className="form-input" style={{flex:1}} placeholder="New industry name…" value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addIndustry()}/>
          <button className="btn btn-primary" onClick={addIndustry} disabled={saving||!newName.trim()}>Add Industry</button>
        </div>
        {loading ? <div className="spinner" style={{margin:'20px auto'}}/> : industries.length===0 ? (
          <div style={{fontSize:13,color:'var(--t2)',padding:'12px 0'}}>No global industries yet — add the first one above.</div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {industries.map((ind,idx)=>(
              <div key={ind.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--s2)'}}>
                {editId===ind.id ? (
                  <>
                    <input className="form-input" style={{flex:1,fontSize:13}} value={editName} onChange={e=>setEditName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')saveEdit();if(e.key==='Escape'){setEditId(null);setEditName('')}}} autoFocus/>
                    <button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={saving}>Save</button>
                    <button className="btn btn-secondary btn-sm" onClick={()=>{setEditId(null);setEditName('')}}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span style={{fontSize:14}}>🏭</span>
                    <span style={{flex:1,fontSize:13,fontWeight:500}}>{ind.name}</span>
                    <div style={{display:'flex',gap:4}}>
                      <button style={{background:'none',border:'none',cursor:idx>0?'pointer':'default',opacity:idx>0?1:.3,fontSize:12,padding:'2px 5px'}} onClick={()=>moveOrder(ind.id,-1)} disabled={idx===0}>↑</button>
                      <button style={{background:'none',border:'none',cursor:idx<industries.length-1?'pointer':'default',opacity:idx<industries.length-1?1:.3,fontSize:12,padding:'2px 5px'}} onClick={()=>moveOrder(ind.id,1)} disabled={idx===industries.length-1}>↓</button>
                      <button className="btn btn-secondary btn-sm" style={{fontSize:11}} onClick={()=>{setEditId(ind.id);setEditName(ind.name)}}>Edit</button>
                      <button className="btn btn-danger btn-sm" style={{fontSize:11}} onClick={()=>deleteIndustry(ind.id)}>Delete</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RolesPositionsView({ user }) {
  const isSuper = user.role==='super_admin'
  const [activeTab, setActiveTab] = useState('roles')
  const [orgId, setOrgId] = useState(null)
  // Industries
  const [globalIndustryObjs, setGlobalIndustryObjs] = useState([]) // [{id,name}]
  const [orgIndustryObjs, setOrgIndustryObjs] = useState([])       // [{id,name,org,organisation_id}]
  const [selectedIndustry, setSelectedIndustry] = useState('')
  const [showAddInd, setShowAddInd] = useState(false)
  const [newIndName, setNewIndName] = useState('')
  const [editIndId, setEditIndId] = useState(null)
  const [editIndName, setEditIndName] = useState('')
  // Roles
  const [roles, setRoles] = useState([])
  const [newRoleName, setNewRoleName] = useState('')
  const [editRoleId, setEditRoleId] = useState(null)
  const [editRoleName, setEditRoleName] = useState('')
  // Positions
  const DEFAULT_POSITIONS = ['Manager','Supervisor','Staff Member']
  const [customPositions, setCustomPositions] = useState([])
  const [newPositionName, setNewPositionName] = useState('')
  const [editPosId, setEditPosId] = useState(null)
  const [editPosName, setEditPosName] = useState('')
  // Global industries (super admin tab)
  const [globalList, setGlobalList] = useState([])
  const [newGlobalName, setNewGlobalName] = useState('')
  const [editGlobalId, setEditGlobalId] = useState(null)
  const [editGlobalName, setEditGlobalName] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(()=>{
    if(!isConfigured()) return
    setLoading(true)
    const queries = [
      supabase.from('global_industries').select('*').order('name'),
    ]
    if(!isSuper && user.org) {
      queries.push(
        supabase.from('organisations').select('id').eq('name',user.org).maybeSingle()
      )
    }
    Promise.all(queries).then(([gi, orgRow])=>{
      if(gi.data) {
        setGlobalIndustryObjs(gi.data)
        if(isSuper) setGlobalList(gi.data)
      }
      if(orgRow?.data?.id) {
        const id = orgRow.data.id
        setOrgId(id)
        supabase.from('org_industries').select('*').eq('organisation_id',id)
          .then(({data})=>{ if(data) setOrgIndustryObjs(data) }).catch(()=>{})
      }
    }).catch(()=>{}).finally(()=>setLoading(false))
  },[user.org])

  useEffect(()=>{
    if(!isConfigured()||!orgId||!selectedIndustry) { setRoles([]); return }
    supabase.from('org_custom_roles').select('*').eq('organisation_id',orgId).eq('industry_name',selectedIndustry).order('sort_order',{nullsFirst:false}).order('role_name')
      .then(({data})=>{ setRoles(data||[]) }).catch(()=>setRoles([]))
  },[orgId,selectedIndustry])

  useEffect(()=>{
    if(!isConfigured()||!orgId) return
    supabase.from('org_custom_positions').select('*').eq('organisation_id',orgId).order('sort_order',{nullsFirst:false}).order('position_name')
      .then(({data})=>{ setCustomPositions(data||[]) }).catch(()=>{})
  },[orgId])

  // Global names: use DB data, fall back to PRESET_INDUSTRIES if table empty
  const globalNames = globalIndustryObjs.length ? globalIndustryObjs.map(i=>i.name) : PRESET_INDUSTRIES
  const orgCustomNames = orgIndustryObjs.map(i=>i.name)
  // Combined list for the left panel: global first, then org-only customs
  const allIndustriesForRoles = [...globalNames, ...orgCustomNames.filter(n=>!globalNames.includes(n))]

  // Industry CRUD (org-custom only)
  const addOrgIndustry = async () => {
    const name = newIndName.trim()
    if(!name||!user.org||!isConfigured()) return
    if(allIndustriesForRoles.find(n=>n.toLowerCase()===name.toLowerCase())) return
    setSaving(true)
    const row = {name, organisation_id:orgId||null, created_by:user.name, created_at:new Date().toISOString()}
    const {data,error} = await supabase.from('org_industries').insert(row).select().single()
    if(!error&&data){setOrgIndustryObjs(prev=>[...prev,data]);setNewIndName('');setShowAddInd(false)}
    setSaving(false)
  }
  const deleteOrgIndustry = async (id,name) => {
    if(!window.confirm(`Delete "${name}"? Roles assigned to this industry will be removed.`)) return
    await supabase.from('org_industries').delete().eq('id',id).catch(()=>{})
    await supabase.from('org_custom_roles').delete().eq('industry_name',name).eq('organisation_id',orgId).catch(()=>{})
    setOrgIndustryObjs(prev=>prev.filter(i=>i.id!==id))
    if(selectedIndustry===name) setSelectedIndustry('')
  }
  const saveIndEdit = async () => {
    const name = editIndName.trim()
    if(!name||!editIndId) return
    setSaving(true)
    await supabase.from('org_industries').update({name}).eq('id',editIndId).catch(()=>{})
    setOrgIndustryObjs(prev=>prev.map(i=>i.id===editIndId?{...i,name}:i))
    if(selectedIndustry===orgIndustryObjs.find(i=>i.id===editIndId)?.name) setSelectedIndustry(name)
    setEditIndId(null); setEditIndName(''); setSaving(false)
  }

  // Roles CRUD
  const addRole = async () => {
    const name = newRoleName.trim()
    if(!name||!orgId||!selectedIndustry||!isConfigured()) return
    if(roles.find(r=>r.role_name.toLowerCase()===name.toLowerCase())) return
    setSaving(true)
    const maxOrder = roles.reduce((m,r)=>Math.max(m,r.sort_order||0),0)
    const {data,error} = await supabase.from('org_custom_roles').insert({role_name:name,organisation_id:orgId,industry_name:selectedIndustry,sort_order:maxOrder+1}).select().single()
    if(!error&&data) { setRoles(prev=>[...prev,data]); setNewRoleName('') }
    setSaving(false)
  }
  const deleteRole = async (id) => {
    await supabase.from('org_custom_roles').delete().eq('id',id).catch(()=>{})
    setRoles(prev=>prev.filter(r=>r.id!==id))
  }
  const saveRoleEdit = async () => {
    const name = editRoleName.trim()
    if(!name||!editRoleId) return
    setSaving(true)
    await supabase.from('org_custom_roles').update({role_name:name}).eq('id',editRoleId).catch(()=>{})
    setRoles(prev=>prev.map(r=>r.id===editRoleId?{...r,role_name:name}:r))
    setEditRoleId(null); setEditRoleName(''); setSaving(false)
  }
  const moveRole = async (id,dir) => {
    const idx=roles.findIndex(r=>r.id===id); if(idx<0) return
    const swap=roles[idx+dir]; if(!swap) return
    const a=roles[idx],b=swap,aO=a.sort_order??idx,bO=b.sort_order??(idx+dir)
    await Promise.all([supabase.from('org_custom_roles').update({sort_order:bO}).eq('id',a.id),supabase.from('org_custom_roles').update({sort_order:aO}).eq('id',b.id)]).catch(()=>{})
    setRoles(prev=>{const n=[...prev];n[idx]={...a,sort_order:bO};n[idx+dir]={...b,sort_order:aO};return [...n].sort((x,y)=>(x.sort_order??999)-(y.sort_order??999))})
  }

  // Positions CRUD
  const addPosition = async () => {
    const name = newPositionName.trim()
    if(!name||!orgId||!isConfigured()) return
    if([...DEFAULT_POSITIONS,...customPositions.map(p=>p.position_name)].find(n=>n.toLowerCase()===name.toLowerCase())) return
    setSaving(true)
    const maxOrder = customPositions.reduce((m,p)=>Math.max(m,p.sort_order||0),0)
    const {data,error} = await supabase.from('org_custom_positions').insert({position_name:name,organisation_id:orgId,sort_order:maxOrder+1}).select().single()
    if(!error&&data) { setCustomPositions(prev=>[...prev,data]); setNewPositionName('') }
    setSaving(false)
  }
  const deletePosition = async (id) => {
    await supabase.from('org_custom_positions').delete().eq('id',id).catch(()=>{})
    setCustomPositions(prev=>prev.filter(p=>p.id!==id))
  }
  const savePosEdit = async () => {
    const name = editPosName.trim()
    if(!name||!editPosId) return
    setSaving(true)
    await supabase.from('org_custom_positions').update({position_name:name}).eq('id',editPosId).catch(()=>{})
    setCustomPositions(prev=>prev.map(p=>p.id===editPosId?{...p,position_name:name}:p))
    setEditPosId(null); setEditPosName(''); setSaving(false)
  }
  const movePos = async (id,dir) => {
    const idx=customPositions.findIndex(p=>p.id===id); if(idx<0) return
    const swap=customPositions[idx+dir]; if(!swap) return
    const a=customPositions[idx],b=swap,aO=a.sort_order??idx,bO=b.sort_order??(idx+dir)
    await Promise.all([supabase.from('org_custom_positions').update({sort_order:bO}).eq('id',a.id),supabase.from('org_custom_positions').update({sort_order:aO}).eq('id',b.id)]).catch(()=>{})
    setCustomPositions(prev=>{const n=[...prev];n[idx]={...a,sort_order:bO};n[idx+dir]={...b,sort_order:aO};return [...n].sort((x,y)=>(x.sort_order??999)-(y.sort_order??999))})
  }

  // Global industries CRUD (super_admin only)
  const addGlobal = async () => {
    const name=newGlobalName.trim(); if(!name||!isConfigured()) return
    if(globalList.find(i=>i.name.toLowerCase()===name.toLowerCase())) return
    setSaving(true)
    const {data,error}=await supabase.from('global_industries').insert({name,created_by:user.name,created_at:new Date().toISOString()}).select().single()
    if(!error&&data){setGlobalList(prev=>[...prev,data]);setNewGlobalName('')}
    setSaving(false)
  }
  const deleteGlobal = async (id) => {
    if(!window.confirm('Delete this global industry?')) return
    await supabase.from('global_industries').delete().eq('id',id).catch(()=>{})
    setGlobalList(prev=>prev.filter(i=>i.id!==id))
  }
  const saveGlobalEdit = async () => {
    const name=editGlobalName.trim(); if(!name||!editGlobalId) return
    setSaving(true)
    await supabase.from('global_industries').update({name}).eq('id',editGlobalId).catch(()=>{})
    setGlobalList(prev=>prev.map(i=>i.id===editGlobalId?{...i,name}:i))
    setEditGlobalId(null);setEditGlobalName('');setSaving(false)
  }
  const moveGlobal = async (id,dir) => {
    const idx=globalList.findIndex(i=>i.id===id); if(idx<0) return
    const swap=globalList[idx+dir]; if(!swap) return
    setGlobalList(prev=>{const n=[...prev];n[idx]=swap;n[idx+dir]=prev[idx];return n})
  }

  const TABS = isSuper
    ? [['global_industries','Global Industries'],['roles','Roles per Industry'],['positions','Positions']]
    : [['roles','Roles per Industry'],['positions','Positions']]

  const ROW = {display:'flex',alignItems:'center',gap:6,padding:'8px 10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--s2)',marginBottom:4}
  const BADGE = (label, color='#6B7280') => <span style={{fontSize:9,fontWeight:700,color,background:color+'18',border:'1px solid '+color+'30',borderRadius:4,padding:'1px 6px',letterSpacing:'.4px',flexShrink:0}}>{label}</span>

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-title">Roles &amp; Positions</div>
        <div className="ph-sub">Manage roles and position labels for your organisation</div>
      </div>

      <div style={{display:'flex',gap:2,background:'var(--s3)',borderRadius:8,padding:3,marginBottom:16}}>
        {TABS.map(([k,l])=><button key={k} onClick={()=>setActiveTab(k)} style={{flex:'1 1 auto',padding:'6px 10px',borderRadius:6,border:'none',background:activeTab===k?'#fff':'transparent',color:activeTab===k?'var(--text)':'var(--t2)',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',boxShadow:activeTab===k?'0 1px 4px rgba(0,0,0,.1)':'none'}}>{l}</button>)}
      </div>

      {/* ── GLOBAL INDUSTRIES (super_admin) ── */}
      {activeTab==='global_industries'&&(
        <div className="section">
          <div style={{display:'flex',gap:8,marginBottom:14}}>
            <input className="form-input" style={{flex:1}} placeholder="New global industry…" value={newGlobalName} onChange={e=>setNewGlobalName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addGlobal()}/>
            <button className="btn btn-primary" onClick={addGlobal} disabled={saving||!newGlobalName.trim()}>Add</button>
          </div>
          {globalList.length===0 ? <div style={{fontSize:13,color:'var(--t2)'}}>No global industries yet.</div> : (
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              {globalList.map((ind,idx)=>(
                <div key={ind.id} style={ROW}>
                  {editGlobalId===ind.id ? (
                    <>
                      <input className="form-input" style={{flex:1,fontSize:13}} value={editGlobalName} onChange={e=>setEditGlobalName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')saveGlobalEdit();if(e.key==='Escape'){setEditGlobalId(null);setEditGlobalName('')}}} autoFocus/>
                      <button className="btn btn-primary btn-sm" onClick={saveGlobalEdit} disabled={saving}>Save</button>
                      <button className="btn btn-secondary btn-sm" onClick={()=>{setEditGlobalId(null);setEditGlobalName('')}}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <span style={{flex:1,fontSize:13,fontWeight:500}}>{ind.name}</span>
                      <div style={{display:'flex',gap:3,alignItems:'center'}}>
                        <button style={{background:'none',border:'none',cursor:idx>0?'pointer':'default',opacity:idx>0?1:.3,fontSize:12,padding:'2px 4px'}} onClick={()=>moveGlobal(ind.id,-1)} disabled={idx===0}>↑</button>
                        <button style={{background:'none',border:'none',cursor:idx<globalList.length-1?'pointer':'default',opacity:idx<globalList.length-1?1:.3,fontSize:12,padding:'2px 4px'}} onClick={()=>moveGlobal(ind.id,1)} disabled={idx===globalList.length-1}>↓</button>
                        <button className="btn btn-secondary btn-sm" style={{fontSize:11}} onClick={()=>{setEditGlobalId(ind.id);setEditGlobalName(ind.name)}}>Edit</button>
                        <button className="btn btn-danger btn-sm" style={{fontSize:11}} onClick={()=>deleteGlobal(ind.id)}>Delete</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ROLES PER INDUSTRY ── */}
      {activeTab==='roles'&&(
        <div style={{display:'grid',gridTemplateColumns:'240px 1fr',gap:12,alignItems:'start'}}>

          {/* Left: industry list */}
          <div className="section" style={{padding:'12px 10px'}}>
            <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:8,padding:'0 2px'}}>Industries</div>
            {loading ? <div style={{fontSize:12,color:'var(--t2)'}}>Loading…</div> : (
              <>
                {/* Global industries (read-only in this view) */}
                {globalNames.map(n=>(
                  <button key={n} onClick={()=>setSelectedIndustry(n)} style={{display:'flex',alignItems:'center',gap:6,width:'100%',textAlign:'left',padding:'7px 8px',borderRadius:7,border:'none',background:selectedIndustry===n?'var(--brand-lt)':'transparent',color:selectedIndustry===n?'var(--brand)':'var(--text)',fontSize:12,fontWeight:selectedIndustry===n?600:400,cursor:'pointer',fontFamily:'inherit',marginBottom:2}}>
                    <span style={{flex:1}}>{n}</span>
                    {BADGE('Global','#6B7280')}
                  </button>
                ))}
                {/* Org custom industries */}
                {orgIndustryObjs.filter(i=>!globalNames.includes(i.name)).map(ind=>(
                  <div key={ind.id} style={{marginBottom:2}}>
                    {editIndId===ind.id ? (
                      <div style={{display:'flex',gap:4,padding:'4px 2px'}}>
                        <input className="form-input" style={{flex:1,fontSize:11,padding:'4px 6px'}} value={editIndName} onChange={e=>setEditIndName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')saveIndEdit();if(e.key==='Escape'){setEditIndId(null);setEditIndName('')}}} autoFocus/>
                        <button className="btn btn-primary btn-sm" style={{fontSize:10,padding:'3px 7px'}} onClick={saveIndEdit} disabled={saving}>✓</button>
                        <button className="btn btn-secondary btn-sm" style={{fontSize:10,padding:'3px 7px'}} onClick={()=>{setEditIndId(null);setEditIndName('')}}>✕</button>
                      </div>
                    ) : (
                      <div style={{display:'flex',alignItems:'center',gap:4,padding:'4px 2px',borderRadius:7,background:selectedIndustry===ind.name?'var(--brand-lt)':'transparent'}}>
                        <button onClick={()=>setSelectedIndustry(ind.name)} style={{flex:1,textAlign:'left',padding:'3px 6px',borderRadius:6,border:'none',background:'transparent',color:selectedIndustry===ind.name?'var(--brand)':'var(--text)',fontSize:12,fontWeight:selectedIndustry===ind.name?600:400,cursor:'pointer',fontFamily:'inherit'}}>{ind.name}</button>
                        <button style={{background:'none',border:'none',cursor:'pointer',fontSize:10,color:'var(--t2)',padding:'2px 3px',lineHeight:1}} onClick={()=>{setEditIndId(ind.id);setEditIndName(ind.name)}} title="Edit">✏</button>
                        <button style={{background:'none',border:'none',cursor:'pointer',fontSize:10,color:'var(--red)',padding:'2px 3px',lineHeight:1}} onClick={()=>deleteOrgIndustry(ind.id,ind.name)} title="Delete">✕</button>
                      </div>
                    )}
                  </div>
                ))}

                {/* Add Industry */}
                {showAddInd ? (
                  <div style={{display:'flex',gap:4,marginTop:6,padding:'4px 2px'}}>
                    <input className="form-input" style={{flex:1,fontSize:11,padding:'4px 6px'}} placeholder="Industry name…" value={newIndName} onChange={e=>setNewIndName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')addOrgIndustry();if(e.key==='Escape'){setShowAddInd(false);setNewIndName('')}}} autoFocus/>
                    <button className="btn btn-primary btn-sm" style={{fontSize:10,padding:'3px 7px'}} onClick={addOrgIndustry} disabled={saving||!newIndName.trim()}>Add</button>
                    <button className="btn btn-secondary btn-sm" style={{fontSize:10,padding:'3px 7px'}} onClick={()=>{setShowAddInd(false);setNewIndName('')}}>✕</button>
                  </div>
                ) : (
                  <button className="btn btn-secondary btn-sm" style={{width:'100%',marginTop:8,fontSize:11}} onClick={()=>setShowAddInd(true)}>+ Add Industry</button>
                )}
              </>
            )}
          </div>

          {/* Right: roles for selected industry */}
          <div className="section">
            <div className="section-title" style={{marginBottom:10}}>
              Roles
              {selectedIndustry&&<span style={{fontSize:12,color:'var(--brand)',fontWeight:400,marginLeft:8}}>— {selectedIndustry}</span>}
            </div>
            {!selectedIndustry ? (
              <div style={{fontSize:13,color:'var(--t2)',padding:'20px 0',textAlign:'center'}}>← Select an industry to manage its roles</div>
            ) : !orgId ? (
              <div style={{fontSize:13,color:'var(--t2)'}}>Loading organisation…</div>
            ) : (
              <>
                {roles.length===0 && <div style={{fontSize:13,color:'var(--t2)',marginBottom:10}}>No roles defined yet — click Add Role to get started.</div>}
                <div style={{display:'flex',flexDirection:'column',gap:4,marginBottom:10}}>
                  {roles.map((role,idx)=>(
                    <div key={role.id} style={ROW}>
                      {editRoleId===role.id ? (
                        <>
                          <input className="form-input" style={{flex:1,fontSize:12}} value={editRoleName} onChange={e=>setEditRoleName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')saveRoleEdit();if(e.key==='Escape'){setEditRoleId(null);setEditRoleName('')}}} autoFocus/>
                          <button className="btn btn-primary btn-sm" onClick={saveRoleEdit} disabled={saving}>Save</button>
                          <button className="btn btn-secondary btn-sm" onClick={()=>{setEditRoleId(null);setEditRoleName('')}}>×</button>
                        </>
                      ) : (
                        <>
                          <span style={{flex:1,fontSize:12,fontWeight:500}}>{role.role_name}</span>
                          <div style={{display:'flex',gap:3}}>
                            <button style={{background:'none',border:'none',cursor:idx>0?'pointer':'default',opacity:idx>0?1:.3,fontSize:11,padding:'1px 4px'}} onClick={()=>moveRole(role.id,-1)} disabled={idx===0}>↑</button>
                            <button style={{background:'none',border:'none',cursor:idx<roles.length-1?'pointer':'default',opacity:idx<roles.length-1?1:.3,fontSize:11,padding:'1px 4px'}} onClick={()=>moveRole(role.id,1)} disabled={idx===roles.length-1}>↓</button>
                            <button className="btn btn-secondary btn-sm" style={{fontSize:10}} onClick={()=>{setEditRoleId(role.id);setEditRoleName(role.role_name)}}>Edit</button>
                            <button className="btn btn-danger btn-sm" style={{fontSize:10}} onClick={()=>deleteRole(role.id)}>Delete</button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{display:'flex',gap:6}}>
                  <input className="form-input" style={{flex:1,fontSize:12}} placeholder="New role name…" value={newRoleName} onChange={e=>setNewRoleName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addRole()}/>
                  <button className="btn btn-primary btn-sm" onClick={addRole} disabled={saving||!newRoleName.trim()}>Add Role</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── POSITIONS ── */}
      {activeTab==='positions'&&(
        <div className="section">
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:8}}>Default Positions</div>
            {DEFAULT_POSITIONS.map(p=>(
              <div key={p} style={{...ROW,marginBottom:6}}>
                <span style={{flex:1,fontSize:13,fontWeight:500}}>{p}</span>
                <span style={{fontSize:11,color:'var(--t3)'}}>🔒 Default</span>
              </div>
            ))}
            <div style={{fontSize:11,color:'var(--t3)',marginTop:4}}>Default positions cannot be deleted. They appear at the top of every position dropdown.</div>
          </div>

          <div>
            <div style={{fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:8}}>Custom Positions</div>
            {!orgId ? <div style={{fontSize:13,color:'var(--t2)'}}>Loading…</div> : customPositions.length===0 ? (
              <div style={{fontSize:13,color:'var(--t2)',marginBottom:10}}>No custom positions yet.</div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:4,marginBottom:10}}>
                {customPositions.map((pos,idx)=>(
                  <div key={pos.id} style={ROW}>
                    {editPosId===pos.id ? (
                      <>
                        <input className="form-input" style={{flex:1,fontSize:12}} value={editPosName} onChange={e=>setEditPosName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')savePosEdit();if(e.key==='Escape'){setEditPosId(null);setEditPosName('')}}} autoFocus/>
                        <button className="btn btn-primary btn-sm" onClick={savePosEdit} disabled={saving}>Save</button>
                        <button className="btn btn-secondary btn-sm" onClick={()=>{setEditPosId(null);setEditPosName('')}}>×</button>
                      </>
                    ) : (
                      <>
                        <span style={{flex:1,fontSize:12,fontWeight:500}}>{pos.position_name}</span>
                        <div style={{display:'flex',gap:3}}>
                          <button style={{background:'none',border:'none',cursor:idx>0?'pointer':'default',opacity:idx>0?1:.3,fontSize:11,padding:'1px 4px'}} onClick={()=>movePos(pos.id,-1)} disabled={idx===0}>↑</button>
                          <button style={{background:'none',border:'none',cursor:idx<customPositions.length-1?'pointer':'default',opacity:idx<customPositions.length-1?1:.3,fontSize:11,padding:'1px 4px'}} onClick={()=>movePos(pos.id,1)} disabled={idx===customPositions.length-1}>↓</button>
                          <button className="btn btn-secondary btn-sm" style={{fontSize:10}} onClick={()=>{setEditPosId(pos.id);setEditPosName(pos.position_name)}}>Edit</button>
                          <button className="btn btn-danger btn-sm" style={{fontSize:10}} onClick={()=>deletePosition(pos.id)}>Delete</button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div style={{display:'flex',gap:6}}>
              <input className="form-input" style={{flex:1,fontSize:12}} placeholder="e.g. Duty Manager, Head Chef, Team Leader…" value={newPositionName} onChange={e=>setNewPositionName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addPosition()}/>
              <button className="btn btn-primary btn-sm" onClick={addPosition} disabled={saving||!newPositionName.trim()}>Add Position</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CompanySettingsView({ user }) {
  const NOTIF_EVENTS = [
    { key:'task_submitted', label:'Task Submitted', sub:'When a worker submits a task for review' },
    { key:'task_approved',  label:'Task Approved',  sub:'When a task is approved by a reviewer' },
    { key:'task_rejected',  label:'Task Rejected',  sub:'When a task is sent back to the worker' },
    { key:'task_overdue',   label:'Task Overdue',   sub:'When a task passes its due date' },
    { key:'task_escalated', label:'Task Escalated', sub:'When a task is flagged for escalation' },
  ]
  const defaultSettings = {
    notifications:{
      email_enabled:true,
      events:{
        task_submitted:{enabled:true,recipients:''},
        task_approved:{enabled:false,recipients:''},
        task_rejected:{enabled:true,recipients:''},
        task_overdue:{enabled:true,recipients:''},
        task_escalated:{enabled:true,recipients:''},
      },
      daily_digest:false, digest_time:'08:00', digest_recipients:'',
    },
    tasks:{
      default_priority:'medium', default_recurrence:'once',
      require_gps:false, require_evidence:false, min_evidence_photos:1,
      require_comments:false, auto_escalate_days:3,
    },
    compliance:{ score_target:90, critical_categories:[], reminder_days:[2] },
    branding:{ primary_color:'#00A87E', report_header:'', report_footer:'' },
    data:{ retention_months:24 },
  }
  const emptyForm = {
    name:'', industry:'', abn:'', website:'', timezone:'',
    address_street:'', address_city:'', address_state:'', address_postcode:'', address_country:'Australia',
    contact_name:'', contact_email:'', contact_phone:'',
    contact2_name:'', contact2_email:'', contact2_phone:'',
    logo:'', notes:''
  }

  const [activeTab, setActiveTab] = useState('company')
  const [form, setForm] = useState(emptyForm)
  const [settings, setSettings] = useState(defaultSettings)
  const [orgId, setOrgId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [exporting, setExporting] = useState(false)
  const [orgPlan, setOrgPlan] = useState('')
  const [orgRetentionExtended, setOrgRetentionExtended] = useState(false)
  const [orgRetentionYears, setOrgRetentionYears] = useState(null)
  const [retentionYearsInput, setRetentionYearsInput] = useState('7')
  const [showContactModal, setShowContactModal] = useState(false)
  const [savingRetention, setSavingRetention] = useState(false)
  const [autoLogoutMinutes, setAutoLogoutMinutes] = useState(30)
  const [tplList, setTplList] = useState([])
  const [tplName, setTplName] = useState('')
  const [tplItems, setTplItems] = useState([{text:'',mandatory:false,requirePhoto:false}])
  const [tplSaving, setTplSaving] = useState(false)
  // Team Management tab state
  const [tmGlobalInds, setTmGlobalInds] = useState([])
  const [tmOrgInds, setTmOrgInds] = useState([])
  const [tmAllRoles, setTmAllRoles] = useState([])
  const [tmCustomPos, setTmCustomPos] = useState([])
  const [tmExpanded, setTmExpanded] = useState(new Set())
  const [tmNewIndName, setTmNewIndName] = useState('')
  const [tmEditInd, setTmEditInd] = useState(null)
  const [tmNewRoleName, setTmNewRoleName] = useState({})
  const [tmEditRole, setTmEditRole] = useState(null)
  const [tmNewPosName, setTmNewPosName] = useState('')
  const [tmEditPos, setTmEditPos] = useState(null)
  const [tmSaving, setTmSaving] = useState(false)
  const [tmSubTab, setTmSubTab] = useState('industries')
  const [tmGlobalList, setTmGlobalList] = useState([])
  const [tmNewGlobalName, setTmNewGlobalName] = useState('')
  const [tmEditGlobal, setTmEditGlobal] = useState(null)
  const [tmLoaded, setTmLoaded] = useState(false)

  useEffect(() => {
    if (!isConfigured()) { setLoading(false); return }
    supabase.from('organisations').select('*').eq('name', user.org).maybeSingle().then(({ data }) => {
      if (data) {
        setOrgId(data.id)
        if(data.auto_logout_minutes!=null) setAutoLogoutMinutes(data.auto_logout_minutes)
        setForm({
          name:data.name||'', industry:data.industry||'', abn:data.abn||'',
          website:data.website||'', timezone:data.timezone||'',
          address_street:data.address_street||'', address_city:data.address_city||'',
          address_state:data.address_state||'', address_postcode:data.address_postcode||'',
          address_country:data.address_country||'Australia',
          contact_name:data.contact_name||'', contact_email:data.contact_email||data.admin_email||'',
          contact_phone:data.contact_phone||'',
          contact2_name:data.contact2_name||'', contact2_email:data.contact2_email||'',
          contact2_phone:data.contact2_phone||'',
          logo:data.logo||'', notes:data.notes||''
        })
        if (data.org_settings) {
          try {
            const p = JSON.parse(data.org_settings)
            setSettings({
              notifications:{ ...defaultSettings.notifications, ...p.notifications, events:{ ...defaultSettings.notifications.events, ...(p.notifications?.events||{}) } },
              tasks:{ ...defaultSettings.tasks, ...p.tasks },
              compliance:{ ...defaultSettings.compliance, ...p.compliance },
              branding:{ ...defaultSettings.branding, ...p.branding },
              data:{ ...defaultSettings.data, ...p.data },
            })
          } catch(e) {}
        }
        setOrgPlan((data.plan||'').toLowerCase())
        setOrgRetentionExtended(data.retention_extended||false)
        setOrgRetentionYears(data.retention_years||null)
        setRetentionYearsInput(String(data.retention_years||7))
      }
      setLoading(false)
    })
  }, [user.org])

  useEffect(()=>{
    if(!isConfigured()||!orgId) return
    supabase.from('checklist_templates').select('*').eq('organisation_id',orgId).order('name')
      .then(({data})=>{ if(data) setTplList(data.map(t=>({...t,items:parseSafe(t.items)}))) })
      .catch(()=>{})
  },[orgId])

  useEffect(()=>{
    if(!orgId||!isConfigured()||tmLoaded) return
    setTmLoaded(true)
    Promise.all([
      supabase.from('global_industries').select('*').order('name'),
      supabase.from('org_industries').select('*').eq('organisation_id',orgId),
      supabase.from('org_custom_roles').select('*').eq('organisation_id',orgId).order('sort_order',{nullsFirst:false}).order('role_name'),
      supabase.from('org_custom_positions').select('*').eq('organisation_id',orgId).order('sort_order',{nullsFirst:false}).order('position_name')
    ]).then(([gi,oi,cr,cp])=>{
      if(gi.data){ setTmGlobalInds(gi.data); setTmGlobalList(gi.data) }
      if(oi.data) setTmOrgInds(oi.data)
      if(cr.data) setTmAllRoles(cr.data)
      if(cp.data) setTmCustomPos(cp.data)
    }).catch(()=>{})
  },[orgId, tmLoaded])

  const saveTemplate = async () => {
    const validItems = tplItems.filter(i=>i.text.trim())
    if (!tplName.trim() || !validItems.length) { setMsg('✗ Template needs a name and at least one item'); return }
    setTplSaving(true); setMsg('')
    const entry = { id: Date.now()+'', organisation_id: orgId, name: tplName.trim(), items: JSON.stringify(validItems), created_by: user.name, created_at: new Date().toISOString() }
    if (isConfigured()) {
      const { error } = await supabase.from('checklist_templates').insert(entry)
      if (error) { setMsg('✗ '+error.message); setTplSaving(false); return }
    }
    setTplList(prev=>[...prev,{...entry,items:validItems}])
    setTplName(''); setTplItems([{text:'',mandatory:false,requirePhoto:false}])
    setMsg('✓ Template saved')
    setTplSaving(false)
  }

  const deleteTemplate = async (id) => {
    if (!confirm('Delete this template?')) return
    if (isConfigured()) await supabase.from('checklist_templates').delete().eq('id',id).catch(()=>{})
    setTplList(prev=>prev.filter(t=>t.id!==id))
  }

  // Team Management CRUD
  const tmAllIndNames = () => [...tmGlobalInds,...tmOrgInds].map(i=>i.name.toLowerCase())
  const tmRolesFor = (ind) => [...tmAllRoles].filter(r=>r.industry_name===ind).sort((a,b)=>(a.sort_order??999)-(b.sort_order??999))
  const tmToggle = (name) => setTmExpanded(prev=>{ const s=new Set(prev); s.has(name)?s.delete(name):s.add(name); return s })

  const tmAddInd = async () => {
    const name=tmNewIndName.trim(); if(!name||!orgId) return
    if(tmAllIndNames().includes(name.toLowerCase())) return
    setTmSaving(true)
    const {data,error}=await supabase.from('org_industries').insert({name,organisation_id:orgId,created_by:user.name,created_at:new Date().toISOString()}).select().single()
    if(!error&&data){setTmOrgInds(prev=>[...prev,data]);setTmNewIndName('')}
    else if(error) setMsg('✗ '+error.message)
    setTmSaving(false)
  }
  const tmDeleteInd = async (id,name) => {
    if(!window.confirm('Delete "'+name+'"? All its roles will also be deleted.')) return
    await supabase.from('org_custom_roles').delete().eq('organisation_id',orgId).eq('industry_name',name).catch(()=>{})
    await supabase.from('org_industries').delete().eq('id',id).catch(()=>{})
    setTmOrgInds(prev=>prev.filter(i=>i.id!==id))
    setTmAllRoles(prev=>prev.filter(r=>r.industry_name!==name))
  }
  const tmSaveInd = async () => {
    if(!tmEditInd?.name?.trim()) return; setTmSaving(true)
    await supabase.from('org_industries').update({name:tmEditInd.name.trim()}).eq('id',tmEditInd.id).catch(()=>{})
    setTmOrgInds(prev=>prev.map(i=>i.id===tmEditInd.id?{...i,name:tmEditInd.name.trim()}:i))
    setTmEditInd(null); setTmSaving(false)
  }

  const tmAddRole = async (industryName) => {
    const name=(tmNewRoleName[industryName]||'').trim(); if(!name||!orgId) return
    if(tmRolesFor(industryName).find(r=>r.role_name.toLowerCase()===name.toLowerCase())) return
    setTmSaving(true)
    const maxO=tmRolesFor(industryName).reduce((m,r)=>Math.max(m,r.sort_order||0),0)
    const {data,error}=await supabase.from('org_custom_roles').insert({role_name:name,organisation_id:orgId,industry_name:industryName,sort_order:maxO+1}).select().single()
    if(!error&&data){setTmAllRoles(prev=>[...prev,data]);setTmNewRoleName(prev=>({...prev,[industryName]:''}))}
    setTmSaving(false)
  }
  const tmDeleteRole = async (id) => {
    await supabase.from('org_custom_roles').delete().eq('id',id).catch(()=>{})
    setTmAllRoles(prev=>prev.filter(r=>r.id!==id))
  }
  const tmSaveRole = async () => {
    if(!tmEditRole?.role_name?.trim()) return; setTmSaving(true)
    await supabase.from('org_custom_roles').update({role_name:tmEditRole.role_name.trim()}).eq('id',tmEditRole.id).catch(()=>{})
    setTmAllRoles(prev=>prev.map(r=>r.id===tmEditRole.id?{...r,role_name:tmEditRole.role_name.trim()}:r))
    setTmEditRole(null); setTmSaving(false)
  }
  const tmMoveRole = async (id,industryName,dir) => {
    const list=tmRolesFor(industryName); const idx=list.findIndex(r=>r.id===id); if(idx<0) return
    const swap=list[idx+dir]; if(!swap) return
    const aO=list[idx].sort_order??idx, bO=swap.sort_order??(idx+dir)
    await Promise.all([supabase.from('org_custom_roles').update({sort_order:bO}).eq('id',id),supabase.from('org_custom_roles').update({sort_order:aO}).eq('id',swap.id)]).catch(()=>{})
    setTmAllRoles(prev=>prev.map(r=>r.id===id?{...r,sort_order:bO}:r.id===swap.id?{...r,sort_order:aO}:r))
  }

  const tmAddPos = async () => {
    const name=tmNewPosName.trim(); if(!name||!orgId) return
    const defaults=['Manager','Supervisor','Staff Member']
    if([...defaults,...tmCustomPos.map(p=>p.position_name)].find(n=>n.toLowerCase()===name.toLowerCase())) return
    setTmSaving(true)
    const maxO=tmCustomPos.reduce((m,p)=>Math.max(m,p.sort_order||0),0)
    const {data,error}=await supabase.from('org_custom_positions').insert({position_name:name,organisation_id:orgId,sort_order:maxO+1}).select().single()
    if(!error&&data){setTmCustomPos(prev=>[...prev,data]);setTmNewPosName('')}
    setTmSaving(false)
  }
  const tmDeletePos = async (id) => {
    await supabase.from('org_custom_positions').delete().eq('id',id).catch(()=>{})
    setTmCustomPos(prev=>prev.filter(p=>p.id!==id))
  }
  const tmSavePos = async () => {
    if(!tmEditPos?.position_name?.trim()) return; setTmSaving(true)
    await supabase.from('org_custom_positions').update({position_name:tmEditPos.position_name.trim()}).eq('id',tmEditPos.id).catch(()=>{})
    setTmCustomPos(prev=>prev.map(p=>p.id===tmEditPos.id?{...p,position_name:tmEditPos.position_name.trim()}:p))
    setTmEditPos(null); setTmSaving(false)
  }
  const tmMovePos = async (id,dir) => {
    const sorted=[...tmCustomPos].sort((a,b)=>(a.sort_order??999)-(b.sort_order??999))
    const idx=sorted.findIndex(p=>p.id===id); if(idx<0) return
    const swap=sorted[idx+dir]; if(!swap) return
    const aO=sorted[idx].sort_order??idx, bO=swap.sort_order??(idx+dir)
    await Promise.all([supabase.from('org_custom_positions').update({sort_order:bO}).eq('id',id),supabase.from('org_custom_positions').update({sort_order:aO}).eq('id',swap.id)]).catch(()=>{})
    setTmCustomPos(prev=>prev.map(p=>p.id===id?{...p,sort_order:bO}:p.id===swap.id?{...p,sort_order:aO}:p))
  }

  const tmAddGlobal = async () => {
    const name=tmNewGlobalName.trim(); if(!name) return
    if(tmGlobalList.find(i=>i.name.toLowerCase()===name.toLowerCase())) return
    setTmSaving(true)
    const {data,error}=await supabase.from('global_industries').insert({name,created_by:user.name,created_at:new Date().toISOString()}).select().single()
    if(!error&&data){setTmGlobalList(prev=>[...prev,data]);setTmGlobalInds(prev=>[...prev,data]);setTmNewGlobalName('')}
    setTmSaving(false)
  }
  const tmDeleteGlobal = async (id) => {
    if(!window.confirm('Delete this global industry? It will no longer appear in any organisation dropdowns.')) return
    await supabase.from('global_industries').delete().eq('id',id).catch(()=>{})
    setTmGlobalList(prev=>prev.filter(i=>i.id!==id))
    setTmGlobalInds(prev=>prev.filter(i=>i.id!==id))
  }
  const tmSaveGlobal = async () => {
    if(!tmEditGlobal?.name?.trim()) return; setTmSaving(true)
    await supabase.from('global_industries').update({name:tmEditGlobal.name.trim()}).eq('id',tmEditGlobal.id).catch(()=>{})
    const updated = (prev) => prev.map(i=>i.id===tmEditGlobal.id?{...i,name:tmEditGlobal.name.trim()}:i)
    setTmGlobalList(updated); setTmGlobalInds(updated)
    setTmEditGlobal(null); setTmSaving(false)
  }
  const tmMoveGlobal = async (id,dir) => {
    const idx=tmGlobalList.findIndex(i=>i.id===id); if(idx<0) return
    const swap=tmGlobalList[idx+dir]; if(!swap) return
    const upd = (prev) => {const n=[...prev];n[idx]=swap;n[idx+dir]=prev[idx];return n}
    setTmGlobalList(upd); setTmGlobalInds(upd)
  }

  const save = async () => {
    if (activeTab==='team') return
    if (activeTab==='company' && !form.name.trim()) { setMsg('✗ Company name is required'); return }
    setSaving(true); setMsg('')
    const updates = activeTab==='company' ? {
      name:form.name.trim(), industry:form.industry, abn:form.abn.trim(),
      website:form.website.trim(), timezone:form.timezone,
      address_street:form.address_street.trim(), address_city:form.address_city.trim(),
      address_state:form.address_state.trim(), address_postcode:form.address_postcode.trim(),
      address_country:form.address_country.trim(),
      contact_name:form.contact_name.trim(), contact_email:form.contact_email.trim(),
      contact_phone:form.contact_phone.trim(),
      contact2_name:form.contact2_name.trim(), contact2_email:form.contact2_email.trim(),
      contact2_phone:form.contact2_phone.trim(), logo:form.logo, notes:form.notes.trim()
    } : activeTab==='branding' ? {
      logo:form.logo, org_settings:JSON.stringify(settings)
    } : activeTab==='tasks' ? {
      org_settings:JSON.stringify(settings), auto_logout_minutes:autoLogoutMinutes
    } : {
      org_settings:JSON.stringify(settings)
    }
    if (isConfigured() && orgId) {
      const { error } = await supabase.from('organisations').update(updates).eq('id', orgId)
      if (error) { setMsg('✗ '+error.message); setSaving(false); return }
    }
    setMsg('✓ Settings saved')
    setSaving(false)
  }

  const exportCSV = async () => {
    setExporting(true)
    try {
      const { data } = await supabase.from('tasks').select('*').eq('org', user.org)
      if (!data?.length) { alert('No tasks to export'); setExporting(false); return }
      const cols = ['id','title','status','priority','category','department','assigned_user_name','assigned_role','due_date','created_at','submitted_at','completed_at','gps_start','gps_end','compliance']
      const esc = v => { const s=String(v??''); return (s.includes(',')||s.includes('"')||s.includes('\n'))?`"${s.replace(/"/g,'""')}"`  :s }
      const csv = [cols.join(','), ...data.map(t=>cols.map(c=>esc(t[c])).join(','))].join('\n')
      const url = URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
      Object.assign(document.createElement('a'),{href:url,download:`${user.org.replace(/\s+/g,'-')}-tasks-${new Date().toISOString().slice(0,10)}.csv`}).click()
      URL.revokeObjectURL(url)
    } catch(e) { alert('Export failed: '+e.message) }
    setExporting(false)
  }

  const fld = k => ({ value:form[k], onChange:e=>setForm(p=>({...p,[k]:e.target.value})) })
  const setN  = (k,v) => setSettings(p=>({...p,notifications:{...p.notifications,[k]:v}}))
  const setNE = (ev,k,v) => setSettings(p=>({...p,notifications:{...p.notifications,events:{...p.notifications.events,[ev]:{...p.notifications.events[ev],[k]:v}}}}))
  const setT  = (k,v) => setSettings(p=>({...p,tasks:{...p.tasks,[k]:v}}))
  const setC  = (k,v) => setSettings(p=>({...p,compliance:{...p.compliance,[k]:v}}))
  const setB  = (k,v) => setSettings(p=>({...p,branding:{...p.branding,[k]:v}}))
  const setD  = (k,v) => setSettings(p=>({...p,data:{...p.data,[k]:v}}))

  const Tog = ({on,toggle}) => (
    <button style={{width:38,height:21,borderRadius:11,border:'none',cursor:'pointer',background:on?'var(--green)':'var(--border)',position:'relative',transition:'background .2s',flexShrink:0}} onClick={toggle}>
      <div style={{width:15,height:15,borderRadius:'50%',background:'#fff',position:'absolute',top:3,transition:'left .2s',left:on?20:3,boxShadow:'0 1px 3px rgba(0,0,0,.25)'}}/>
    </button>
  )
  const Row = ({label,sub,children}) => (
    <div style={{display:'flex',alignItems:sub?'flex-start':'center',justifyContent:'space-between',padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
      <div style={{flex:1,paddingRight:12}}><div style={{fontSize:13,fontWeight:500}}>{label}</div>{sub&&<div style={{fontSize:11,color:'var(--t2)',marginTop:1}}>{sub}</div>}</div>
      {children}
    </div>
  )
  const MsgBanner = () => msg ? <div style={{background:msg.startsWith('✓')?'rgba(16,185,129,.08)':'rgba(239,68,68,.08)',border:'1px solid '+(msg.startsWith('✓')?'rgba(16,185,129,.2)':'rgba(239,68,68,.2)'),borderRadius:6,padding:'10px 14px',fontSize:13,color:msg.startsWith('✓')?'var(--green)':'var(--red)',marginBottom:16}}>{msg}</div> : null
  const PillBtn = ({active,onClick,children}) => <button onClick={onClick} style={{padding:'5px 12px',borderRadius:6,border:'1px solid '+(active?'var(--brand)':'var(--border)'),background:active?'var(--brand-lt)':'transparent',color:active?'var(--brand)':'var(--t2)',fontWeight:active?700:400,cursor:'pointer',fontSize:12,fontFamily:'inherit'}}>{children}</button>
  const SaveFooter = () => <div style={{display:'flex',justifyContent:'flex-end',marginTop:8}}><button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Saving...':'Save Changes'}</button></div>

  if (loading) return <div className="loading"><div className="spinner"/><span>Loading...</span></div>

  const filled = COMPANY_COMPLETENESS_FIELDS.filter(f=>form[f.key]&&String(form[f.key]).trim())
  const pct = Math.round((filled.length/COMPANY_COMPLETENESS_FIELDS.length)*100)
  const pctColor = pct===100?'var(--green)':pct>=60?'var(--amber)':'var(--red)'
  const TABS = [['company','Company'],['notifications','Notifications'],['tasks','Tasks'],['compliance','Compliance'],['branding','Branding'],['templates','Templates'],['data','Data & Privacy'],...(['client_admin','super_admin'].includes(user?.role)?[['team','Team Management']]:[])]

  return (
    <div className="anim">
      <div className="ph">
        <div><div className="ph-title">Company Settings</div><div className="ph-sub">Configure your organisation, workflows and compliance</div></div>
        {activeTab!=='data'&&activeTab!=='templates'&&activeTab!=='team'&&<button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Saving...':'Save Changes'}</button>}
      </div>

      <MsgBanner/>

      <div style={{display:'flex',gap:2,background:'var(--s3)',borderRadius:8,padding:3,marginBottom:16,flexWrap:'wrap'}}>
        {TABS.map(([k,l])=><button key={k} onClick={()=>{setActiveTab(k);setMsg('')}} style={{flex:'1 1 auto',padding:'6px 8px',borderRadius:6,border:'none',background:activeTab===k?'#fff':'transparent',color:activeTab===k?'var(--text)':'var(--t2)',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',boxShadow:activeTab===k?'0 1px 4px rgba(0,0,0,.1)':'none',whiteSpace:'nowrap'}}>{l}</button>)}
      </div>

      {/* ── COMPANY ─────────────────────────────── */}
      {activeTab==='company'&&<>
        <div className="section" style={{marginBottom:14}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
            <div style={{fontSize:12,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.6px'}}>Profile Completeness</div>
            <div style={{fontSize:16,fontWeight:800,color:pctColor}}>{pct}%</div>
          </div>
          <div style={{height:6,background:'var(--s3)',borderRadius:4,overflow:'hidden'}}><div style={{height:'100%',width:pct+'%',background:pctColor,borderRadius:4,transition:'width .3s'}}/></div>
          <div style={{fontSize:11,color:'var(--t2)',marginTop:4}}>{filled.length} of {COMPANY_COMPLETENESS_FIELDS.length} fields completed</div>
        </div>
        <div className="section" style={{marginBottom:14}}>
          <div className="section-title">Company Identity</div>
          <div style={{display:'flex',gap:16,alignItems:'flex-start',flexWrap:'wrap'}}>
            <div style={{flexShrink:0}}>
              <div style={{width:84,height:84,borderRadius:10,border:'2px dashed var(--border)',background:'var(--s3)',display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',marginBottom:6}}>
                {form.logo?<img src={form.logo} alt="logo" style={{width:'100%',height:'100%',objectFit:'contain'}}/>:<span style={{fontSize:30}}>🏢</span>}
              </div>
              <label className="btn btn-secondary btn-sm" style={{cursor:'pointer',display:'block',textAlign:'center',marginBottom:4}}>{form.logo?'Change Logo':'Upload Logo'}<input type="file" accept="image/*" style={{display:'none'}} onChange={e=>{ const fl=e.target.files[0]; if(!fl) return; const r=new FileReader(); r.onload=ev=>setForm(p=>({...p,logo:ev.target.result})); r.readAsDataURL(fl); e.target.value='' }}/></label>
              {form.logo&&<button className="btn btn-danger btn-sm" style={{width:'100%'}} onClick={()=>setForm(p=>({...p,logo:''}))}>Remove</button>}
            </div>
            <div style={{flex:1,minWidth:220}}>
              <div className="two-col">
                <div className="form-field"><label className="form-label">Company Name <span style={{color:'var(--red)'}}>*</span></label><input className="form-input" {...fld('name')}/></div>
                <div className="form-field"><label className="form-label">ABN / Business Number</label><input className="form-input" placeholder="12 345 678 901" {...fld('abn')}/></div>
              </div>
              <div className="two-col">
                <div className="form-field"><label className="form-label">Industry</label><select className="form-input" {...fld('industry')}><option value="">— Select industry —</option>{PRESET_INDUSTRIES.map(k=><option key={k} value={k}>{k}</option>)}</select></div>
                <div className="form-field"><label className="form-label">Website</label><input className="form-input" placeholder="https://example.com" {...fld('website')}/></div>
              </div>
              <div className="form-field"><label className="form-label">Timezone</label><select className="form-input" {...fld('timezone')}><option value="">— Select timezone —</option>{TIMEZONES.map(tz=><option key={tz} value={tz}>{tz.replace(/_/g,' ')}</option>)}</select></div>
            </div>
          </div>
        </div>
        <div className="section" style={{marginBottom:14}}>
          <div className="section-title">Address</div>
          <div className="form-field"><label className="form-label">Street Address</label><input className="form-input" placeholder="123 Main Street" {...fld('address_street')}/></div>
          <div className="two-col">
            <div className="form-field"><label className="form-label">City / Suburb</label><input className="form-input" {...fld('address_city')}/></div>
            <div className="form-field"><label className="form-label">State / Province</label><input className="form-input" placeholder="NSW" {...fld('address_state')}/></div>
          </div>
          <div className="two-col">
            <div className="form-field"><label className="form-label">Postcode</label><input className="form-input" placeholder="2000" {...fld('address_postcode')}/></div>
            <div className="form-field"><label className="form-label">Country</label><input className="form-input" {...fld('address_country')}/></div>
          </div>
        </div>
        <div className="section" style={{marginBottom:14}}>
          <div className="section-title">Primary Contact</div>
          <div className="two-col">
            <div className="form-field"><label className="form-label">Name</label><input className="form-input" {...fld('contact_name')}/></div>
            <div className="form-field"><label className="form-label">Phone</label><input className="form-input" placeholder="+61 400 000 000" {...fld('contact_phone')}/></div>
          </div>
          <div className="form-field"><label className="form-label">Email</label><input className="form-input" type="email" {...fld('contact_email')}/></div>
        </div>
        <div className="section" style={{marginBottom:20}}>
          <div className="section-title">Secondary Contact</div>
          <div className="two-col">
            <div className="form-field"><label className="form-label">Name</label><input className="form-input" {...fld('contact2_name')}/></div>
            <div className="form-field"><label className="form-label">Phone</label><input className="form-input" placeholder="+61 400 000 000" {...fld('contact2_phone')}/></div>
          </div>
          <div className="form-field"><label className="form-label">Email</label><input className="form-input" type="email" {...fld('contact2_email')}/></div>
        </div>
        <SaveFooter/>
      </>}

      {/* ── NOTIFICATIONS ───────────────────────── */}
      {activeTab==='notifications'&&<>
        <div className="section" style={{marginBottom:14}}>
          <div className="section-title">Email Notifications</div>
          <Row label="Enable Email Notifications" sub="Send email alerts to specified recipients">
            <Tog on={settings.notifications.email_enabled} toggle={()=>setN('email_enabled',!settings.notifications.email_enabled)}/>
          </Row>
          {settings.notifications.email_enabled&&<div style={{marginTop:4}}>
            {NOTIF_EVENTS.map(ev=>(
              <div key={ev.key} style={{paddingBottom:12,marginBottom:12,borderBottom:'1px solid var(--border)'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                  <div><div style={{fontSize:13,fontWeight:600}}>{ev.label}</div><div style={{fontSize:11,color:'var(--t2)'}}>{ev.sub}</div></div>
                  <Tog on={settings.notifications.events[ev.key]?.enabled} toggle={()=>setNE(ev.key,'enabled',!settings.notifications.events[ev.key]?.enabled)}/>
                </div>
                {settings.notifications.events[ev.key]?.enabled&&(
                  <div>
                    <label className="form-label" style={{marginBottom:3}}>Recipients (comma-separated)</label>
                    <input className="form-input" style={{fontSize:12}} placeholder="admin@company.com, manager@company.com" value={settings.notifications.events[ev.key]?.recipients||''} onChange={e=>setNE(ev.key,'recipients',e.target.value)}/>
                  </div>
                )}
              </div>
            ))}
          </div>}
        </div>
        <div className="section" style={{marginBottom:20}}>
          <div className="section-title">Daily Digest</div>
          <Row label="Send Daily Summary Email" sub="A rolled-up summary of all activity, sent once per day">
            <Tog on={settings.notifications.daily_digest} toggle={()=>setN('daily_digest',!settings.notifications.daily_digest)}/>
          </Row>
          {settings.notifications.daily_digest&&<div className="two-col" style={{marginTop:10}}>
            <div className="form-field"><label className="form-label">Send Time</label><input className="form-input" type="time" value={settings.notifications.digest_time} onChange={e=>setN('digest_time',e.target.value)}/></div>
            <div className="form-field"><label className="form-label">Recipients</label><input className="form-input" placeholder="email@company.com" value={settings.notifications.digest_recipients} onChange={e=>setN('digest_recipients',e.target.value)}/></div>
          </div>}
        </div>
        <SaveFooter/>
      </>}

      {/* ── TASKS ───────────────────────────────── */}
      {activeTab==='tasks'&&<>
        <div className="section" style={{marginBottom:14}}>
          <div className="section-title">Session &amp; Security</div>
          <Row label="Auto logout after inactivity" sub="Sign out team members after this period of inactivity. Activity resets the timer.">
            <select className="form-input" style={{width:'auto',fontSize:12}} value={autoLogoutMinutes} onChange={e=>setAutoLogoutMinutes(Number(e.target.value))}>
              <option value={1}>1 minute</option>
              <option value={2}>2 minutes</option>
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={30}>30 minutes (default)</option>
              <option value={60}>1 hour</option>
              <option value={0}>Never (not recommended)</option>
            </select>
          </Row>
        </div>
        <div className="section" style={{marginBottom:14}}>
          <div className="section-title">Defaults</div>
          <div className="two-col">
            <div className="form-field"><label className="form-label">Default Priority</label><select className="form-input" value={settings.tasks.default_priority} onChange={e=>setT('default_priority',e.target.value)}>{Object.keys(PRIORITY_CFG).map(p=><option key={p} value={p}>{PRIORITY_CFG[p].label}</option>)}</select></div>
            <div className="form-field"><label className="form-label">Default Recurrence</label><select className="form-input" value={settings.tasks.default_recurrence} onChange={e=>setT('default_recurrence',e.target.value)}>{Object.entries(RECURRENCE_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
          </div>
        </div>
        <div className="section" style={{marginBottom:14}}>
          <div className="section-title">Submission Requirements</div>
          <Row label="Require GPS for Task Completion" sub="Workers must grant location access to start and complete tasks">
            <Tog on={settings.tasks.require_gps} toggle={()=>setT('require_gps',!settings.tasks.require_gps)}/>
          </Row>
          <Row label="Require Photo Evidence" sub="Workers must upload at least one photo before submitting">
            <Tog on={settings.tasks.require_evidence} toggle={()=>setT('require_evidence',!settings.tasks.require_evidence)}/>
          </Row>
          {settings.tasks.require_evidence&&(
            <div style={{padding:'8px 0'}}>
              <label className="form-label">Minimum photos required</label>
              <div style={{display:'flex',gap:6,marginTop:4}}>
                {[1,2,3,4,5].map(n=><button key={n} onClick={()=>setT('min_evidence_photos',n)} style={{width:36,height:36,borderRadius:6,border:'1px solid '+(settings.tasks.min_evidence_photos===n?'var(--brand)':'var(--border)'),background:settings.tasks.min_evidence_photos===n?'var(--brand-lt)':'transparent',color:settings.tasks.min_evidence_photos===n?'var(--brand)':'var(--t2)',fontWeight:700,cursor:'pointer',fontSize:13}}>{n}</button>)}
              </div>
            </div>
          )}
          <Row label="Require Comment Before Submission" sub="Workers must add a comment before submitting for review">
            <Tog on={settings.tasks.require_comments} toggle={()=>setT('require_comments',!settings.tasks.require_comments)}/>
          </Row>
        </div>
        <div className="section" style={{marginBottom:20}}>
          <div className="section-title">Auto-Escalation</div>
          <div className="form-field">
            <label className="form-label">Auto-escalate tasks after how many days overdue?</label>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:4}}>
              {[1,2,3,5,7,14,0].map(n=><PillBtn key={n} active={settings.tasks.auto_escalate_days===n} onClick={()=>setT('auto_escalate_days',n)}>{n===0?'Never':`${n} day${n!==1?'s':''}`}</PillBtn>)}
            </div>
          </div>
        </div>
        <SaveFooter/>
      </>}

      {/* ── COMPLIANCE ──────────────────────────── */}
      {activeTab==='compliance'&&<>
        <div className="section" style={{marginBottom:14}}>
          <div className="section-title">Score Target</div>
          <div className="form-field">
            <label className="form-label">Target compliance score</label>
            <div style={{display:'flex',alignItems:'center',gap:12,marginTop:4}}>
              <input type="range" min={50} max={100} step={5} value={settings.compliance.score_target} onChange={e=>setC('score_target',Number(e.target.value))} style={{flex:1,accentColor:'var(--brand)'}}/>
              <div style={{fontSize:20,fontWeight:800,color:'var(--brand)',minWidth:48,textAlign:'right'}}>{settings.compliance.score_target}%</div>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--t2)',marginTop:2}}><span>50%</span><span>75%</span><span>100%</span></div>
          </div>
        </div>
        <div className="section" style={{marginBottom:14}}>
          <div className="section-title">Compliance-Critical Categories</div>
          <div style={{fontSize:12,color:'var(--t2)',marginBottom:10}}>Tasks in these categories will always be flagged as compliance-critical.</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {Object.keys(CAT_ICONS).map(cat=>{
              const active=settings.compliance.critical_categories.includes(cat)
              return <button key={cat} onClick={()=>setC('critical_categories',active?settings.compliance.critical_categories.filter(c=>c!==cat):[...settings.compliance.critical_categories,cat])} style={{display:'flex',alignItems:'center',gap:5,padding:'5px 10px',borderRadius:6,border:'1px solid '+(active?'var(--brand)':'var(--border)'),background:active?'var(--brand-lt)':'transparent',color:active?'var(--brand)':'var(--t2)',cursor:'pointer',fontSize:12,fontWeight:active?700:400,fontFamily:'inherit'}}>{CAT_ICONS[cat]} {cat.replace(/_/g,' ')}</button>
            })}
          </div>
        </div>
        <div className="section" style={{marginBottom:20}}>
          <div className="section-title">Review Deadline Reminders</div>
          <div style={{fontSize:12,color:'var(--t2)',marginBottom:10}}>Send reminder notifications this many days before a task is due.</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {[1,2,3,5,7].map(n=>{
              const active=settings.compliance.reminder_days.includes(n)
              return <PillBtn key={n} active={active} onClick={()=>setC('reminder_days',active?settings.compliance.reminder_days.filter(d=>d!==n):[...settings.compliance.reminder_days,n].sort((a,b)=>a-b))}>{n} day{n!==1?'s':''} before</PillBtn>
            })}
          </div>
        </div>
        <SaveFooter/>
      </>}

      {/* ── BRANDING ────────────────────────────── */}
      {activeTab==='branding'&&<>
        <div className="section" style={{marginBottom:14}}>
          <div className="section-title">Logo</div>
          <div style={{display:'flex',alignItems:'center',gap:14}}>
            <div style={{width:80,height:80,borderRadius:10,border:'2px dashed var(--border)',background:'var(--s3)',display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',flexShrink:0}}>
              {form.logo?<img src={form.logo} alt="logo" style={{width:'100%',height:'100%',objectFit:'contain'}}/>:<span style={{fontSize:28}}>🏢</span>}
            </div>
            <div>
              <div style={{display:'flex',gap:6,marginBottom:4}}>
                <label className="btn btn-secondary btn-sm" style={{cursor:'pointer'}}>{form.logo?'Change':'Upload Logo'}<input type="file" accept="image/*" style={{display:'none'}} onChange={e=>{ const fl=e.target.files[0]; if(!fl) return; const r=new FileReader(); r.onload=ev=>setForm(p=>({...p,logo:ev.target.result})); r.readAsDataURL(fl); e.target.value='' }}/></label>
                {form.logo&&<button className="btn btn-danger btn-sm" onClick={()=>setForm(p=>({...p,logo:''}))}>Remove</button>}
              </div>
              <div style={{fontSize:11,color:'var(--t2)'}}>Appears in reports and emails. Recommended: 400×200px.</div>
            </div>
          </div>
        </div>
        <div className="section" style={{marginBottom:14}}>
          <div className="section-title">Brand Colour</div>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <input type="color" value={settings.branding.primary_color} onChange={e=>setB('primary_color',e.target.value)} style={{width:48,height:38,borderRadius:6,border:'1px solid var(--border)',cursor:'pointer',padding:2,background:'transparent'}}/>
            <div><div style={{fontSize:13,fontWeight:600}}>{settings.branding.primary_color}</div><div style={{fontSize:11,color:'var(--t2)'}}>Used in report headers and accent colours</div></div>
            <button className="btn btn-secondary btn-sm" onClick={()=>setB('primary_color','#00A87E')}>Reset</button>
          </div>
        </div>
        <div className="section" style={{marginBottom:20}}>
          <div className="section-title">Report Text</div>
          <div className="form-field"><label className="form-label">Report Header Text</label><input className="form-input" placeholder="e.g. Confidential — For internal use only" value={settings.branding.report_header} onChange={e=>setB('report_header',e.target.value)}/></div>
          <div className="form-field"><label className="form-label">Report Footer Text</label><input className="form-input" placeholder="e.g. © 2025 Company Name · All rights reserved" value={settings.branding.report_footer} onChange={e=>setB('report_footer',e.target.value)}/></div>
        </div>
        <SaveFooter/>
      </>}

      {/* ── TEMPLATES ───────────────────────────── */}
      {activeTab==='templates'&&<>
        <div className="section" style={{marginBottom:14}}>
          <div className="section-title">Existing Templates</div>
          {tplList.length===0?<div style={{fontSize:13,color:'var(--t2)'}}>No templates yet — create one below.</div>:(
            tplList.map(t=>(
              <div key={t.id} style={{background:'var(--s3)',border:'1px solid var(--border)',borderRadius:10,padding:12,marginBottom:8}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                  <div style={{fontWeight:700,fontSize:13}}>{t.name}</div>
                  <button className="btn btn-danger btn-sm" onClick={()=>deleteTemplate(t.id)}>🗑</button>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:3}}>
                  {(t.items||[]).map((item,i)=>(
                    <div key={i} style={{fontSize:12,color:'var(--t2)',display:'flex',alignItems:'center',gap:6}}>
                      <span>◽</span>
                      <span>{item.text}</span>
                      {item.mandatory&&<span style={{color:'var(--red)',fontWeight:700,fontSize:10}}>mandatory</span>}
                      {item.requirePhoto&&<span style={{fontSize:10}}>📷</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="section" style={{marginBottom:20}}>
          <div className="section-title">Create New Template</div>
          <div className="form-field">
            <label className="form-label">Template Name</label>
            <input className="form-input" placeholder="e.g. Daily Kitchen Clean" value={tplName} onChange={e=>setTplName(e.target.value)}/>
          </div>
          <div className="form-field">
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
              <label className="form-label" style={{margin:0}}>Checklist Items</label>
              <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setTplItems(p=>[...p,{text:'',mandatory:false,requirePhoto:false}])}>+ Add Item</button>
            </div>
            {tplItems.map((s,i)=>(
              <div key={i} className="cl-build-item">
                <input className="form-input" style={{flex:1,fontSize:12}} placeholder={"Item "+(i+1)} value={s.text} onChange={e=>setTplItems(p=>p.map((x,j)=>j===i?{...x,text:e.target.value}:x))}/>
                <button type="button" className="cl-flag-btn" title="Mandatory" style={{border:'1px solid '+(s.mandatory?'var(--red)':'var(--border)'),background:s.mandatory?'rgba(239,68,68,.08)':'none',color:s.mandatory?'var(--red)':'var(--t2)'}} onClick={()=>setTplItems(p=>p.map((x,j)=>j===i?{...x,mandatory:!x.mandatory}:x))}><strong>*</strong></button>
                <button type="button" className="cl-flag-btn" title="Require photo" style={{border:'1px solid '+(s.requirePhoto?'#3B82F6':'var(--border)'),background:s.requirePhoto?'rgba(59,130,246,.08)':'none',color:s.requirePhoto?'#3B82F6':'var(--t2)'}} onClick={()=>setTplItems(p=>p.map((x,j)=>j===i?{...x,requirePhoto:!x.requirePhoto}:x))}>📷</button>
                {tplItems.length>1&&<button type="button" className="cl-flag-btn" style={{border:'1px solid rgba(239,68,68,.2)',background:'rgba(239,68,68,.04)',color:'var(--red)'}} onClick={()=>setTplItems(p=>p.filter((_,j)=>j!==i))}>×</button>}
              </div>
            ))}
            <div style={{fontSize:10,color:'var(--t2)',marginTop:4}}>
              <strong style={{color:'var(--red)'}}>*</strong> = mandatory (blocks submit) · 📷 = requires photo evidence
            </div>
          </div>
          <button className="btn btn-primary" onClick={saveTemplate} disabled={tplSaving}>{tplSaving?'Saving…':'Save Template'}</button>
        </div>
        <MsgBanner/>
      </>}

      {/* ── DATA & PRIVACY ──────────────────────── */}
      {activeTab==='data'&&(()=>{
        const PLAN_RETENTION = {
          personal:     { days:30,    label:'30 days',  display:'Personal' },
          starter:      { days:180,   label:'6 months', display:'Starter' },
          growth:       { days:365,   label:'12 months',display:'Growth' },
          professional: { days:730,   label:'2 years',  display:'Professional' },
          enterprise:   { days:2555,  label:'7 years',  display:'Enterprise' },
        }
        const planKey = orgPlan || 'growth'
        const planCfg = PLAN_RETENTION[planKey] || PLAN_RETENTION.growth
        const isPro = planKey==='professional'
        const isEnt = planKey==='enterprise'
        const isAdminRole = ['client_admin','super_admin'].includes(user.role)
        const effectiveDays = isEnt
          ? (orgRetentionYears ? orgRetentionYears*365 : planCfg.days)
          : (isPro && orgRetentionExtended ? 2555 : planCfg.days)
        const effectiveLabel = isEnt
          ? (orgRetentionYears ? `${orgRetentionYears} year${orgRetentionYears!==1?'s':''}` : planCfg.label)
          : (isPro && orgRetentionExtended ? '7 years' : planCfg.label)
        const PLAN_COLOR = { personal:'#6B7280', starter:'#3B82F6', growth:'#10B981', professional:'#8B5CF6', enterprise:'#F59E0B' }
        const planColor = PLAN_COLOR[planKey] || '#6B7280'

        const saveRetention = async () => {
          if (!orgId || !isConfigured()) return
          setSavingRetention(true)
          const yrs = parseInt(retentionYearsInput,10)
          const payload = isEnt ? { retention_years: yrs>=7?yrs:7 } : {}
          const { error } = await supabase.from('organisations').update(payload).eq('id',orgId)
          if (!error) {
            if (isEnt) { setOrgRetentionYears(yrs>=7?yrs:7); setRetentionYearsInput(String(yrs>=7?yrs:7)) }
            setMsg('✓ Retention settings saved')
          } else { setMsg('✗ '+error.message) }
          setSavingRetention(false)
        }

        return <>
          {showContactModal&&(
            <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={()=>setShowContactModal(false)}>
              <div style={{background:'var(--bg)',borderRadius:14,padding:24,maxWidth:420,width:'100%',boxShadow:'0 8px 32px rgba(0,0,0,.2)'}} onClick={e=>e.stopPropagation()}>
                <div style={{fontSize:16,fontWeight:700,marginBottom:6}}>Request 7-Year Retention Upgrade</div>
                <div style={{fontSize:13,color:'var(--t2)',marginBottom:16}}>Contact our team to upgrade your data retention to 7 years. We'll enable this on your account within 1 business day.</div>
                <div style={{background:'var(--s2)',borderRadius:8,padding:'12px 14px',marginBottom:16,fontSize:12,color:'var(--t2)'}}>
                  <div style={{marginBottom:4}}>📧 <strong>Email:</strong> support@taksyn.com</div>
                  <div>💬 <strong>Subject:</strong> Retention upgrade – {user.org}</div>
                </div>
                <button className="btn btn-primary" style={{width:'100%'}} onClick={()=>setShowContactModal(false)}>Close</button>
              </div>
            </div>
          )}

          <div className="section" style={{marginBottom:14}}>
            <div className="section-title">Data Retention Policy</div>
            <div style={{background:'var(--s2)',borderRadius:10,padding:'14px 16px',border:'1px solid var(--border)'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                <span style={{fontSize:11,fontWeight:700,color:planColor,background:`${planColor}18`,border:`1px solid ${planColor}30`,borderRadius:6,padding:'2px 10px',letterSpacing:'.4px',textTransform:'uppercase'}}>{planCfg.display}</span>
                <span style={{fontSize:11,color:'var(--t2)'}}>plan</span>
              </div>
              <div style={{fontSize:13,color:'var(--text)',lineHeight:1.55}}>
                Your task and audit log data is automatically retained for <strong>{effectiveLabel}</strong> in line with your {planCfg.display} subscription.
              </div>
              <div style={{fontSize:11,color:'var(--t3)',marginTop:8}}>
                Data older than {effectiveLabel} is soft-archived automatically — never permanently deleted.
              </div>
            </div>
          </div>

          {isPro&&!orgRetentionExtended&&(
            <div className="section" style={{marginBottom:14,border:'1px solid rgba(139,92,246,.25)',background:'rgba(139,92,246,.04)'}}>
              <div className="section-title" style={{color:'#8B5CF6'}}>Extend retention to 7 years</div>
              <div style={{fontSize:13,color:'var(--t2)',marginBottom:12}}>Upgrade your data retention to 7 years for full compliance and long-term reporting. Ideal for NDIS providers, aged care, and clinical practices.</div>
              <button className="btn btn-primary" style={{background:'#8B5CF6',border:'none'}} onClick={()=>setShowContactModal(true)}>Request upgrade</button>
            </div>
          )}

          {isEnt&&isAdminRole&&(
            <div className="section" style={{marginBottom:14}}>
              <div className="section-title">Custom Retention Period</div>
              <div style={{fontSize:13,color:'var(--t2)',marginBottom:12}}>Set a custom retention period for your organisation. Minimum 7 years.</div>
              <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <input className="form-input" type="number" min="7" max="50" style={{width:80,textAlign:'center'}} value={retentionYearsInput} onChange={e=>setRetentionYearsInput(e.target.value)}/>
                  <span style={{fontSize:13,color:'var(--t2)'}}>years</span>
                </div>
                <button className="btn btn-primary btn-sm" onClick={saveRetention} disabled={savingRetention}>{savingRetention?'Saving…':'Save'}</button>
              </div>
              {orgRetentionYears&&<div style={{fontSize:11,color:'var(--t3)',marginTop:8}}>Current setting: {orgRetentionYears} years ({orgRetentionYears*365} days)</div>}
              <MsgBanner/>
            </div>
          )}

          <div className="section" style={{marginBottom:14}}>
            <div className="section-title">Export Data</div>
            <div style={{fontSize:13,color:'var(--t2)',marginBottom:12}}>Download all task records for your organisation as a CSV file.</div>
            <button className="btn btn-secondary" onClick={exportCSV} disabled={exporting}>{exporting?'Exporting…':'⬇ Export All Tasks as CSV'}</button>
          </div>
        </>
      })()}

      {activeTab==='team'&&(()=>{
        const TM_BTN = {fontSize:11,padding:'3px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--s3)',cursor:'pointer',fontFamily:'inherit',color:'var(--text)'}
        const TM_INPUT = {fontSize:12,padding:'5px 8px',borderRadius:6,border:'1px solid var(--border)',background:'var(--bg)',color:'var(--text)',fontFamily:'inherit',flex:1,minWidth:0}
        const TM_SAVE_BTN = {fontSize:11,padding:'3px 10px',borderRadius:6,border:'none',background:'var(--primary)',color:'#fff',cursor:'pointer',fontFamily:'inherit'}
        const TM_DEL_BTN = {fontSize:11,padding:'3px 8px',borderRadius:6,border:'1px solid var(--red)',color:'var(--red)',background:'transparent',cursor:'pointer',fontFamily:'inherit'}
        const TM_MOVE_BTN = {fontSize:11,padding:'2px 6px',borderRadius:4,border:'1px solid var(--border)',background:'var(--s3)',cursor:'pointer',fontFamily:'inherit',color:'var(--t2)',lineHeight:1}

        const allOrgInds = [...tmGlobalInds.map(i=>({...i,global:true})), ...tmOrgInds.map(i=>({...i,global:false}))]

        return <>
          {/* Sub-tabs for super_admin */}
          {user?.role==='super_admin'&&(
            <div style={{display:'flex',gap:2,background:'var(--s3)',borderRadius:8,padding:3,marginBottom:16,width:'fit-content'}}>
              {[['industries','Industries & Roles'],['positions','Positions'],['global','Global Industries']].map(([k,l])=>(
                <button key={k} onClick={()=>setTmSubTab(k)} style={{padding:'5px 14px',borderRadius:6,border:'none',background:tmSubTab===k?'var(--primary)':'transparent',color:tmSubTab===k?'#fff':'var(--t2)',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>{l}</button>
              ))}
            </div>
          )}
          {user?.role!=='super_admin'&&(
            <div style={{display:'flex',gap:2,background:'var(--s3)',borderRadius:8,padding:3,marginBottom:16,width:'fit-content'}}>
              {[['industries','Industries & Roles'],['positions','Positions']].map(([k,l])=>(
                <button key={k} onClick={()=>setTmSubTab(k)} style={{padding:'5px 14px',borderRadius:6,border:'none',background:tmSubTab===k?'var(--primary)':'transparent',color:tmSubTab===k?'#fff':'var(--t2)',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>{l}</button>
              ))}
            </div>
          )}

          {/* INDUSTRIES & ROLES sub-tab */}
          {tmSubTab==='industries'&&(
            <div className="section" style={{marginBottom:14}}>
              <div className="section-title">Industries</div>
              <div style={{fontSize:12,color:'var(--t2)',marginBottom:12}}>Each industry can have custom roles assigned to it. Global industries are read-only; expand any to add your own roles.</div>

              {allOrgInds.length===0&&<div style={{fontSize:13,color:'var(--t2)'}}>No industries yet.</div>}
              {allOrgInds.map(ind=>{
                const roles=tmRolesFor(ind.name)
                const isExpanded=tmExpanded.has(ind.name)
                return (
                  <div key={ind.id||ind.name} style={{border:'1px solid var(--border)',borderRadius:10,marginBottom:8,overflow:'hidden'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',background:'var(--s2)',cursor:'pointer'}} onClick={()=>tmToggle(ind.name)}>
                      <span style={{fontSize:13,transform:isExpanded?'rotate(90deg)':'none',transition:'transform .15s',color:'var(--t2)',lineHeight:1}}>▶</span>
                      {tmEditInd?.id===ind.id&&!ind.global?(
                        <div style={{display:'flex',gap:6,flex:1,alignItems:'center'}} onClick={e=>e.stopPropagation()}>
                          <input style={TM_INPUT} value={tmEditInd.name} onChange={e=>setTmEditInd({...tmEditInd,name:e.target.value})} onKeyDown={e=>e.key==='Enter'&&tmSaveInd()} autoFocus/>
                          <button style={TM_SAVE_BTN} onClick={tmSaveInd} disabled={tmSaving}>Save</button>
                          <button style={TM_BTN} onClick={()=>setTmEditInd(null)}>Cancel</button>
                        </div>
                      ):(
                        <>
                          <span style={{fontWeight:600,fontSize:13,flex:1}}>{ind.name}</span>
                          {ind.global&&<span style={{fontSize:10,fontWeight:700,color:'var(--t3)',background:'var(--s3)',border:'1px solid var(--border)',borderRadius:4,padding:'1px 6px',letterSpacing:'.3px'}}>GLOBAL</span>}
                          <span style={{fontSize:11,color:'var(--t2)'}}>{roles.length} role{roles.length!==1?'s':''}</span>
                          {!ind.global&&<>
                            <button style={TM_BTN} onClick={e=>{e.stopPropagation();setTmEditInd({...ind})}}>Edit</button>
                            <button style={TM_DEL_BTN} onClick={e=>{e.stopPropagation();tmDeleteInd(ind.id,ind.name)}}>Delete</button>
                          </>}
                        </>
                      )}
                    </div>
                    {isExpanded&&(
                      <div style={{padding:'10px 14px',background:'var(--bg)'}}>
                        {roles.length===0&&<div style={{fontSize:12,color:'var(--t2)',marginBottom:8}}>No roles yet for this industry.</div>}
                        {roles.map((r,ri)=>(
                          <div key={r.id} style={{display:'flex',alignItems:'center',gap:6,marginBottom:6,padding:'6px 8px',background:'var(--s2)',borderRadius:7}}>
                            <div style={{display:'flex',flexDirection:'column',gap:1,marginRight:2}}>
                              <button style={TM_MOVE_BTN} onClick={()=>tmMoveRole(r.id,ind.name,-1)} disabled={ri===0}>▲</button>
                              <button style={TM_MOVE_BTN} onClick={()=>tmMoveRole(r.id,ind.name,1)} disabled={ri===roles.length-1}>▼</button>
                            </div>
                            {tmEditRole?.id===r.id?(
                              <>
                                <input style={TM_INPUT} value={tmEditRole.role_name} onChange={e=>setTmEditRole({...tmEditRole,role_name:e.target.value})} onKeyDown={e=>e.key==='Enter'&&tmSaveRole()} autoFocus/>
                                <button style={TM_SAVE_BTN} onClick={tmSaveRole} disabled={tmSaving}>Save</button>
                                <button style={TM_BTN} onClick={()=>setTmEditRole(null)}>Cancel</button>
                              </>
                            ):(
                              <>
                                <span style={{fontSize:13,flex:1}}>{r.role_name}</span>
                                <button style={TM_BTN} onClick={()=>setTmEditRole({...r})}>Edit</button>
                                <button style={TM_DEL_BTN} onClick={()=>tmDeleteRole(r.id)}>Delete</button>
                              </>
                            )}
                          </div>
                        ))}
                        <div style={{display:'flex',gap:6,marginTop:8}}>
                          <input style={TM_INPUT} placeholder="New role name…" value={tmNewRoleName[ind.name]||''} onChange={e=>setTmNewRoleName(prev=>({...prev,[ind.name]:e.target.value}))} onKeyDown={e=>e.key==='Enter'&&tmAddRole(ind.name)}/>
                          <button style={TM_SAVE_BTN} onClick={()=>tmAddRole(ind.name)} disabled={tmSaving}>Add Role</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              <div style={{display:'flex',gap:6,marginTop:12}}>
                <input style={TM_INPUT} placeholder="New industry name…" value={tmNewIndName} onChange={e=>setTmNewIndName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&tmAddInd()}/>
                <button style={TM_SAVE_BTN} onClick={tmAddInd} disabled={tmSaving}>Add Industry</button>
              </div>
            </div>
          )}

          {/* POSITIONS sub-tab */}
          {tmSubTab==='positions'&&(
            <div className="section" style={{marginBottom:14}}>
              <div className="section-title">Positions</div>
              <div style={{fontSize:12,color:'var(--t2)',marginBottom:12}}>Default positions are fixed and cannot be removed. Add custom positions below.</div>

              {['Manager','Supervisor','Staff Member'].map(p=>(
                <div key={p} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:'var(--s2)',borderRadius:8,marginBottom:6,border:'1px solid var(--border)'}}>
                  <span style={{fontSize:13,flex:1}}>{p}</span>
                  <span style={{fontSize:11,color:'var(--t3)'}}>🔒 Default</span>
                </div>
              ))}

              {tmCustomPos.length>0&&<div style={{marginTop:12,marginBottom:6,fontSize:11,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.4px'}}>Custom Positions</div>}
              {[...tmCustomPos].sort((a,b)=>(a.sort_order??999)-(b.sort_order??999)).map((p,pi)=>(
                <div key={p.id} style={{display:'flex',alignItems:'center',gap:6,marginBottom:6,padding:'6px 8px',background:'var(--s2)',borderRadius:7,border:'1px solid var(--border)'}}>
                  <div style={{display:'flex',flexDirection:'column',gap:1,marginRight:2}}>
                    <button style={TM_MOVE_BTN} onClick={()=>tmMovePos(p.id,-1)} disabled={pi===0}>▲</button>
                    <button style={TM_MOVE_BTN} onClick={()=>tmMovePos(p.id,1)} disabled={pi===tmCustomPos.length-1}>▼</button>
                  </div>
                  {tmEditPos?.id===p.id?(
                    <>
                      <input style={TM_INPUT} value={tmEditPos.position_name} onChange={e=>setTmEditPos({...tmEditPos,position_name:e.target.value})} onKeyDown={e=>e.key==='Enter'&&tmSavePos()} autoFocus/>
                      <button style={TM_SAVE_BTN} onClick={tmSavePos} disabled={tmSaving}>Save</button>
                      <button style={TM_BTN} onClick={()=>setTmEditPos(null)}>Cancel</button>
                    </>
                  ):(
                    <>
                      <span style={{fontSize:13,flex:1}}>{p.position_name}</span>
                      <button style={TM_BTN} onClick={()=>setTmEditPos({...p})}>Edit</button>
                      <button style={TM_DEL_BTN} onClick={()=>tmDeletePos(p.id)}>Delete</button>
                    </>
                  )}
                </div>
              ))}

              <div style={{display:'flex',gap:6,marginTop:12}}>
                <input style={TM_INPUT} placeholder="New position name…" value={tmNewPosName} onChange={e=>setTmNewPosName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&tmAddPos()}/>
                <button style={TM_SAVE_BTN} onClick={tmAddPos} disabled={tmSaving}>Add Position</button>
              </div>
            </div>
          )}

          {/* GLOBAL INDUSTRIES sub-tab (super_admin only) */}
          {tmSubTab==='global'&&user?.role==='super_admin'&&(
            <div className="section" style={{marginBottom:14}}>
              <div className="section-title">Global Industries</div>
              <div style={{fontSize:12,color:'var(--t2)',marginBottom:12}}>These industries appear in every organisation's dropdown. Reorder or edit them here.</div>

              {tmGlobalList.length===0&&<div style={{fontSize:13,color:'var(--t2)'}}>No global industries yet.</div>}
              {tmGlobalList.map((ind,gi)=>(
                <div key={ind.id} style={{display:'flex',alignItems:'center',gap:6,marginBottom:6,padding:'8px 12px',background:'var(--s2)',borderRadius:8,border:'1px solid var(--border)'}}>
                  <div style={{display:'flex',flexDirection:'column',gap:1,marginRight:2}}>
                    <button style={TM_MOVE_BTN} onClick={()=>tmMoveGlobal(ind.id,-1)} disabled={gi===0}>▲</button>
                    <button style={TM_MOVE_BTN} onClick={()=>tmMoveGlobal(ind.id,1)} disabled={gi===tmGlobalList.length-1}>▼</button>
                  </div>
                  {tmEditGlobal?.id===ind.id?(
                    <>
                      <input style={TM_INPUT} value={tmEditGlobal.name} onChange={e=>setTmEditGlobal({...tmEditGlobal,name:e.target.value})} onKeyDown={e=>e.key==='Enter'&&tmSaveGlobal()} autoFocus/>
                      <button style={TM_SAVE_BTN} onClick={tmSaveGlobal} disabled={tmSaving}>Save</button>
                      <button style={TM_BTN} onClick={()=>setTmEditGlobal(null)}>Cancel</button>
                    </>
                  ):(
                    <>
                      <span style={{fontSize:13,flex:1}}>{ind.name}</span>
                      <button style={TM_BTN} onClick={()=>setTmEditGlobal({...ind})}>Edit</button>
                      <button style={TM_DEL_BTN} onClick={()=>tmDeleteGlobal(ind.id)}>Delete</button>
                    </>
                  )}
                </div>
              ))}

              <div style={{display:'flex',gap:6,marginTop:12}}>
                <input style={TM_INPUT} placeholder="New global industry name…" value={tmNewGlobalName} onChange={e=>setTmNewGlobalName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&tmAddGlobal()}/>
                <button style={TM_SAVE_BTN} onClick={tmAddGlobal} disabled={tmSaving}>Add Global Industry</button>
              </div>
            </div>
          )}
        </>
      })()}
    </div>
  )
}

function AuditLogView({ tasks, user, auditLog, setAuditLog }) {
  // Reads directly from audit_logs — history is preserved even after task deletion
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState('timeline')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [orgFilter, setOrgFilter] = useState('')

  const ACTION_CFG = {
    'task.created':           { label:'Task Created',      color:'#10B981', icon:'✚' },
    'task.assigned':          { label:'Task Assigned',     color:'#3B82F6', icon:'↗' },
    'task.status_changed':    { label:'Status Changed',    color:'#3B82F6', icon:'↔' },
    'task.deleted':           { label:'Task Deleted',      color:'#EF4444', icon:'🗑' },
    'task.comment_added':     { label:'Comment Added',     color:'#3B82F6', icon:'💬' },
    'task.evidence_added':    { label:'Evidence Added',    color:'#3B82F6', icon:'📷' },
    'task.evidence_removed':  { label:'Evidence Removed',  color:'#EF4444', icon:'🗑' },
    'task.checklist_toggled':      { label:'Checklist',         color:'#3B82F6', icon:'☑' },
    'checklist_item_completed':    { label:'Item Completed',    color:'#10B981', icon:'✓' },
    'task.approved':          { label:'Approved',          color:'#10B981', icon:'✓' },
    'task.rejected':          { label:'Sent Back',         color:'#EF4444', icon:'✗' },
    'task.escalated':         { label:'Escalated',         color:'#F59E0B', icon:'⚠' },
    'leave.submitted':        { label:'Leave Submitted',   color:'#F59E0B', icon:'📅' },
    'leave.cancelled':        { label:'Leave Cancelled',   color:'#EF4444', icon:'✖' },
    'member.invited':         { label:'Member Invited',    color:'#10B981', icon:'✚' },
    'member.role_changed':    { label:'Role Changed',      color:'#F59E0B', icon:'⬆' },
    'member.edited':          { label:'Member Updated',    color:'#6B7280', icon:'✏' },
    'member.removed':         { label:'Member Removed',    color:'#EF4444', icon:'✖' },
    'session.logout':         { label:'Signed Out',        color:'#6B7280', icon:'→' },
  }

  const getCfg = (action) => ACTION_CFG[action] || { label: action||'Event', color:'#6B7280', icon:'·' }
  const isSA = user.role==='super_admin'

  useEffect(()=>{
    if (!isConfigured()) return
    setLoading(true)
    // super_admin: fetch only structural columns — no entity_name or details
    const cols = isSA ? 'id,org,by,event_type,at,task_title,task_id' : '*'
    const q = supabase.from('audit_log').select(cols).order('at',{ascending:false}).limit(1000)
    ;(isSA ? q : q.eq('org', user.org))
      .then(({data})=>{ if(data) setLogs(data) })
      .catch(()=>{})
      .finally(()=>setLoading(false))
  },[user.org, user.role])

  const fmtTs = (d) => {
    if (!d) return '—'
    const dt = new Date(d); const now = new Date()
    const timeStr = dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
    if (dt.toDateString()===now.toDateString()) return 'Today '+timeStr
    if (dt.toDateString()===new Date(now-86400000).toDateString()) return 'Yesterday '+timeStr
    return dt.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})+' '+timeStr
  }

  const allOrgs = user.role==='super_admin' ? [...new Set(logs.map(e=>e.org).filter(Boolean))].sort() : []

  const filtered = logs.filter(e=>{
    const entryDate = e.at ? e.at.slice(0,10) : ''
    if (search) {
      const s = search.toLowerCase()
      const fields = isSA
        ? [(e.by||''),(e.event_type||''),(e.org||'')]
        : [(e.task_title||''),(e.by||''),(e.details||''),(e.event_type||''),(e.org||'')]
      if (!fields.some(f=>f.toLowerCase().includes(s))) return false
    }
    if (dateFrom && entryDate < dateFrom) return false
    if (dateTo && entryDate > dateTo) return false
    if (typeFilter!=='all' && e.event_type!==typeFilter) return false
    if (orgFilter && e.org!==orgFilter) return false
    return true
  })

  const hasFilters = !!(search||dateFrom||dateTo||typeFilter!=='all'||orgFilter)
  const clearFilters = () => { setSearch(''); setDateFrom(''); setDateTo(''); setTypeFilter('all'); setOrgFilter('') }

  const exportCSV = () => {
    const rows = isSA
      ? [['Date','User','Action','Organisation'], ...filtered.map(e=>[e.at||'', e.by||'', getCfg(e.event_type).label, e.org||''])]
      : [['Date','User','Action','Task','Details','Organisation'], ...filtered.map(e=>[e.at||'', e.by||'', getCfg(e.event_type).label, e.task_title||'', e.details||'', e.org||''])]
    const csv = rows.map(r=>r.map(c=>'"'+String(c||'').replace(/"/g,'""')+'"').join(',')).join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,﻿'+encodeURIComponent(csv)
    a.download = 'activity-log-'+new Date().toISOString().slice(0,10)+'.csv'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  const byEntity = (() => {
    const groups = {}
    filtered.filter(e=>e.task_id).forEach(e=>{
      if (!groups[e.task_id]) groups[e.task_id] = { id:e.task_id, name:e.task_title||e.task_id, events:[] }
      groups[e.task_id].events.push(e)
    })
    return Object.values(groups).sort((a,b)=>(b.events[0]?.at||'')>(a.events[0]?.at||'')?1:-1)
  })()

  const byPerson = (() => {
    const groups = {}
    filtered.forEach(e=>{
      const key = e.by||'Unknown'
      if (!groups[key]) groups[key] = { name:key, events:[] }
      groups[key].events.push(e)
    })
    return Object.values(groups).sort((a,b)=>(b.events[0]?.at||'')>(a.events[0]?.at||'')?1:-1)
  })()

  const EntryRow = ({ e }) => {
    const cfg = getCfg(e.event_type)
    return (
      <div style={{display:'flex',gap:10,padding:'10px 14px',borderBottom:'1px solid var(--border)',alignItems:'flex-start',borderLeft:'3px solid '+cfg.color+'55'}}>
        <div style={{width:28,height:28,borderRadius:'50%',background:cfg.color+'18',color:cfg.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,flexShrink:0,marginTop:1}}>{cfg.icon}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:2}}>
            <span style={{fontSize:12,fontWeight:700,color:cfg.color}}>{cfg.label}</span>
            {!isSA&&e.task_title&&view!=='bytask'&&<span style={{fontSize:12,color:'var(--t1)',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:220}}>{e.task_title}</span>}
          </div>
          {!isSA&&e.details&&<div style={{fontSize:12,color:'var(--t2)',marginBottom:2}}>{e.details}</div>}
          <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
            {view!=='byperson'&&<span style={{fontSize:11,color:'var(--t2)'}}>{e.by||'—'}</span>}
            {isSA&&e.org&&<span style={{fontSize:11,color:'var(--t2)'}}>· {e.org}</span>}
            <span style={{fontSize:11,color:'var(--t2)',marginLeft:'auto'}}>{fmtTs(e.at)}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-title">Activity &amp; History Log</div>
        <div className="ph-sub">{logs.length} events recorded · preserved after task deletion</div>
      </div>
      {isSA&&<div style={{background:'rgba(245,158,11,.06)',border:'1px solid rgba(245,158,11,.25)',borderRadius:10,padding:'10px 14px',marginBottom:14,fontSize:12,color:'#92400E',display:'flex',gap:8,alignItems:'center'}}><span style={{fontSize:15,flexShrink:0}}>🔒</span><span>Showing structural data only: who acted, what type of action, and when. Task names, details, and operational content are not visible to platform support.</span></div>}

      <div className="section" style={{marginBottom:14}}>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
          <input className="form-input" placeholder="Search action, task, person…" value={search} onChange={e=>setSearch(e.target.value)} style={{flex:1,minWidth:180,fontSize:13}}/>
          {user.role==='super_admin'&&allOrgs.length>0&&(
            <select className="form-input" value={orgFilter} onChange={e=>setOrgFilter(e.target.value)} style={{fontSize:13,padding:'6px 10px',minWidth:130}}>
              <option value="">All Orgs</option>
              {allOrgs.map(o=><option key={o} value={o}>{o}</option>)}
            </select>
          )}
          <button className="btn btn-secondary btn-sm" onClick={exportCSV} style={{fontSize:12,whiteSpace:'nowrap'}}>⬇ Export CSV</button>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <select className="form-input" value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} style={{fontSize:12,padding:'5px 8px',flex:1,minWidth:160}}>
            <option value="all">All Event Types</option>
            <optgroup label="Task Events">
              {['task.created','task.assigned','task.status_changed','task.approved','task.rejected','task.escalated','task.deleted'].map(a=><option key={a} value={a}>{ACTION_CFG[a]?.label||a}</option>)}
            </optgroup>
            <optgroup label="Task Activity">
              {['task.comment_added','task.evidence_added','task.evidence_removed','task.checklist_toggled','checklist_item_completed'].map(a=><option key={a} value={a}>{ACTION_CFG[a]?.label||a}</option>)}
            </optgroup>
            <optgroup label="Team &amp; Leave">
              {['member.invited','member.role_changed','member.edited','member.removed','leave.submitted','leave.cancelled'].map(a=><option key={a} value={a}>{ACTION_CFG[a]?.label||a}</option>)}
            </optgroup>
            <optgroup label="Session">
              {['session.logout'].map(a=><option key={a} value={a}>{ACTION_CFG[a]?.label||a}</option>)}
            </optgroup>
          </select>
          <input type="date" className="form-input" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{fontSize:12,padding:'5px 8px'}} title="From date"/>
          <input type="date" className="form-input" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{fontSize:12,padding:'5px 8px'}} title="To date"/>
          {hasFilters&&<button className="btn btn-secondary btn-sm" onClick={clearFilters} style={{fontSize:11,whiteSpace:'nowrap'}}>✕ Clear</button>}
        </div>
      </div>

      <div className="section" style={{padding:0,overflow:'hidden'}}>
        <div style={{display:'flex',gap:0,borderBottom:'1px solid var(--border)'}}>
          {[['timeline','Timeline'],...(isSA?[]:[['bytask','By Entity']]),['byperson','By Person']].map(([k,l])=>(
            <button key={k} onClick={()=>setView(k)} style={{padding:'9px 16px',fontSize:13,fontWeight:600,background:'none',border:'none',borderBottom:view===k?'2px solid var(--brand)':'2px solid transparent',color:view===k?'var(--brand)':'var(--t2)',cursor:'pointer',marginBottom:-1}}>
              {l}
            </button>
          ))}
          <span style={{marginLeft:'auto',fontSize:12,color:'var(--t2)',alignSelf:'center',paddingRight:12}}>{filtered.length} / {logs.length}</span>
        </div>

        {loading ? (
          <div style={{padding:40,textAlign:'center'}}><div className="spinner" style={{margin:'0 auto'}}/></div>
        ) : filtered.length===0 ? (
          <div style={{padding:'40px 20px',textAlign:'center'}}>
            <div style={{fontSize:32,marginBottom:10}}>📋</div>
            <div style={{fontSize:15,fontWeight:700,marginBottom:6}}>{logs.length===0?'No events yet':'No entries found'}</div>
            <div style={{fontSize:13,color:'var(--t2)'}}>{logs.length===0?'Events will appear here as your team takes actions.':'Try adjusting your filters or date range.'}</div>
          </div>
        ) : view==='timeline' ? (
          filtered.map((e,i)=><EntryRow key={e.id||i} e={e}/>)
        ) : view==='bytask' ? (
          byEntity.length===0
            ? <div style={{padding:'40px 20px',textAlign:'center',color:'var(--t2)',fontSize:13}}>No entity-linked events match this filter.</div>
            : byEntity.map(g=>(
              <div key={g.id} style={{borderBottom:'2px solid var(--border)'}}>
                <div style={{padding:'10px 14px',background:'var(--s3)',fontWeight:700,fontSize:13,display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
                  <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{g.name}</span>
                  <span style={{fontSize:11,color:'var(--t2)',fontWeight:400,flexShrink:0}}>{g.events.length} event{g.events.length!==1?'s':''}</span>
                </div>
                {g.events.map((e,i)=><EntryRow key={e.id||i} e={e}/>)}
              </div>
            ))
        ) : (
          byPerson.length===0
            ? <div style={{padding:'40px 20px',textAlign:'center',color:'var(--t2)',fontSize:13}}>No events match this filter.</div>
            : byPerson.map(g=>(
              <div key={g.name} style={{borderBottom:'2px solid var(--border)'}}>
                <div style={{padding:'10px 14px',background:'var(--s3)',display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                  <span style={{fontSize:13,fontWeight:700}}>{g.name}</span>
                  <span style={{marginLeft:'auto',fontSize:11,color:'var(--t2)',fontWeight:400}}>{g.events.length} event{g.events.length!==1?'s':''}</span>
                </div>
                {g.events.map((e,i)=><EntryRow key={e.id||i} e={e}/>)}
              </div>
            ))
        )}
      </div>
    </div>
  )
}


function SuperAdminTaskStats({ tasks, setTasks, loadTasks }) {
  const [orgSearch, setOrgSearch] = useState('')
  const [orphanedTasks, setOrphanedTasks] = useState(null)
  const [orphanScanning, setOrphanScanning] = useState(false)
  const [orphanMsg, setOrphanMsg] = useState('')
  
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

      <div className="section" style={{marginTop:16}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12,flexWrap:'wrap',gap:8}}>
          <div>
            <div className="section-title" style={{margin:0}}>Orphaned Task Assignment Cleanup</div>
            <div style={{fontSize:11,color:'var(--t2)',marginTop:2}}>Find tasks assigned to users who are no longer in their organisation</div>
          </div>
          <button className="btn btn-secondary btn-sm" disabled={orphanScanning} onClick={async()=>{
            setOrphanScanning(true); setOrphanMsg(''); setOrphanedTasks(null)
            try {
              const {data:members} = await supabase.from('org_members').select('user_id,org')
              const memberSet = new Set((members||[]).map(m=>m.user_id+'|'+m.org))
              const orphaned = tasks.filter(t=>t.assigned_user_id && t.org && !memberSet.has(t.assigned_user_id+'|'+t.org) && !['completed','approved'].includes(t.status))
              setOrphanedTasks(orphaned)
              if(orphaned.length===0) setOrphanMsg('✅ No orphaned assignments found — all tasks are assigned to current members.')
            } catch(e) { setOrphanMsg('Error scanning: '+e.message) }
            setOrphanScanning(false)
          }}>{orphanScanning?'Scanning…':'🔍 Scan for Orphaned Assignments'}</button>
        </div>
        {orphanMsg&&<div style={{fontSize:12,color:orphanMsg.startsWith('✅')?'var(--green)':'var(--red)',marginBottom:10,padding:'8px 12px',background:orphanMsg.startsWith('✅')?'rgba(16,185,129,.08)':'rgba(239,68,68,.06)',borderRadius:6,border:'1px solid '+(orphanMsg.startsWith('✅')?'rgba(16,185,129,.2)':'rgba(239,68,68,.2)')}}>{orphanMsg}</div>}
        {orphanedTasks&&orphanedTasks.length>0&&(
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <div style={{fontSize:12,color:'var(--red)',fontWeight:600}}>⚠️ {orphanedTasks.length} task{orphanedTasks.length!==1?'s':''} with orphaned assignments</div>
              <button className="btn btn-danger btn-sm" onClick={async()=>{
                if(!confirm('Unassign all '+orphanedTasks.length+' tasks? The assigned_user_name is kept for history.')) return
                const ids = orphanedTasks.map(t=>t.id)
                await supabase.from('tasks').update({assigned_user_id:null}).in('id',ids)
                if(loadTasks) await loadTasks()
                else if(setTasks) setTasks(prev=>prev.map(t=>ids.includes(t.id)?{...t,assigned_user_id:null}:t))
                setOrphanedTasks([])
                setOrphanMsg('✅ '+ids.length+' task'+( ids.length!==1?'s':'')+' unassigned. History preserved.')
              }}>Unassign All</button>
            </div>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead><tr style={{background:'var(--s3)'}}>
                  {['Task','Organisation','Assigned To (removed)','Status','Due'].map(h=>(
                    <th key={h} style={{padding:'6px 10px',textAlign:'left',fontSize:10,textTransform:'uppercase',color:'var(--t2)',fontWeight:600,whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                  <th style={{padding:'6px 10px'}}></th>
                </tr></thead>
                <tbody>
                  {orphanedTasks.map(t=>(
                    <tr key={t.id} style={{borderBottom:'1px solid var(--border)'}}>
                      <td style={{padding:'8px 10px',fontWeight:600,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.title}</td>
                      <td style={{padding:'8px 10px',color:'var(--t2)'}}>{t.org}</td>
                      <td style={{padding:'8px 10px',color:'var(--red)',textDecoration:'line-through'}}>{t.assigned_user_name||t.assigned_user_id}</td>
                      <td style={{padding:'8px 10px'}}><StatusBadge status={t.status}/></td>
                      <td style={{padding:'8px 10px',color:'var(--t2)'}}>{t.due_date}</td>
                      <td style={{padding:'8px 10px'}}>
                        <button className="btn btn-secondary btn-sm" style={{fontSize:11}} onClick={async()=>{
                          await supabase.from('tasks').update({assigned_user_id:null}).eq('id',t.id)
                          if(setTasks) setTasks(prev=>prev.map(x=>x.id===t.id?{...x,assigned_user_id:null}:x))
                          setOrphanedTasks(prev=>prev.filter(x=>x.id!==t.id))
                        }}>Unassign</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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

  const isCA = ['client_admin','super_admin'].includes(user.role)

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
  const [orgMembers, setOrgMembers] = useState([]) // [{id, name, role}]

  useEffect(()=>{
    if(!isConfigured()||!user.org) return
    supabase.from('org_members').select('user_id,role').eq('org',user.org)
      .then(async({data:members})=>{
        if(members?.length) {
          const {data:profiles} = await supabase.from('profiles').select('id,name,role').in('id',members.map(m=>m.user_id))
          if(profiles) setOrgMembers(profiles.map(p=>({
            id: p.id,
            name: p.name||'',
            role: members.find(m=>m.user_id===p.id)?.role || p.role || 'worker'
          })))
        } else {
          // Fallback: org may be stored as name in profiles but as ID in org_members
          const {data:fallback} = await supabase.from('profiles').select('id,name,role').eq('org',user.org)
          if(fallback?.length) setOrgMembers(fallback.map(p=>({id:p.id,name:p.name||'',role:p.role||'worker'})))
        }
      }).catch(()=>{})
  },[user.org])

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

  // Build a Set of confirmed org member IDs for fast lookup
  const memberIdSet = new Set(orgMembers.map(m=>m.id))
  // Also build name→id map to resolve tasks that only have a name
  const memberNameMap = {}
  orgMembers.forEach(m=>{ if(m.name) memberNameMap[m.name.toLowerCase().trim()]=m.id })

  // Build per-person stats — only for confirmed org members
  const peopleMap = {}

  // Initialise an entry for every confirmed org member so members with zero tasks
  // still appear (empty stats) rather than being silently absent
  orgMembers.forEach(m=>{
    peopleMap[m.id] = {
      id:m.id, name:m.name, role:m.role,
      total:0, done:0, onTime:0, rejected:0, overdue:0,
      avgMins:[], submitted:0, reviewedInTime:0,
      clDone:0, clTotal:0, slaTotal:0, slaOnTime:0
    }
  })

  pt.forEach(t=>{
    // Skip unassigned / ghost tasks
    if (!t.assigned_user_id && !t.assigned_user_name) return
    if (!t.assigned_user_name || t.assigned_user_name.trim().toLowerCase()==='unassigned') return

    // Resolve canonical member ID: prefer assigned_user_id, fall back to name lookup
    const resolvedId = (t.assigned_user_id && memberIdSet.has(t.assigned_user_id))
      ? t.assigned_user_id
      : memberNameMap[t.assigned_user_name?.toLowerCase().trim()]

    // Drop tasks not belonging to a confirmed org member
    if (!resolvedId) return

    const p = peopleMap[resolvedId]
    if (!p) return

    // Skip tasks that fell on the worker's leave days
    if (t.due_date && leaveDaysByUser[resolvedId]?.has(t.due_date)) return

    p.total++
    parseSafe(t.subtasks).forEach(s=>{ p.clTotal++; if(s.done) p.clDone++ })
    if(['completed','approved'].includes(t.status)){
      p.done++
      if(t.due_date&&t.completed_at&&new Date(t.completed_at)<=new Date(t.due_date)) p.onTime++
      if(t.started_at&&t.completed_at) p.avgMins.push((new Date(t.completed_at)-new Date(t.started_at))/60000)
    }
    if(t.status==='rejected') p.rejected++
    if(t.status==='overdue') p.overdue++
    if(['awaiting_review','approved','rejected'].includes(t.status)) p.submitted++
    if(t.reviewed_at && t.submitted_at) {
      const slaMinutes = getSLAMinutes(t.priority, null)
      const reviewMinutes = (new Date(t.reviewed_at)-new Date(t.submitted_at))/60000
      p.slaTotal++
      if(reviewMinutes<=slaMinutes) p.slaOnTime++
    }
    if(t.reviewed_at&&t.submitted_at&&(new Date(t.reviewed_at)-new Date(t.submitted_at))<=86400000) p.reviewedInTime++
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
                    ['Checklist',p.clTotal>0?pct(p.clDone,p.clTotal)+'%':'—',p.clTotal>0&&pct(p.clDone,p.clTotal)>=80?'#10B981':p.clTotal>0?'#F59E0B':'#6B7280'],
                    ['Rejected',p.rejected,p.rejected>0?'#EF4444':'#6B7280'],
                    ['Overdue',p.overdue,p.overdue>0?'#EF4444':'#6B7280'],
                    ['Avg Time',fmtAvg(p.avgMins),'#8B5CF6'],
                    ['Response Time Met',p.slaTotal>0?pct(p.slaOnTime,p.slaTotal)+'%':'—',p.slaTotal>0&&pct(p.slaOnTime,p.slaTotal)>=80?'#10B981':'#EF4444'],
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
              {(()=>{ const clTot=people.reduce((a,p)=>a+p.clTotal,0); const clDn=people.reduce((a,p)=>a+p.clDone,0); return clTot>0?<div>☑ Checklist completion: <strong style={{color:'var(--text)'}}>{pct(clDn,clTot)}%</strong> ({clDn}/{clTot} items)</div>:null })()}
              <div>⭐ Top performer: <strong style={{color:'var(--text)'}}>{people.sort((a,b)=>pct(b.done,b.total)-pct(a.done,a.total))[0]?.name||'—'}</strong></div>
              <div>⚠️ Needs attention: <strong style={{color:'var(--red)'}}>{people.filter(p=>pct(p.done,p.total)<50).map(p=>p.name).join(', ')||'None'}</strong></div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}


function LeaveView({ user, tasks, setAuditLog }) {
  const [leaves, setLeaves] = useState([])
  const [showApply, setShowApply] = useState(false)
  const [form, setForm] = useState({ type:'annual_leave', date_from:'', date_to:'', reason:'', replacement_id:'', replacement_name:'' })
  const [saving, setSaving] = useState(false)
  const [teamLeaves, setTeamLeaves] = useState([])
  const isCA = ['client_admin','super_admin'].includes(user.role)
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
    if (setAuditLog) {
      const lvEntry = mkAuditEntry('leave_submitted', user, user.org, { dateFrom:form.date_from, dateTo:form.date_to }, null, null, null, (LEAVE_LABELS[form.type]||form.type)+' '+form.date_from+' – '+form.date_to)
      setAuditLog(prev=>[lvEntry,...prev])
      if (isConfigured()) supabase.from('audit_log').insert(lvEntry).then(({error})=>{ if(error) console.warn('audit_log insert error:', error.message) })
    }
    logAuditEvent(user, 'leave.submitted', 'leave', entry.id, LEAVE_LABELS[form.type]||form.type, form.date_from+' – '+form.date_to+(form.reason?' · '+form.reason.slice(0,100):''))
    setShowApply(false)
    setForm({ type:'annual_leave', date_from:'', date_to:'', reason:'' })
    setSaving(false)
  }

  const deleteLeave = async (id) => {
    if(!confirm('Cancel this leave request?')) return
    const lv = leaves.find(l=>l.id===id)
    if(isConfigured()) await supabase.from('leave_records').delete().eq('id',id)
    setLeaves(prev=>prev.filter(l=>l.id!==id))
    setTeamLeaves(prev=>prev.filter(l=>l.id!==id))
    if (setAuditLog) {
      const lcEntry = mkAuditEntry('leave_cancelled', user, user.org, {}, null, null, (LEAVE_LABELS[lv?.type]||lv?.type||'')+' '+(lv?.date_from||''), null)
      setAuditLog(prev=>[lcEntry,...prev])
      if (isConfigured()) supabase.from('audit_log').insert(lcEntry).then(({error})=>{ if(error) console.warn('audit_log insert error:', error.message) })
    }
    logAuditEvent(user, 'leave.cancelled', 'leave', id, (LEAVE_LABELS[lv?.type]||lv?.type||'Leave'), (lv?.date_from||'')+' – '+(lv?.date_to||''))
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
  const [orgId, setOrgId] = useState('')
  const [showInviteLink, setShowInviteLink] = useState(false)
  const [inviteLinkRole, setInviteLinkRole] = useState('worker')
  const [inviteLinkPosition, setInviteLinkPosition] = useState('')
  const isCA = ['client_admin','super_admin'].includes(user.role)

  useEffect(()=>{
    if(!isConfigured()) return
    // Load teams in parallel with org data
    supabase.from('teams').select('*').eq('org',user.org).order('name')
      .then(({data})=>{ if(data) setTeams(data) }).catch(()=>{})
    // Load org id and team types first, then load members using both org name and id
    supabase.from('organisations').select('id,team_types').eq('name',user.org).maybeSingle()
      .then(async ({data}) => {
        if(!data) return
        if(data.team_types) setTeamTypes(JSON.parse(data.team_types||'[]'))
        if(data.id) setOrgId(data.id)
        // Fetch org members filtered by both org name and organisation_id for client_admin compatibility
        const { data: members } = await supabase
          .from('org_members').select('user_id,role,org,tier')
          .eq('org', user.org)
        if(!members?.length) return
        const { data: profiles } = await supabase.from('profiles').select('*').in('id', members.map(m=>m.user_id))
        if(profiles) setOrgUsers(profiles.map(p=>({...p, role:members.find(m=>m.user_id===p.id)?.role||p.role})))
      }).catch(()=>{})
  },[user.org])

  const shareInviteLink = async (team) => {
    if (!orgId) { alert('Organisation data is still loading — please wait a moment and try again.'); return }
    const linkId = 'IL' + Date.now() + Math.random().toString(36).slice(2,5)
    // Record the invite in invite_links so we can mark it used on registration
    if (isConfigured()) {
      await supabase.from('invite_links').insert({
        id: linkId,
        org_id: orgId,
        team_id: team.id,
        role: inviteLinkRole,
        position: inviteLinkPosition || null,
        created_by: user.name,
        org: user.org,
        created_at: new Date().toISOString()
      }).catch(()=>{})
    }
    const base = window.location.origin + window.location.pathname
    const params = new URLSearchParams({
      invite: 'true',
      org: orgId,
      team: team.id,
      role: inviteLinkRole,
      position: inviteLinkPosition,
      secret: 'taksyn-secret-2024',
      link: linkId
    })
    const inviteUrl = base + '?' + params.toString()
    const msg = encodeURIComponent(
      `Hi! You've been invited to join ${user.org} on Taksyn as ${ROLE_LABELS[inviteLinkRole]||inviteLinkRole}` +
      (inviteLinkPosition ? ` (${inviteLinkPosition})` : '') +
      ` in the team "${team.name}".\n\nClick the link below to register:\n${inviteUrl}`
    )
    window.open('https://wa.me/?text='+msg, '_blank')
    setShowInviteLink(false)
  }

  const loadTeamMembers = async (teamId) => {
    const {data} = await supabase.from('team_members').select('*').eq('team_id',teamId).eq('org',user.org)
    if(data) {
      const ids = data.map(m=>m.user_id)
      const {data:profiles} = await supabase.from('profiles').select('*').in('id',ids)
      return data.map(m=>({...m, profile:profiles?.find(p=>p.id===m.user_id)||{}, positions:[]}))
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

  const copyInviteLink = async (team) => {
    if (!orgId) { alert('Organisation data is still loading — please wait a moment and try again.'); return }
    const linkId = 'IL' + Date.now() + Math.random().toString(36).slice(2,5)
    if (isConfigured()) {
      await supabase.from('invite_links').insert({
        id: linkId, org_id: orgId, team_id: team.id, role: inviteLinkRole,
        position: inviteLinkPosition || null, created_by: user.name, org: user.org,
        created_at: new Date().toISOString()
      }).catch(()=>{})
    }
    const base = window.location.origin + window.location.pathname
    const params = new URLSearchParams({
      invite: 'true', org: orgId, team: team.id, role: inviteLinkRole,
      position: inviteLinkPosition, secret: 'taksyn-secret-2024', link: linkId
    })
    navigator.clipboard.writeText(base + '?' + params.toString())
      .then(()=>alert('Invite link copied!')).catch(()=>{})
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
                <div style={{display:'flex',gap:6}}>
                  {(isCA||user.role==='manager')&&<button className="btn btn-secondary btn-sm" onClick={()=>setShowInviteLink(!showInviteLink)}>💬 Invite Link</button>}
                  {(isCA||user.role==='manager'||user.role==='supervisor')&&<button className="btn btn-primary btn-sm" onClick={()=>setShowAddMember(true)}><IC n="plus" s={12}/> Add Member</button>}
                </div>
              </div>

              {showInviteLink&&(
                <div style={{background:'rgba(16,185,129,.06)',border:'1px solid rgba(16,185,129,.2)',borderRadius:10,padding:14,marginBottom:14}}>
                  <div style={{fontSize:11,fontWeight:700,color:'#10B981',textTransform:'uppercase',letterSpacing:'.6px',marginBottom:10}}>💬 WhatsApp Invite Link</div>
                  <div className="two-col">
                    <div className="form-field">
                      <label className="form-label">Role</label>
                      <select className="form-select" value={inviteLinkRole} onChange={e=>setInviteLinkRole(e.target.value)}>
                        {ROLES.filter(r=>r!=='super_admin'&&r!=='client_admin').map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    </div>
                    <div className="form-field">
                      <label className="form-label">Position Title <span style={{fontSize:10,color:'var(--t2)',fontWeight:400}}>optional</span></label>
                      <input className="form-input" value={inviteLinkPosition} onChange={e=>setInviteLinkPosition(e.target.value)} placeholder="e.g. Registered Nurse"/>
                    </div>
                  </div>
                  <div style={{fontSize:11,color:'var(--t2)',marginBottom:10,padding:'6px 10px',background:'var(--s3)',borderRadius:6}}>
                    Link will pre-fill: <strong>{selectedTeam.name}</strong> · <strong>{ROLE_LABELS[inviteLinkRole]}</strong>{inviteLinkPosition&&<> · <strong>{inviteLinkPosition}</strong></>}
                  </div>
                  <div style={{display:'flex',gap:8}}>
                    <button className="btn btn-primary btn-sm" onClick={()=>shareInviteLink(selectedTeam)}>💬 Send via WhatsApp</button>
                    <button className="btn btn-secondary btn-sm" onClick={()=>copyInviteLink(selectedTeam)}>📋 Copy Link</button>
                    <button className="btn btn-secondary btn-sm" onClick={()=>setShowInviteLink(false)}>Cancel</button>
                  </div>
                </div>
              )}

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
                          <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid var(--border)',flexWrap:'wrap'}}>
                            <Avatar name={m.profile?.name||m.user_name||'?'} role={m.profile?.role||role} size={32} avatarUrl={m.profile?.avatar_url}/>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontWeight:600,fontSize:13}}>{m.profile?.name||m.user_name||'—'}</div>
                              <div style={{fontSize:11,color:'var(--t2)'}}>{m.role_in_team||m.role||ROLE_LABELS[role]}{m.profile?.industry?' · '+m.profile.industry:''}</div>
                              {m.positions?.length>0&&<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:3}}>{m.positions.map((pos,pi)=><PositionChip key={pi} pos={pos}/>)}</div>}
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


function PlatformAnnouncementsView({ user }) {
  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [targetOrg, setTargetOrg] = useState('all')
  const [orgs, setOrgs] = useState([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(()=>{
    if(!isConfigured()) return
    supabase.from('organisations').select('id,name').order('name')
      .then(({data})=>{ if(data) setOrgs(data) }).catch(()=>{})
    setLoading(true)
    supabase.from('platform_announcements').select('*').order('created_at',{ascending:false}).limit(50)
      .then(({data})=>{ if(data) setAnnouncements(data) }).catch(()=>{}).finally(()=>setLoading(false))
  },[])

  const send = async () => {
    if(!title.trim()) { setMsg('✗ Title is required'); return }
    setSaving(true); setMsg('')
    const row = {
      id:'PA'+Date.now()+Math.random().toString(36).slice(2,5),
      title:title.trim(), body:body.trim(),
      target_org:targetOrg==='all'?null:targetOrg,
      sent_by:user.name, sent_by_id:user.id,
      created_at:new Date().toISOString()
    }
    if(isConfigured()){
      const {error} = await supabase.from('platform_announcements').insert(row)
      if(error){ setMsg('✗ '+error.message); setSaving(false); return }
    }
    setAnnouncements(prev=>[row,...prev])
    setTitle(''); setBody('')
    setMsg('✓ Announcement sent')
    setSaving(false)
  }

  const fmtTs = (d) => {
    if(!d) return '—'
    const dt=new Date(d)
    return dt.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})+' '+dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
  }

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-title">Platform Announcements</div>
        <div className="ph-sub">Send messages to all organisations or a specific one</div>
      </div>

      <div className="section" style={{marginBottom:14}}>
        <div className="section-title">Send Announcement</div>
        <div className="form-field">
          <label className="form-label">Audience</label>
          <select className="form-input" value={targetOrg} onChange={e=>setTargetOrg(e.target.value)}>
            <option value="all">All Organisations</option>
            {orgs.map(o=><option key={o.id} value={o.name}>{o.name}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label className="form-label">Title <span style={{color:'var(--red)'}}>*</span></label>
          <input className="form-input" value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Scheduled maintenance on Saturday"/>
        </div>
        <div className="form-field">
          <label className="form-label">Message</label>
          <textarea className="form-input" value={body} onChange={e=>setBody(e.target.value)} rows={4} style={{resize:'vertical'}} placeholder="Optional body text…"/>
        </div>
        {msg&&<div style={{marginBottom:10,padding:'8px 12px',borderRadius:6,fontSize:13,background:msg.startsWith('✓')?'rgba(16,185,129,.08)':'rgba(239,68,68,.08)',border:'1px solid '+(msg.startsWith('✓')?'rgba(16,185,129,.2)':'rgba(239,68,68,.2)'),color:msg.startsWith('✓')?'var(--green)':'var(--red)'}}>{msg}</div>}
        <button className="btn btn-primary" onClick={send} disabled={saving}>{saving?'Sending…':'📢 Send Announcement'}</button>
      </div>

      <div className="section">
        <div className="section-title">Announcement History</div>
        {loading
          ? <div style={{padding:20,textAlign:'center'}}><div className="spinner" style={{margin:'0 auto'}}/></div>
          : announcements.length===0
            ? <div className="empty"><div className="empty-icon">📢</div><div className="empty-text">No announcements sent yet</div></div>
            : announcements.map((a,i)=>(
              <div key={a.id||i} style={{padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,flexWrap:'wrap',marginBottom:3}}>
                  <span style={{fontSize:13,fontWeight:700}}>{a.title}</span>
                  <span style={{fontSize:10,padding:'2px 8px',borderRadius:10,background:a.target_org?'rgba(59,130,246,.12)':'rgba(16,185,129,.12)',color:a.target_org?'#3B82F6':'#10B981',fontWeight:600,flexShrink:0}}>{a.target_org||'All orgs'}</span>
                </div>
                {a.body&&<div style={{fontSize:12,color:'var(--t2)',marginBottom:3}}>{a.body}</div>}
                <div style={{fontSize:11,color:'var(--t3)'}}>{a.sent_by} · {fmtTs(a.created_at)}</div>
              </div>
            ))}
      </div>
    </div>
  )
}

const PLAN_DEFS = [
  { key:'personal',     label:'Personal',     color:'#6B7280', price:0,   retention:'30 days',  features:['1 user','30-day data retention','Basic task management'] },
  { key:'starter',      label:'Starter',      color:'#3B82F6', price:29,  retention:'6 months', features:['Up to 10 users','6-month retention','Tasks + reports'] },
  { key:'growth',       label:'Growth',       color:'#10B981', price:79,  retention:'12 months',features:['Up to 50 users','12-month retention','Full feature set'] },
  { key:'professional', label:'Professional', color:'#8B5CF6', price:149, retention:'2 years',  features:['Unlimited users','2-year retention','Priority support','Custom SLA'] },
  { key:'enterprise',   label:'Enterprise',   color:'#F59E0B', price:399, retention:'7 years',  features:['Unlimited users','7-year retention','Dedicated support','Custom everything'] },
]

function PlatformSettingsView({ user, sessionTimeout, setSessionTimeout }) {
  const [tab, setTab] = useState('industries')

  // Global Industries state
  const [industries, setIndustries] = useState([])
  const [indLoading, setIndLoading] = useState(false)
  const [newIndName, setNewIndName] = useState('')
  const [editIndId, setEditIndId] = useState(null)
  const [editIndName, setEditIndName] = useState('')
  const [indSaving, setIndSaving] = useState(false)

  // Plans state
  const [plans, setPlans] = useState(PLAN_DEFS.map(p=>({...p})))
  const [editPlanKey, setEditPlanKey] = useState(null)
  const [planSaving, setPlanSaving] = useState(false)
  const [planMsg, setPlanMsg] = useState('')

  // Announcements state
  const [announcements, setAnnouncements] = useState([])
  const [anLoading, setAnLoading] = useState(false)
  const [anTitle, setAnTitle] = useState('')
  const [anBody, setAnBody] = useState('')
  const [anTarget, setAnTarget] = useState('all')
  const [anOrgs, setAnOrgs] = useState([])
  const [anSaving, setAnSaving] = useState(false)
  const [anMsg, setAnMsg] = useState('')

  // Security
  const [secMsg, setSecMsg] = useState('')
  const SESSION_TIMEOUTS = [1,2,5,10,30,60]
  const SESSION_LABELS = {1:'1 min',2:'2 min',5:'5 min',10:'10 min',30:'30 min',60:'1 hour'}

  useEffect(()=>{
    if(!isConfigured()) return
    // Load industries
    setIndLoading(true)
    supabase.from('global_industries').select('*').order('name')
      .then(({data})=>{ if(data) setIndustries(data) }).catch(()=>{}).finally(()=>setIndLoading(false))
    // Load plans from DB if they exist
    supabase.from('platform_plans').select('*')
      .then(({data})=>{ if(data?.length) setPlans(PLAN_DEFS.map(d=>{ const r=data.find(p=>p.name===d.key); return r?{...d,price:r.price_monthly,features:r.features||d.features}:d })) }).catch(()=>{})
    // Load orgs for announcement target
    supabase.from('organisations').select('id,name').order('name')
      .then(({data})=>{ if(data) setAnOrgs(data) }).catch(()=>{})
    // Load announcements
    setAnLoading(true)
    supabase.from('platform_announcements').select('*').order('created_at',{ascending:false}).limit(50)
      .then(({data})=>{ if(data) setAnnouncements(data) }).catch(()=>{}).finally(()=>setAnLoading(false))
  },[])

  // Industry CRUD
  const addInd = async () => {
    const name=newIndName.trim(); if(!name||!isConfigured()) return
    if(industries.find(i=>i.name.toLowerCase()===name.toLowerCase())) return
    setIndSaving(true)
    const {data,error}=await supabase.from('global_industries').insert({name,created_by:user.name,created_at:new Date().toISOString()}).select().single()
    if(!error&&data){setIndustries(prev=>[...prev,data]);setNewIndName('')}
    setIndSaving(false)
  }
  const deleteInd = async (id) => {
    if(!window.confirm('Delete this industry? This cannot be undone.')) return
    await supabase.from('global_industries').delete().eq('id',id).catch(()=>{})
    setIndustries(prev=>prev.filter(i=>i.id!==id))
  }
  const saveIndEdit = async () => {
    const name=editIndName.trim(); if(!name||!editIndId) return
    setIndSaving(true)
    await supabase.from('global_industries').update({name}).eq('id',editIndId).catch(()=>{})
    setIndustries(prev=>prev.map(i=>i.id===editIndId?{...i,name}:i))
    setEditIndId(null); setEditIndName(''); setIndSaving(false)
  }
  const moveInd = async (id,dir) => {
    const idx=industries.findIndex(i=>i.id===id); if(idx<0) return
    const swap=industries[idx+dir]; if(!swap) return
    setIndustries(prev=>{const n=[...prev];n[idx]=swap;n[idx+dir]=industries[idx];return n})
  }

  // Plans save
  const savePlan = async (planKey) => {
    const plan=plans.find(p=>p.key===planKey); if(!plan) return
    setPlanSaving(true); setPlanMsg('')
    const row={name:plan.key,price_monthly:plan.price,retention_days:0,features:plan.features,updated_at:new Date().toISOString()}
    if(isConfigured()) await supabase.from('platform_plans').upsert(row,{onConflict:'name'}).catch(e=>setPlanMsg('✗ '+e.message))
    setEditPlanKey(null); setPlanMsg('✓ Plan saved'); setPlanSaving(false)
    setTimeout(()=>setPlanMsg(''),3000)
  }

  // Announcements send
  const sendAnn = async () => {
    if(!anTitle.trim()){setAnMsg('✗ Title required');return}
    setAnSaving(true); setAnMsg('')
    const row={id:'PA'+Date.now()+Math.random().toString(36).slice(2,5),title:anTitle.trim(),body:anBody.trim(),target_org:anTarget==='all'?null:anTarget,sent_by:user.name,sent_by_id:user.id,created_at:new Date().toISOString()}
    if(isConfigured()){const {error}=await supabase.from('platform_announcements').insert(row);if(error){setAnMsg('✗ '+error.message);setAnSaving(false);return}}
    setAnnouncements(prev=>[row,...prev]); setAnTitle(''); setAnBody(''); setAnMsg('✓ Sent'); setAnSaving(false)
    setTimeout(()=>setAnMsg(''),3000)
  }

  const fmtTs = d => d ? new Date(d).toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})+' '+new Date(d).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '—'
  const TABS=[['industries','Global Industries'],['plans','Subscription Plans'],['announcements','Announcements'],['security','Security']]

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-title">Platform Settings</div>
        <div className="ph-sub">Manage global configuration for the Taksyn platform</div>
      </div>

      <div style={{display:'flex',gap:2,background:'var(--s3)',borderRadius:8,padding:3,marginBottom:16,flexWrap:'wrap'}}>
        {TABS.map(([k,l])=><button key={k} onClick={()=>setTab(k)} style={{flex:'1 1 auto',padding:'6px 10px',borderRadius:6,border:'none',background:tab===k?'#fff':'transparent',color:tab===k?'var(--text)':'var(--t2)',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',boxShadow:tab===k?'0 1px 4px rgba(0,0,0,.1)':'none',whiteSpace:'nowrap'}}>{l}</button>)}
      </div>

      {tab==='industries'&&(
        <div className="section">
          <div style={{display:'flex',gap:8,marginBottom:16}}>
            <input className="form-input" style={{flex:1}} placeholder="New industry name…" value={newIndName} onChange={e=>setNewIndName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addInd()}/>
            <button className="btn btn-primary" onClick={addInd} disabled={indSaving||!newIndName.trim()}>Add Industry</button>
          </div>
          {indLoading ? <div className="spinner" style={{margin:'20px auto'}}/> : industries.length===0 ? (
            <div style={{fontSize:13,color:'var(--t2)',padding:'12px 0'}}>No global industries yet.</div>
          ) : (
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {industries.map((ind,idx)=>(
                <div key={ind.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--s2)'}}>
                  {editIndId===ind.id ? (
                    <>
                      <input className="form-input" style={{flex:1,fontSize:13}} value={editIndName} onChange={e=>setEditIndName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')saveIndEdit();if(e.key==='Escape'){setEditIndId(null);setEditIndName('')}}} autoFocus/>
                      <button className="btn btn-primary btn-sm" onClick={saveIndEdit} disabled={indSaving}>Save</button>
                      <button className="btn btn-secondary btn-sm" onClick={()=>{setEditIndId(null);setEditIndName('')}}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <span style={{fontSize:13,flex:1,fontWeight:500}}>{ind.name}</span>
                      <div style={{display:'flex',gap:4}}>
                        <button style={{background:'none',border:'none',cursor:idx>0?'pointer':'default',opacity:idx>0?1:.3,fontSize:12,padding:'2px 5px'}} onClick={()=>moveInd(ind.id,-1)} disabled={idx===0}>↑</button>
                        <button style={{background:'none',border:'none',cursor:idx<industries.length-1?'pointer':'default',opacity:idx<industries.length-1?1:.3,fontSize:12,padding:'2px 5px'}} onClick={()=>moveInd(ind.id,1)} disabled={idx===industries.length-1}>↓</button>
                        <button className="btn btn-secondary btn-sm" style={{fontSize:11}} onClick={()=>{setEditIndId(ind.id);setEditIndName(ind.name)}}>Edit</button>
                        <button className="btn btn-danger btn-sm" style={{fontSize:11}} onClick={()=>deleteInd(ind.id)}>Delete</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab==='plans'&&(
        <div>
          {planMsg&&<div style={{marginBottom:12,padding:'8px 12px',borderRadius:6,fontSize:13,background:planMsg.startsWith('✓')?'rgba(16,185,129,.08)':'rgba(239,68,68,.08)',border:'1px solid '+(planMsg.startsWith('✓')?'rgba(16,185,129,.2)':'rgba(239,68,68,.2)'),color:planMsg.startsWith('✓')?'var(--green)':'var(--red)'}}>{planMsg}</div>}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:12}}>
            {plans.map(plan=>(
              <div key={plan.key} style={{border:'2px solid '+plan.color+'40',borderRadius:12,padding:'16px',background:'var(--bg)',boxShadow:'0 2px 8px rgba(0,0,0,.06)'}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
                  <span style={{fontSize:11,fontWeight:700,color:plan.color,background:plan.color+'18',border:'1px solid '+plan.color+'30',borderRadius:6,padding:'2px 10px',letterSpacing:'.4px',textTransform:'uppercase'}}>{plan.label}</span>
                </div>
                {editPlanKey===plan.key ? (
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    <div>
                      <div style={{fontSize:11,color:'var(--t2)',marginBottom:4}}>Monthly Price (USD)</div>
                      <input className="form-input" style={{fontSize:13}} type="number" min={0} value={plan.price} onChange={e=>setPlans(prev=>prev.map(p=>p.key===plan.key?{...p,price:Number(e.target.value)}:p))}/>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:'var(--t2)',marginBottom:4}}>Features (one per line)</div>
                      <textarea className="form-input" rows={4} style={{fontSize:12,resize:'vertical'}} value={plan.features.join('\n')} onChange={e=>setPlans(prev=>prev.map(p=>p.key===plan.key?{...p,features:e.target.value.split('\n').filter(Boolean)}:p))}/>
                    </div>
                    <div style={{display:'flex',gap:6}}>
                      <button className="btn btn-primary btn-sm" onClick={()=>savePlan(plan.key)} disabled={planSaving}>Save</button>
                      <button className="btn btn-secondary btn-sm" onClick={()=>setEditPlanKey(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{fontSize:22,fontWeight:800,color:plan.color,marginBottom:4}}>${plan.price}<span style={{fontSize:12,fontWeight:400,color:'var(--t2)'}}>/mo</span></div>
                    <div style={{fontSize:11,color:'var(--t2)',marginBottom:10}}>Retention: {plan.retention}</div>
                    <ul style={{margin:0,padding:'0 0 0 16px',fontSize:12,color:'var(--t2)',lineHeight:1.8}}>
                      {plan.features.map((f,i)=><li key={i}>{f}</li>)}
                    </ul>
                    <button className="btn btn-secondary btn-sm" style={{marginTop:12,width:'100%',fontSize:11}} onClick={()=>setEditPlanKey(plan.key)}>Edit Plan</button>
                  </>
                )}
              </div>
            ))}
          </div>
          <div style={{marginTop:16,padding:'12px 14px',background:'var(--s3)',borderRadius:8,fontSize:11,color:'var(--t2)'}}>
            SQL to create platform_plans table if needed:<br/>
            <code style={{fontFamily:'monospace',display:'block',marginTop:6,color:'var(--text)',lineHeight:1.8,whiteSpace:'pre-wrap'}}>{'CREATE TABLE IF NOT EXISTS platform_plans (\n  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,\n  name text UNIQUE NOT NULL,\n  price_monthly numeric DEFAULT 0,\n  price_yearly numeric DEFAULT 0,\n  retention_days integer DEFAULT 30,\n  features jsonb DEFAULT \'[]\'::jsonb,\n  created_at timestamptz DEFAULT now()\n);'}</code>
          </div>
        </div>
      )}

      {tab==='announcements'&&(
        <div>
          <div className="section" style={{marginBottom:14}}>
            <div className="section-title">Send Announcement</div>
            <div className="form-field"><label className="form-label">Audience</label>
              <select className="form-input" value={anTarget} onChange={e=>setAnTarget(e.target.value)}>
                <option value="all">All Organisations</option>
                {anOrgs.map(o=><option key={o.id} value={o.name}>{o.name}</option>)}
              </select>
            </div>
            <div className="form-field"><label className="form-label">Title <span style={{color:'var(--red)'}}>*</span></label>
              <input className="form-input" value={anTitle} onChange={e=>setAnTitle(e.target.value)} placeholder="e.g. Scheduled maintenance on Saturday"/>
            </div>
            <div className="form-field"><label className="form-label">Message</label>
              <textarea className="form-input" value={anBody} onChange={e=>setAnBody(e.target.value)} rows={4} style={{resize:'vertical'}} placeholder="Optional body text…"/>
            </div>
            {anMsg&&<div style={{marginBottom:10,padding:'8px 12px',borderRadius:6,fontSize:13,background:anMsg.startsWith('✓')?'rgba(16,185,129,.08)':'rgba(239,68,68,.08)',border:'1px solid '+(anMsg.startsWith('✓')?'rgba(16,185,129,.2)':'rgba(239,68,68,.2)'),color:anMsg.startsWith('✓')?'var(--green)':'var(--red)'}}>{anMsg}</div>}
            <button className="btn btn-primary" onClick={sendAnn} disabled={anSaving}>{anSaving?'Sending…':'Send Announcement'}</button>
          </div>
          <div className="section">
            <div className="section-title">History</div>
            {anLoading ? <div style={{padding:20,textAlign:'center'}}><div className="spinner" style={{margin:'0 auto'}}/></div>
              : announcements.length===0 ? <div className="empty"><div className="empty-icon">📢</div><div className="empty-text">No announcements yet</div></div>
              : announcements.map((a,i)=>(
                <div key={a.id||i} style={{padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,flexWrap:'wrap',marginBottom:3}}>
                    <span style={{fontSize:13,fontWeight:700}}>{a.title}</span>
                    <span style={{fontSize:10,padding:'2px 8px',borderRadius:10,background:a.target_org?'rgba(59,130,246,.12)':'rgba(16,185,129,.12)',color:a.target_org?'#3B82F6':'#10B981',fontWeight:600,flexShrink:0}}>{a.target_org||'All orgs'}</span>
                  </div>
                  {a.body&&<div style={{fontSize:12,color:'var(--t2)',marginBottom:3}}>{a.body}</div>}
                  <div style={{fontSize:11,color:'var(--t3)'}}>{a.sent_by} · {fmtTs(a.created_at)}</div>
                </div>
              ))}
          </div>
        </div>
      )}

      {tab==='security'&&(
        <div className="section">
          <div className="section-title">Session Security</div>
          <div style={{fontSize:13,color:'var(--t2)',marginBottom:16}}>Configure auto-logout timeout for your super admin session. This is stored locally and applies only to this device.</div>
          <div style={{background:'var(--s2)',borderRadius:10,padding:'14px 16px',border:'1px solid var(--border)',marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:600,marginBottom:10}}>Auto-logout after inactivity</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>
              {SESSION_TIMEOUTS.map(v=>{
                const active = sessionTimeout===v||(sessionTimeout===null&&v===10)
                return <button key={v} style={{fontSize:12,padding:'6px 14px',borderRadius:6,border:'1px solid '+(active?'var(--brand)':'var(--border)'),background:active?'var(--brand)':'transparent',color:active?'#fff':'var(--t2)',cursor:'pointer',fontFamily:'inherit',fontWeight:active?700:400}} onClick={()=>{
                  const isDefault = v===10
                  if(isDefault) localStorage.removeItem('taksyn_session_timeout'); else localStorage.setItem('taksyn_session_timeout',String(v))
                  setSessionTimeout(isDefault?null:v)
                  setSecMsg('Session timeout set to '+SESSION_LABELS[v])
                  setTimeout(()=>setSecMsg(''),3000)
                }}>{SESSION_LABELS[v]}</button>
              })}
              <button style={{fontSize:12,padding:'6px 14px',borderRadius:6,border:'1px solid '+(sessionTimeout===0?'var(--brand)':'var(--border)'),background:sessionTimeout===0?'var(--brand)':'transparent',color:sessionTimeout===0?'#fff':'var(--t2)',cursor:'pointer',fontFamily:'inherit',fontWeight:sessionTimeout===0?700:400}} onClick={()=>{localStorage.setItem('taksyn_session_timeout','0');setSessionTimeout(0);setSecMsg('Session will never expire');setTimeout(()=>setSecMsg(''),3000)}}>Never</button>
            </div>
            <div style={{fontSize:11,color:'var(--t2)'}}>Default for super admin: <strong>10 min</strong></div>
            {secMsg&&<div style={{marginTop:8,fontSize:12,color:'var(--green)',fontWeight:500}}>{secMsg}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function SuperAdminAccountView({ user, setUser }) {
  const [form, setForm] = useState({name:user.name||'',email:user.email||''})
  const [pwForm, setPwForm] = useState({current:'',next:'',confirm:''})
  const [showPw, setShowPw] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url||'')
  const [uploading, setUploading] = useState(false)

  const save = async () => {
    if(!form.name.trim()){setMsg('✗ Name is required');return}
    setSaving(true); setMsg('')
    const updates = {name:form.name.trim(),email:form.email.trim()}
    if(isConfigured()){
      await supabase.from('profiles').update(updates).eq('id',user.id).catch(e=>setMsg('✗ '+e.message))
      if(form.email!==user.email) await supabase.auth.updateUser({email:form.email}).catch(()=>{})
    }
    if(setUser) setUser(prev=>({...prev,...updates}))
    setMsg('✓ Profile saved')
    setSaving(false)
    setTimeout(()=>setMsg(''),3000)
  }

  const changePw = async () => {
    if(pwForm.next.length<6){setMsg('✗ Password must be at least 6 characters');return}
    if(pwForm.next!==pwForm.confirm){setMsg('✗ Passwords do not match');return}
    setSaving(true); setMsg('')
    const {error} = await supabase.auth.updateUser({password:pwForm.next})
    if(error){setMsg('✗ '+error.message)}else{setMsg('✓ Password changed');setPwForm({current:'',next:'',confirm:''})}
    setSaving(false); setTimeout(()=>setMsg(''),4000)
  }

  const uploadAvatar = async (e) => {
    const file = e.target.files?.[0]; if(!file) return
    setUploading(true); setMsg('')
    try {
      const ext = file.name.split('.').pop()
      const path = `avatars/${user.id}.${ext}`
      const {error:upErr} = await supabase.storage.from('avatars').upload(path,file,{upsert:true})
      if(upErr) throw upErr
      const {data} = supabase.storage.from('avatars').getPublicUrl(path)
      const url = data.publicUrl
      await supabase.from('profiles').update({avatar_url:url}).eq('id',user.id)
      setAvatarUrl(url)
      if(setUser) setUser(prev=>({...prev,avatar_url:url}))
      setMsg('✓ Photo updated')
    } catch(err){setMsg('✗ '+err.message)}
    setUploading(false); setTimeout(()=>setMsg(''),3000)
  }

  return (
    <div className="anim">
      <div className="ph">
        <div className="ph-title">My Account</div>
        <div className="ph-sub">Manage your super admin profile</div>
      </div>

      <div className="section" style={{maxWidth:480,marginBottom:16}}>
        <div className="section-title">Profile Photo</div>
        <div style={{display:'flex',alignItems:'center',gap:16,marginBottom:12}}>
          <Avatar name={form.name||'?'} role="super_admin" size={64} avatarUrl={avatarUrl}/>
          <div>
            <label style={{display:'inline-block',padding:'7px 14px',background:'var(--s3)',border:'1px solid var(--border)',borderRadius:7,fontSize:12,cursor:'pointer',fontFamily:'inherit',color:'var(--text)'}}>
              {uploading?'Uploading…':'Upload Photo'}
              <input type="file" accept="image/*" style={{display:'none'}} onChange={uploadAvatar} disabled={uploading}/>
            </label>
            <div style={{fontSize:11,color:'var(--t2)',marginTop:4}}>PNG, JPG or GIF. Max 5MB.</div>
          </div>
        </div>
      </div>

      <div className="section" style={{maxWidth:480,marginBottom:16}}>
        <div className="section-title">Profile Details</div>
        <div className="form-field"><label className="form-label">Full Name</label>
          <input className="form-input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/>
        </div>
        <div className="form-field"><label className="form-label">Email</label>
          <input className="form-input" type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))}/>
          <div style={{fontSize:10,color:'var(--t2)',marginTop:3}}>Changing email sends a confirmation link to the new address</div>
        </div>
        {msg&&<div style={{marginBottom:10,padding:'8px 12px',borderRadius:6,fontSize:13,background:msg.startsWith('✓')?'rgba(16,185,129,.08)':'rgba(239,68,68,.08)',border:'1px solid '+(msg.startsWith('✓')?'rgba(16,185,129,.2)':'rgba(239,68,68,.2)'),color:msg.startsWith('✓')?'var(--green)':'var(--red)'}}>{msg}</div>}
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':'Save Profile'}</button>
      </div>

      <div className="section" style={{maxWidth:480}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
          <div className="section-title" style={{margin:0}}>Change Password</div>
          <button style={{fontSize:12,color:'var(--brand)',background:'none',border:'none',cursor:'pointer',fontFamily:'inherit'}} onClick={()=>setShowPw(v=>!v)}>{showPw?'Hide':'Show'}</button>
        </div>
        {showPw&&(
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <div className="form-field"><label className="form-label">New Password</label>
              <input className="form-input" type="password" value={pwForm.next} onChange={e=>setPwForm(f=>({...f,next:e.target.value}))} placeholder="Min 6 characters"/>
            </div>
            <div className="form-field"><label className="form-label">Confirm New Password</label>
              <input className="form-input" type="password" value={pwForm.confirm} onChange={e=>setPwForm(f=>({...f,confirm:e.target.value}))} placeholder="Re-enter new password"/>
            </div>
            <button className="btn btn-secondary" onClick={changePw} disabled={saving||!pwForm.next||!pwForm.confirm}>Update Password</button>
          </div>
        )}
      </div>
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
        <div className="ph-title">⚙️ Response Time Settings</div>
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
        <button className="btn btn-primary" disabled={saving} onClick={saveSLA} style={{flex:1}}>{saving?'Saving...':'💾 Save Response Time Settings'}</button>
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
  // Persist the active page in sessionStorage so it survives iOS tab eviction + WhatsApp return.
  const [page, setPage] = useState(()=>sessionStorage.getItem('taksyn-page')||'dashboard')
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
  const [gpsEnabled, setGpsEnabled] = useState(() => { const v = localStorage.getItem('taksyn_gps_enabled'); return v === null ? true : v === 'true' })
  const [sessionWarning, setSessionWarning] = useState(false)
  const [warnCountdown, setWarnCountdown] = useState(120)
  const [sessionTimeout, setSessionTimeout] = useState(() => { const v = localStorage.getItem('taksyn_session_timeout'); return v === null ? null : Number(v) })
  const [undoStack, setUndoStack] = useState([])
  const [showUndo, setShowUndo] = useState(false)
  const [auditLog, setAuditLog] = useState([])
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false)
  const [activePosition, setActivePosition] = useState(null) // selected role assignment for multi-role users
  const [showRoleSelector, setShowRoleSelector] = useState(false)
  const [userPositionsList, setUserPositionsList] = useState([])
  const [tickets, setTickets] = useState([])
  const [leaveRecords, setLeaveRecords] = useState([])
  const [notifications, setNotifications] = useState([])
  const [orgSLA, setOrgSLA] = useState(DEFAULT_SLA)
  const orgSLARef = useRef(DEFAULT_SLA)
  const updateOrgSLA = (val) => { setOrgSLA(val); orgSLARef.current = val }
  const [showNotifPanel, setShowNotifPanel] = useState(false)
  const [notifPrefs, setNotifPrefs] = useState(() => {
    try { const v=localStorage.getItem('taksyn_notif_prefs'); return v?{...DEFAULT_NOTIF_PREFS,...JSON.parse(v)}:DEFAULT_NOTIF_PREFS } catch { return DEFAULT_NOTIF_PREFS }
  })
  const [showNotifSettings, setShowNotifSettings] = useState(false)
  const notifPrefsRef = useRef(notifPrefs)
  useEffect(()=>{ notifPrefsRef.current = notifPrefs },[notifPrefs])
  const notifIdsRef = useRef(new Set())
  useEffect(()=>{ notifIdsRef.current = new Set(notifications.map(n=>n.id)) },[notifications])
  const tasksRef = useRef([])
  useEffect(()=>{ tasksRef.current = tasks },[tasks])
  const undoTimer = useRef(null)
  const idleTimer = useRef(null)
  const countdownTimer = useRef(null)
  const startTimerRef = useRef(null)

  const addNotifications = (newNotifs) => {
    if(!newNotifs.length) return
    const prefs = notifPrefsRef.current
    const allowed = newNotifs.filter(n=>prefs[n.type]!==false)
    if(!allowed.length) return
    const fresh = allowed.filter(n=>!notifIdsRef.current.has(n.id))
    if(!fresh.length) return
    fresh.forEach(n=>notifIdsRef.current.add(n.id))
    setNotifications(prev=>[...fresh,...prev].slice(0,50))
    if(isConfigured()) {
      // user_notifications disabled — fresh.forEach(n=>supabase.from('user_notifications').insert({...n,user_id:user?.id}))
    }
    if(prefs.sound) {
      try { const ctx=new AudioContext(); const o=ctx.createOscillator(); const g=ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.frequency.value=880; g.gain.setValueAtTime(0.1,ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.3); o.start(); o.stop(ctx.currentTime+0.3) } catch{}
    }
  }

  const markNotifRead = (id) => {
    setNotifications(prev=>prev.map(n=>n.id===id?{...n,read:true}:n))
    // if(isConfigured()) supabase.from('user_notifications').update({read:true}).eq('id',id)
  }

  const deleteNotif = (id) => {
    setNotifications(prev=>prev.filter(n=>n.id!==id))
    // if(isConfigured()) supabase.from('user_notifications').delete().eq('id',id)
  }

  const clearAllNotifs = () => {
    setNotifications([])
    // if(isConfigured()) supabase.from('user_notifications').delete().eq('user_id',user?.id)
  }

  const saveNotifPrefs = (prefs) => {
    setNotifPrefs(prefs)
    try { localStorage.setItem('taksyn_notif_prefs', JSON.stringify(prefs)) } catch{}
  }

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

  const SESSION_ROLE_TIMEOUTS = { worker:30, supervisor:30, manager:30, client_admin:30, super_admin:10 }
  const WARN_BEFORE_MINS = 1

  useEffect(() => {
    if (!user) return
    const minutes = sessionTimeout !== null ? sessionTimeout : (SESSION_ROLE_TIMEOUTS[user.role] || 15)
    if (minutes === 0) return // Never timeout

    const warnMs = (minutes - WARN_BEFORE_MINS) * 60 * 1000
    const warnSecs = WARN_BEFORE_MINS * 60

    const startTimer = () => {
      clearTimeout(idleTimer.current)
      clearInterval(countdownTimer.current)
      setSessionWarning(false)
      idleTimer.current = setTimeout(() => {
        setSessionWarning(true)
        setWarnCountdown(warnSecs)
        let rem = warnSecs
        countdownTimer.current = setInterval(() => {
          rem -= 1
          setWarnCountdown(rem)
          if (rem <= 0) {
            clearInterval(countdownTimer.current)
            setSessionWarning(false)
            clearAuthCache()
            setUser(null); setTasks(DEMO_TASKS); setPage('dashboard')
            if (isConfigured()) supabase.auth.signOut().catch(() => {})
          }
        }, 1000)
      }, warnMs)
    }

    startTimerRef.current = startTimer

    let lastFire = 0
    const onActivity = () => {
      const now = Date.now()
      if (now - lastFire < 1000) return
      lastFire = now
      startTimer()
    }

    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'touchmove', 'touchend', 'input', 'click']
    events.forEach(e => window.addEventListener(e, onActivity, { passive: true }))
    startTimer()

    return () => {
      events.forEach(e => window.removeEventListener(e, onActivity))
      clearTimeout(idleTimer.current)
      clearInterval(countdownTimer.current)
      startTimerRef.current = null
    }
  }, [user, sessionTimeout])

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
    if(user?.role==='super_admin') return  // super_admin never loads task content — operational data is private
    const { data } = await supabase.from('tasks').select('*').order('created_at',{ascending:false})
    if(data) {
      const newTasks = data.map(t=>({...t, subtasks:parseSafe(t.subtasks), evidence:parseSafe(t.evidence), comments:parseSafe(t.comments,[])}))
      const prevTasks = tasksRef.current
      // Generate notifications from status changes
      if(prevTasks.length>0 && user) {
        const newNotifs = generateNotifications(newTasks, user, prevTasks)
        if(newNotifs.length>0) addNotifications(newNotifs)
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
            supabase.from('tasks').update({escalation:true, status:'escalated', lastIntervention:'Response time exceeded — auto-escalated'}).eq('id',t.id).then(()=>{
              const slaEntry = mkAuditEntry('task_escalated', user, t.org||user?.org, { reason:'SLA breach — auto-escalated' }, t.id, t.title, 'awaiting_review', 'escalated')
              setAuditLog(prev=>[slaEntry,...prev])
              supabase.from('audit_log').insert(slaEntry).then(({error})=>{ if(error) console.warn('audit_log insert error:', error.message) })
              logAuditEvent(user, 'task.escalated', 'task', t.id, t.title, 'Auto-escalated: SLA breach')
            })
            addNotifications([{id:t.id+'_sla_breach', type:'sla', title:'Response Time Exceeded 🚨', body:`"${t.title}" review deadline exceeded — auto-escalated`, taskId:t.id, at:new Date().toISOString(), read:false, color:'#EF4444'}])
          }
        })
      }
      // Auto-reset completed recurring tasks back to pending
      if(isConfigured()) {
        newTasks.filter(t=>isRecurring(t)&&['approved','completed'].includes(t.status)).forEach(t=>{
          supabase.from('tasks').update({status:'pending',started_at:null,completed_at:null,submitted_at:null,completed_by:null,gps_start:null,gps_end:null,evidence:'[]',comments:'[]'}).eq('id',t.id).then(()=>{})
        })
      }
      setTasks(newTasks)
      loadAuditLog()
    }
  }

  // keep topbar fixed on mobile

  useEffect(()=>{
    if(!isConfigured()) return

    supabase.auth.getSession().then(({data:{session}})=>{
      if(session?.user) {
        supabase.from('profiles').select('*').eq('id',session.user.id).single().then(({data})=>{
          if(data) setUser({...data,email:session.user.email})
        }).catch(()=>{})
      } else {
        setUser(null)
      }
    }).catch(()=>{})

    const {data:{subscription}} = supabase.auth.onAuthStateChange(async(event, session)=>{
      if(event==='SIGNED_OUT') {
        setUser(null)
      } else if(event==='USER_UPDATED') {
        // Password was just set — log them in properly
        try {
          const {data} = await supabase.from('profiles').select('*').eq('id',session.user.id).single()
          if(data) { setUser({...data,email:session.user.email}); setNeedsPasswordSetup(false); if(isConfigured()&&!data.email) supabase.from('profiles').update({email:session.user.email}).eq('id',session.user.id).then(()=>{}) }
        } catch(e) {}
      } else if(event==='SIGNED_IN') {
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
          if(data) setUser({...data,email:session.user.email})
        } catch(e) {}
      }
    })

    return ()=>{ subscription.unsubscribe() }
  },[])

  // user_positions table removed — role selector disabled

  useEffect(()=>{
    if(user&&isConfigured()) {
      loadTasks()
      if(user.role==='super_admin') loadTickets()
      // Load persisted notifications from Supabase
      // user_notifications table not yet created — disabled
      // supabase.from('user_notifications').select('*').eq('user_id',user.id).order('at',{ascending:false}).limit(50)
      // Load org SLA settings
      if(isConfigured()&&user.org) {
        supabase.from('organisations').select('sla_settings,auto_logout_minutes').eq('name',user.org).maybeSingle()
          .then(({data})=>{
            if(data?.sla_settings) updateOrgSLA({...DEFAULT_SLA,...JSON.parse(data.sla_settings)})
            if(data?.auto_logout_minutes!=null) setSessionTimeout(data.auto_logout_minutes)
          })
          .catch(()=>{})
      }
      // Load leave records for org (not for super_admin — leave is operational data)
      if(isConfigured()&&user.org&&user.role!=='super_admin') {
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
    if (user && isConfigured()) {
      const loEntry = mkAuditEntry('logout', user, user.org, {})
      supabase.from('audit_log').insert(loEntry).then(({error})=>{ if(error) console.warn('audit_log insert error:', error.message) })
      logAuditEvent(user, 'session.logout', 'session', null, null, null)
    }
    clearAuthCache()
    setUser(null); setTasks(DEMO_TASKS); setPage('dashboard')
    if(isConfigured()) supabase.auth.signOut().catch(()=>{})
  }

  // Keep sessionStorage in sync so the page is restored after tab eviction or WhatsApp return
  useEffect(()=>{ if(page) sessionStorage.setItem('taksyn-page', page) },[page])

  // Reset to dashboard only when the role genuinely changes mid-session (e.g. admin role update),
  // NOT on the initial mount/restore — otherwise it would override the sessionStorage page.
  const _prevRoleRef = useRef(undefined)
  useEffect(()=>{
    const prev = _prevRoleRef.current
    _prevRoleRef.current = user?.role
    // Skip first run (prev is undefined) — page already set from sessionStorage above
    if(prev !== undefined && prev !== user?.role) setPage('dashboard')
  },[user?.role])

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

        {sessionWarning&&(
          <div style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,.55)',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <div style={{background:'var(--card)',borderRadius:12,padding:28,maxWidth:360,width:'90%',boxShadow:'0 8px 32px rgba(0,0,0,.25)',textAlign:'center'}}>
              <div style={{fontSize:36,marginBottom:8}}>⏱</div>
              <div style={{fontSize:17,fontWeight:700,marginBottom:6}}>Session Expiring Soon</div>
              <div style={{fontSize:13,color:'var(--t2)',marginBottom:16}}>You will be signed out due to inactivity in 1 minute. Tap anywhere to stay signed in.</div>
              <div style={{fontSize:40,fontWeight:800,color:warnCountdown<=30?'var(--red)':'var(--amber)',letterSpacing:1,marginBottom:20,fontVariantNumeric:'tabular-nums'}}>
                {String(Math.floor(warnCountdown/60)).padStart(2,'0')}:{String(warnCountdown%60).padStart(2,'0')}
              </div>
              <button className="btn btn-primary" style={{width:'100%',fontSize:14,padding:'10px 0'}} onClick={()=>startTimerRef.current?.()}>Stay Logged In</button>
              <button className="btn btn-danger" style={{width:'100%',marginTop:8,fontSize:14,padding:'10px 0'}} onClick={()=>{setSessionWarning(false);logout()}}>Sign Out Now</button>
            </div>
          </div>
        )}

        <div className="topbar" style={user.role==='super_admin'?{background:'#0F172A',borderBottom:'1px solid rgba(255,255,255,.06)'}:{}}>
          <button className="tb-menu-btn" style={user.role==='super_admin'?{color:'rgba(255,255,255,.5)'}:{}} onClick={()=>{ if(window.innerWidth<=768) setSidebarOpen(!sidebarOpen); else setSidebarCollapsed(!sidebarCollapsed) }}><IC n="menu" s={18}/></button>
          <img src="/logo.jpeg" alt="Taksyn" className="tb-logo" onClick={()=>navigate('dashboard')}/>
          {user.role==='super_admin'
            ? <><div className="tb-sep" style={{background:'rgba(255,255,255,.1)'}}/><span style={{fontSize:12,fontWeight:700,color:'#F59E0B',letterSpacing:'.5px'}}>PLATFORM ADMIN</span></>
            : <><div className="tb-sep"/><span className="tb-org">{user.org||'My Organisation'}</span></>
          }
          <div className="tb-space"/>
          {user.role!=='super_admin'&&<div className="tb-search"><IC n="search" s={12}/><input placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)}/></div>}
          <button className="tb-icon-btn" style={user.role==='super_admin'?{color:'rgba(255,255,255,.5)'}:{}} onClick={()=>setShowNotifPanel(v=>!v)}>
            <IC n="bell" s={16}/>
            {notifications.filter(n=>!n.read).length>0&&<div className="tb-badge">{notifications.filter(n=>!n.read).length}</div>}
          </button>
          <div className="tb-user" style={user.role==='super_admin'?{color:'rgba(255,255,255,.8)'}:{}} onClick={()=>{ if(user.role==='super_admin') navigate('my_account'); else { setShowProfile(true);setProfileName(user.name);setProfileMsg('') } }}>
            <Avatar name={user.name} role={user.role} size={26} avatarUrl={user.avatar_url}/>
            <div><div className="tb-user-name" style={user.role==='super_admin'?{color:'rgba(255,255,255,.9)'}:{}}>{user.name?.split(' ')[0]}</div><div className="tb-user-role" style={user.role==='super_admin'?{color:'#F59E0B'}:{}}>{ROLE_LABELS[user.role]}</div></div>
          </div>
        </div>

        {/* Notification Panel */}
        {showNotifPanel&&(()=>{
          const now = new Date()
          const today = new Date(now.getFullYear(),now.getMonth(),now.getDate())
          const yesterday = new Date(today); yesterday.setDate(today.getDate()-1)
          const weekAgo = new Date(today); weekAgo.setDate(today.getDate()-7)
          const getGroup = (at) => {
            const d = new Date(at)
            if(d>=today) return 'Today'
            if(d>=yesterday) return 'Yesterday'
            if(d>=weekAgo) return 'This Week'
            return 'Older'
          }
          const grouped = notifications.reduce((acc,n)=>{ const g=getGroup(n.at); if(!acc[g]) acc[g]=[]; acc[g].push(n); return acc },{})
          const groupOrder = ['Today','Yesterday','This Week','Older']
          const unreadCount = notifications.filter(n=>!n.read).length
          const awaitingCount = notifications.filter(n=>n.type==='submitted'&&!n.read).length
          const overdueCount = notifications.filter(n=>n.type==='overdue'&&!n.read).length
          const summaryParts = []
          if(overdueCount>0) summaryParts.push(`${overdueCount} overdue`)
          if(awaitingCount>0) summaryParts.push(`${awaitingCount} awaiting review`)
          const NOTIF_LABELS = { overdue:'Overdue', submitted:'Awaiting review', approved:'Approved', rejected:'Rejected', escalated:'Escalated', assigned:'Assigned', comment:'Comment', sla:'Response Time alert' }
          return (
            <>
              <div style={{position:'fixed',inset:0,zIndex:249}} onClick={()=>{ setShowNotifPanel(false); setShowNotifSettings(false) }}/>
              <div className="notif-panel">
                <div style={{padding:'12px 14px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
                  <div style={{fontWeight:700,fontSize:14}}>🔔 Notifications{unreadCount>0&&<span style={{marginLeft:6,background:'var(--brand)',color:'#fff',borderRadius:10,padding:'1px 7px',fontSize:10,fontWeight:700}}>{unreadCount}</span>}</div>
                  <div style={{display:'flex',gap:6,alignItems:'center'}}>
                    {unreadCount>0&&<button style={{fontSize:11,color:'var(--brand)',background:'none',border:'none',cursor:'pointer',fontFamily:'inherit',fontWeight:600}} onClick={()=>setNotifications(prev=>prev.map(n=>({...n,read:true})))}>Mark all read</button>}
                    <button className="notif-icon-btn" title="Notification settings" onClick={e=>{e.stopPropagation();setShowNotifSettings(s=>!s)}}>⚙️</button>
                    <button style={{background:'none',border:'none',cursor:'pointer',color:'var(--t2)',fontSize:18,lineHeight:1}} onClick={()=>{ setShowNotifPanel(false); setShowNotifSettings(false) }}>×</button>
                  </div>
                </div>
                {summaryParts.length>0&&(
                  <div className="notif-summary">{summaryParts.join(' · ')}</div>
                )}
                {showNotifSettings&&(
                  <div className="notif-settings-panel">
                    <div style={{fontWeight:700,fontSize:12,marginBottom:8}}>Notification Settings</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                      {Object.entries(NOTIF_LABELS).map(([k,label])=>(
                        <label key={k} style={{display:'flex',alignItems:'center',gap:6,fontSize:12,cursor:'pointer'}}>
                          <input type="checkbox" checked={notifPrefs[k]!==false} onChange={e=>saveNotifPrefs({...notifPrefs,[k]:e.target.checked})}/>
                          <span>{NOTIF_TYPE_ICONS[k]} {label}</span>
                        </label>
                      ))}
                    </div>
                    <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,cursor:'pointer',marginTop:8,borderTop:'1px solid var(--border)',paddingTop:8}}>
                      <input type="checkbox" checked={!!notifPrefs.sound} onChange={e=>saveNotifPrefs({...notifPrefs,sound:e.target.checked})}/>
                      <span>🔊 Sound alerts</span>
                    </label>
                  </div>
                )}
                <div style={{overflowY:'auto',flex:1}}>
                  {notifications.length===0 ? (
                    <div style={{padding:'40px 20px',textAlign:'center',color:'var(--t2)'}}>
                      <div style={{fontSize:28,marginBottom:8}}>🔔</div>
                      <div style={{fontSize:13}}>No notifications yet</div>
                    </div>
                  ) : groupOrder.filter(g=>grouped[g]?.length).map(group=>(
                    <div key={group}>
                      <div className="notif-group-lbl">{group}</div>
                      {grouped[group].map((n)=>(
                        <div key={n.id} className={'notif-entry '+(n.read?'read':'unread')} onClick={()=>{ markNotifRead(n.id); setShowNotifPanel(false); navigate('tasks') }}>
                          <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                            <div style={{fontSize:18,lineHeight:1,marginTop:2,flexShrink:0}}>{NOTIF_TYPE_ICONS[n.type]||'🔔'}</div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:13,fontWeight:n.read?400:600,color:'var(--text)',display:'flex',alignItems:'center',gap:6}}>
                                {n.title}
                                {n.read&&<span style={{color:'var(--green)',fontSize:11}}>✓</span>}
                              </div>
                              <div style={{fontSize:12,color:'var(--t2)',marginTop:2,lineHeight:1.4}}>{n.body}</div>
                              <div style={{fontSize:10,color:'var(--t3)',marginTop:3}}>{new Date(n.at).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
                            </div>
                            <div style={{display:'flex',flexDirection:'column',gap:2,flexShrink:0}} onClick={e=>e.stopPropagation()}>
                              {!n.read&&<button className="notif-icon-btn chk" title="Mark read" onClick={()=>markNotifRead(n.id)}>✓</button>}
                              <button className="notif-icon-btn del" title="Delete" onClick={()=>deleteNotif(n.id)}>×</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                {notifications.length>0&&(
                  <div style={{padding:'8px 14px',borderTop:'1px solid var(--border)',flexShrink:0}}>
                    <button style={{fontSize:11,color:'var(--red)',background:'none',border:'none',cursor:'pointer',fontFamily:'inherit'}} onClick={clearAllNotifs}>Clear all</button>
                  </div>
                )}
              </div>
            </>
          )
        })()}

        {showProfile&&(
          <div className="modal-overlay" onClick={()=>setShowProfile(false)}>
            <div className="modal" onClick={e=>e.stopPropagation()}>
              <div className="modal-hdr"><div className="modal-title">My Profile</div><button className="modal-close" onClick={()=>setShowProfile(false)}>×</button></div>
              <div className="modal-body">
                <button className="btn btn-secondary btn-back-dashboard" style={{marginBottom:16}} onClick={()=>{setShowProfile(false);navigate('dashboard')}}>← Back to Dashboard</button>
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
                  {user.industry&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:6}}><span style={{color:'var(--t2)',fontSize:11,textTransform:'uppercase',fontWeight:600,letterSpacing:'.6px'}}>Industry</span><span style={{fontSize:12,fontWeight:600}}>{user.industry}</span></div>}
                </div>
                {profileMsg&&<div style={{background:'rgba(16,185,129,.08)',border:'1px solid rgba(16,185,129,.2)',borderRadius:6,padding:'8px 12px',fontSize:13,color:'var(--green)',marginBottom:14}}>{profileMsg}</div>}
                <div className="form-field"><label className="form-label">Display Name</label><input className="form-input" value={profileName} onChange={e=>setProfileName(e.target.value)}/></div>
                <button className="btn btn-secondary btn-sm" style={{marginBottom:16}} onClick={async()=>{ if(!profileName.trim()) return; if(isConfigured()) await supabase.from('profiles').update({name:profileName.trim()}).eq('id',user.id); setUser(prev=>({...prev,name:profileName.trim()})); setProfileMsg('✓ Name updated') }}>Update Name</button>

                {['client_admin','super_admin'].includes(user.role)&&<>
                <div className="form-field">
                  <label className="form-label">Industry</label>
                  <select className="form-input" value={user.industry||''} onChange={async e=>{
                    const ind = e.target.value
                    setUser(prev=>({...prev,industry:ind}))
                    if(isConfigured()) await supabase.from('profiles').update({industry:ind}).eq('id',user.id)
                    setProfileMsg('✓ Industry updated')
                  }}>
                    <option value="">— Select industry —</option>
                    {PRESET_INDUSTRIES.map(k=><option key={k} value={k}>{k}</option>)}
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
                  {user.industry&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:6}}>
                    <span style={{color:'var(--t2)',fontSize:11,textTransform:'uppercase',fontWeight:600,letterSpacing:'.6px'}}>Industry</span>
                    <span style={{fontSize:12,fontWeight:600}}>{user.industry}</span>
                  </div>}
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
                <div style={{borderTop:'1px solid var(--border)',paddingTop:16,marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:12}}>GPS Tracking</div>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',background:'var(--s3)',borderRadius:8,padding:'10px 14px'}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:600}}>Location tracking</div>
                      <div style={{fontSize:11,color:'var(--t2)',marginTop:2}}>Records GPS when starting and completing tasks</div>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontSize:11,fontWeight:600,color:gpsEnabled===false?'var(--red)':'var(--green)'}}>{gpsEnabled===false?'Disabled':'Enabled'}</span>
                      <button style={{width:40,height:22,borderRadius:11,border:'none',cursor:'pointer',background:gpsEnabled===false?'var(--border)':'var(--green)',position:'relative',transition:'background .2s',flexShrink:0}} onClick={()=>{
                        if(gpsEnabled===false){
                          if(!navigator.geolocation){setProfileMsg('✗ Your device does not support location services.');return}
                          navigator.geolocation.getCurrentPosition(
                            ()=>{localStorage.setItem('taksyn_gps_enabled','true');setGpsEnabled(true);setProfileMsg('✓ GPS tracking enabled')},
                            ()=>{setProfileMsg('✗ Location permission denied — enable in browser settings')}
                          )
                        } else {
                          localStorage.setItem('taksyn_gps_enabled','false');setGpsEnabled(false);setProfileMsg('GPS tracking disabled')
                        }
                      }}>
                        <div style={{width:16,height:16,borderRadius:'50%',background:'#fff',position:'absolute',top:3,transition:'left .2s',left:gpsEnabled===false?3:21,boxShadow:'0 1px 3px rgba(0,0,0,.3)'}}/>
                      </button>
                    </div>
                  </div>
                </div>
                <div style={{borderTop:'1px solid var(--border)',paddingTop:16,marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:700,color:'var(--t2)',textTransform:'uppercase',letterSpacing:'.8px',marginBottom:12}}>Session Timeout</div>
                  <div style={{background:'var(--s3)',borderRadius:8,padding:'10px 14px'}}>
                    <div style={{fontSize:11,color:'var(--t2)',marginBottom:8}}>Default for your role: <strong>{SESSION_ROLE_TIMEOUTS[user.role]||15} min</strong></div>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                      {[{label:'5 min',v:5},{label:'10 min',v:10},{label:'15 min',v:15},{label:'20 min',v:20},{label:'30 min',v:30},{label:'Never',v:0}].map(({label,v})=>{
                        const active = sessionTimeout===v||(sessionTimeout===null&&v===(SESSION_ROLE_TIMEOUTS[user.role]||15))
                        return <button key={v} style={{fontSize:11,padding:'4px 10px',borderRadius:5,border:'1px solid '+(active?'var(--brand)':'var(--border)'),background:active?'var(--brand)':'transparent',color:active?'#fff':'var(--t2)',cursor:'pointer',fontFamily:'inherit',fontWeight:active?700:400}} onClick={()=>{
                          const pref = v===(SESSION_ROLE_TIMEOUTS[user.role]||15)?null:v
                          if(pref===null) localStorage.removeItem('taksyn_session_timeout'); else localStorage.setItem('taksyn_session_timeout',String(v))
                          setSessionTimeout(pref===null?null:v)
                          setProfileMsg(v===0?'Session will never expire':'Session timeout set to '+v+' min')
                        }}>{label}</button>
                      })}
                    </div>
                  </div>
                </div>
                <div style={{borderTop:'1px solid var(--border)',paddingTop:16,display:'flex',flexDirection:'column',gap:8}}>
                  <button className="btn btn-secondary" style={{width:'100%'}} onClick={()=>{setShowProfile(false);clearAuthCache();location.reload()}}>🔄 Clear Cache & Reload</button>
                  <button className="btn btn-danger" style={{width:'100%'}} onClick={()=>{setShowProfile(false);logout()}}>Sign Out</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Role selector modal — shown when user has multiple position assignments */}
        {showRoleSelector&&userPositionsList.length>1&&(
          <div className="modal-overlay" style={{zIndex:600}}>
            <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:440}}>
              <div className="modal-hdr">
                <div>
                  <div className="modal-title">Which role are you working in today?</div>
                  <div style={{fontSize:12,color:'var(--t2)',marginTop:2}}>You have multiple assignments — choose one to start your session</div>
                </div>
              </div>
              <div className="modal-body">
                {userPositionsList.map((pos,i)=>(
                  <div key={i} onClick={()=>{ setActivePosition(pos); sessionStorage.setItem('taksyn-active-position',JSON.stringify(pos)); setShowRoleSelector(false) }}
                    style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',borderRadius:10,border:'1px solid var(--border)',marginBottom:8,cursor:'pointer',transition:'all .15s',background:'var(--s3)'}}
                    onMouseOver={e=>e.currentTarget.style.borderColor='var(--brand)'}
                    onMouseOut={e=>e.currentTarget.style.borderColor='var(--border)'}>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:14}}>{pos.position_title||ROLE_LABELS[pos.role]||pos.role}</div>
                      <div style={{fontSize:12,color:'var(--t2)',marginTop:2}}>{pos.department}{pos.is_primary?<span style={{fontSize:10,color:'var(--brand)',fontWeight:600,marginLeft:6}}>★ Primary</span>:''}</div>
                    </div>
                    <span style={{fontSize:18}}>▶</span>
                  </div>
                ))}
                <button className="btn btn-secondary" style={{width:'100%',marginTop:4}} onClick={()=>setShowRoleSelector(false)}>Skip — show all tasks</button>
              </div>
            </div>
          </div>
        )}

        <div className="main">
          <div className={"sidebar-overlay "+(sidebarOpen?'open':'')} onClick={()=>setSidebarOpen(false)}/>

          {user.role==='super_admin' ? (
            /* ── SUPER ADMIN SIDEBAR ── dark platform-admin theme */
            <div className={"sidebar "+(sidebarCollapsed?'collapsed ':''+(sidebarOpen?'mobile-open':''))} style={{background:'#0F172A',borderRight:'1px solid rgba(255,255,255,.06)'}}>
              <div style={{padding:'16px 12px 8px'}}>
                {!sidebarCollapsed&&(
                  <div style={{marginBottom:16,padding:'10px 10px',borderRadius:8,background:'rgba(255,255,255,.05)',border:'1px solid rgba(255,255,255,.08)'}}>
                    <div style={{fontSize:9,fontWeight:800,color:'#F59E0B',textTransform:'uppercase',letterSpacing:'1.2px',marginBottom:2}}>Platform Admin</div>
                    <div style={{fontSize:11,color:'rgba(255,255,255,.5)',lineHeight:1.3}}>Taksyn Control Panel</div>
                  </div>
                )}
                {navItems.map(([key,label,icon])=>{
                  const active = page===key
                  return (
                    <button key={key} onClick={()=>navigate(key)} title={label} style={{display:'flex',alignItems:'center',gap:9,padding:'8px 10px',borderRadius:6,cursor:'pointer',width:'100%',textAlign:'left',fontFamily:'inherit',border:'none',marginBottom:2,fontSize:13,fontWeight:active?700:500,background:active?'rgba(245,158,11,.15)':'transparent',color:active?'#F59E0B':'rgba(255,255,255,.65)',transition:'all .15s',whiteSpace:'nowrap',overflow:'hidden'}}>
                      <IC n={icon} s={15}/>
                      <span className="nav-item-label">{label}</span>
                    </button>
                  )
                })}
              </div>
              <div style={{marginTop:'auto',padding:'10px 12px',borderTop:'1px solid rgba(255,255,255,.06)'}}>
                <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderRadius:6,background:'rgba(255,255,255,.05)',marginBottom:6,overflow:'hidden'}}>
                  <Avatar name={user.name} role={user.role} size={28} avatarUrl={user.avatar_url}/>
                  <div className="sb-user-info">
                    <div style={{fontSize:11,fontWeight:600,color:'rgba(255,255,255,.9)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{user.name}</div>
                    <div style={{fontSize:9,color:'#F59E0B',fontWeight:700,letterSpacing:'.3px'}}>Super Admin</div>
                  </div>
                </div>
                <button onClick={logout} style={{width:'100%',padding:'7px',background:'rgba(239,68,68,.12)',border:'1px solid rgba(239,68,68,.2)',borderRadius:6,color:'#F87171',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>Sign Out</button>
              </div>
            </div>
          ) : (
            /* ── STANDARD SIDEBAR ── */
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
                {activePosition&&!['super_admin','client_admin'].includes(user.role)&&(
                  <div style={{marginBottom:6,padding:'6px 8px',borderRadius:6,background:'var(--brand-lt)',border:'1px solid rgba(0,168,126,.2)',cursor:'pointer',display:'flex',alignItems:'center',gap:6}} onClick={()=>setShowRoleSelector(true)} title="Switch role">
                    <div className="sb-user-info" style={{flex:1}}>
                      <div style={{fontSize:10,color:'var(--brand)',fontWeight:700,textTransform:'uppercase',letterSpacing:'.5px'}}>Active Role</div>
                      <div style={{fontSize:11,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{activePosition.position_title||ROLE_LABELS[activePosition.role]}</div>
                      <div style={{fontSize:9,color:'var(--t2)'}}>{activePosition.department}</div>
                    </div>
                    <span style={{fontSize:10,color:'var(--brand)',flexShrink:0}}>⇄</span>
                  </div>
                )}
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
          )}

          <div className="content">
            {PAGE_ACCESS[page]&&!hasAccess(user.role,PAGE_ACCESS[page]) ? (
              <div className="empty" style={{marginTop:60}}><div className="empty-icon">🔒</div><div style={{fontSize:16,fontWeight:700,marginBottom:8}}>Access Restricted</div><div className="empty-text">Your role ({ROLE_LABELS[user.role]}) does not have access to this section.</div></div>
            ) : (
              <>
                {page==='dashboard'   && <DashboardView   {...pageProps} tickets={tickets} leaveRecords={leaveRecords}/>}
                {page==='tasks'       && user.role!=='super_admin' && <TasksView {...pageProps}/>}
                {page==='evidence'    && user.role!=='super_admin' && hasAccess(user.role,2) && <EvidenceView   {...pageProps}/>}
                {page==='escalations' && user.role!=='super_admin' && hasAccess(user.role,2) && <EscalationsView {...pageProps}/>}
                {page==='reports'     && user.role!=='super_admin' && hasAccess(user.role,3) && <ReportsView    {...pageProps}/>}
                {page==='audit'       && hasAccess(user.role,2) && <AuditLogView   {...pageProps}/>}
                {page==='orgs'        && user.role==='super_admin' && <OrganisationsView {...pageProps}/>}
                {page==='users'       && hasAccess(user.role,4) && <UsersView      {...pageProps}/>}
                {page==='tiers'       && user.role!=='super_admin' && hasAccess(user.role,4) && <TiersView      {...pageProps}/>}
                {page==='support'     && user.role==='super_admin' && <SupportView {...pageProps}/>}
                {page==='help'        && user.role!=='super_admin' && <HelpView {...pageProps}/>}
                {page==='projects'    && user.role!=='super_admin' && hasAccess(user.role,2) && <ProjectsView {...pageProps}/>}
                {page==='performance' && user.role!=='super_admin' && hasAccess(user.role,4) && <PerformanceView {...pageProps}/>}
                {page==='leave'       && user.role!=='super_admin' && <LeaveView {...pageProps}/>}
                {page==='teams'       && hasAccess(user.role,2) && <TeamsView {...pageProps}/>}
                {page==='sla'         && ['client_admin','super_admin'].includes(user.role) && <SLASettingsView {...pageProps}/>}
                {page==='company_settings' && ['client_admin','super_admin'].includes(user.role) && <CompanySettingsView user={user}/>}
                {page==='notifications' && user.role==='super_admin' && <PlatformAnnouncementsView user={user}/>}
                {page==='platform_industries' && user.role==='super_admin' && <PlatformIndustriesView user={user}/>}
                {page==='roles_departments' && ['client_admin','super_admin'].includes(user.role) && <RolesPositionsView user={user}/>}
                {page==='platform_settings' && user.role==='super_admin' && <PlatformSettingsView user={user} sessionTimeout={sessionTimeout} setSessionTimeout={setSessionTimeout}/>}
                {page==='my_account' && user.role==='super_admin' && <SuperAdminAccountView user={user} setUser={setUser}/>}
              </>
            )}
          </div>
        </div>

      </div>
    </>
  )
}
