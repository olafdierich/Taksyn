#!/usr/bin/env python3
# Abort-safe fix for the "email change doesn't change my sign-in email" bug.
#
# Root cause: supabase.auth.updateUser({email}) only PENDS the change until the
# confirmation link is clicked, but both code paths immediately wrote the new
# address into profiles.email / setUser, so the UI claimed the change was done.
#
# Three edits:
#   1. Path A (profile save)  - name-only profile write, surface auth errors, pending message
#   2. Path B (Update Email)  - drop the optimistic profiles/setUser writes, stronger message
#   3. Login sync             - sync profiles.email from auth whenever they differ (self-heals)
#
# Each anchor must match EXACTLY ONCE. Writes nothing on mismatch.
import sys

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"

def main():
    with open(PATH, "r", encoding="utf-8") as f:
        src = f.read()
    orig = src
    edits = []

    # ---- Edit 1: Path A - profile save() ----
    a1 = ("    const updates = {name:form.name.trim(),email:form.email.trim()}\n"
          "    if(isConfigured()){\n"
          "      const { error } = await supabase.from('profiles').update(updates).eq('id',user.id); if(error) setMsg('\u2717 '+error.message)\n"
          "      if(form.email!==user.email) await supabase.auth.updateUser({email:form.email}).catch(()=>{})\n"
          "    }\n"
          "    if(setUser) setUser(prev=>({...prev,...updates}))\n"
          "    setMsg('\u2713 Profile saved')\n"
          "    setSaving(false)\n"
          "    setTimeout(()=>setMsg(''),3000)\n")
    r1 = ("    const updates = {name:form.name.trim()}\n"
          "    const emailChanged = form.email.trim() && form.email.trim()!==user.email\n"
          "    if(isConfigured()){\n"
          "      const { error } = await supabase.from('profiles').update(updates).eq('id',user.id); if(error) setMsg('\u2717 '+error.message)\n"
          "      if(emailChanged){\n"
          "        const { error: emailErr } = await supabase.auth.updateUser({email:form.email.trim()})\n"
          "        if(emailErr){ setMsg('\u2717 '+emailErr.message); setSaving(false); return }\n"
          "      }\n"
          "    }\n"
          "    if(setUser) setUser(prev=>({...prev,...updates}))\n"
          "    setMsg(emailChanged\n"
          "      ? '\u2713 Name saved. Confirmation sent to '+form.email.trim()+' \u2014 click the link in that inbox to finish. Until you do, keep signing in with '+user.email\n"
          "      : '\u2713 Profile saved')\n"
          "    setSaving(false)\n"
          "    setTimeout(()=>setMsg(''),emailChanged?15000:3000)\n")
    edits.append(("path_a_save", a1, r1))

    # ---- Edit 2: Path B - Update Email button ----
    a2 = ("                    // Also update profiles table so admins see the new email\n"
          "                    await supabase.from('profiles').update({email:newEmail.trim()}).eq('id',user.id)\n"
          "                    setUser(prev=>({...prev,email:newEmail.trim()}))\n"
          "                    setProfileMsg('\u2713 Confirmation sent to '+newEmail+' \u2014 check your inbox to confirm the change')\n"
          "                    setNewEmail('')\n")
    r2 = ("                    // Do NOT write profiles.email or setUser here \u2014 the change is only PENDING\n"
          "                    // until the confirmation link is clicked. profiles.email is synced from auth on login.\n"
          "                    setProfileMsg('\u2713 Confirmation sent to '+newEmail.trim()+' \u2014 click the link in that inbox to finish. Until you do, keep signing in with '+user.email)\n"
          "                    setNewEmail('')\n")
    edits.append(("path_b_update_email", a2, r2))

    # ---- Edit 3: login sync - mirror auth email into profiles whenever they differ ----
    a3 = "          if(data) { setUser({...data,email:session.user.email}); setNeedsPasswordSetup(false); if(isConfigured()&&!data.email) supabase.from('profiles').update({email:session.user.email}).eq('id',session.user.id).then(()=>{}) }\n"
    r3 = "          if(data) { setUser({...data,email:session.user.email}); setNeedsPasswordSetup(false); if(isConfigured()&&data.email!==session.user.email) supabase.from('profiles').update({email:session.user.email}).eq('id',session.user.id).then(()=>{}) }\n"
    edits.append(("login_email_sync", a3, r3))

    for name, anchor, _ in edits:
        c = src.count(anchor)
        if c != 1:
            print(f"ABORT: anchor '{name}' matched {c} times (expected 1). No changes written.")
            sys.exit(1)

    for name, anchor, repl in edits:
        src = src.replace(anchor, repl, 1)

    if src == orig:
        print("ABORT: no net change. No file written.")
        sys.exit(1)

    with open(PATH, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"OK: applied {len(edits)} edits to {PATH}")

if __name__ == "__main__":
    main()
