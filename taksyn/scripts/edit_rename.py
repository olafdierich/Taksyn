#!/usr/bin/env python3
# Abort-safe rename: sidebar nav labels + page headers -> "Complaints & Feedback".
# Uses exact full-token anchors. Asserts expected counts. Writes nothing on mismatch.
import sys

PATH = "/workspaces/Taksyn/taksyn/src/App.jsx"

def main():
    with open(PATH, "r", encoding="utf-8") as f:
        src = f.read()
    orig = src

    # (name, anchor, replacement, expected_count)
    ops = [
        # client_admin nav label — the full token is unique (only client_admin has this exact triplet)
        ("ca_nav",
         "['issue_reports','Requests','clipboard']",
         "['issue_reports','Complaints & Feedback','clipboard']",
         1),
        # submitter nav label — identical across manager/supervisor/worker (3 occurrences), all become the same
        ("submitter_nav",
         "['issue_reports','Log a Request','flag']",
         "['issue_reports','Log a Complaint / Feedback','flag']",
         3),
        # ReportIssueView header (submitter)
        ("submitter_header",
         '<div className="ph"><div className="ph-title">Log a Request</div><div className="ph-sub">Let your team know about a problem that needs attention</div></div>',
         '<div className="ph"><div className="ph-title">Log a Complaint / Feedback</div><div className="ph-sub">Raise a complaint, share feedback, or log a request that needs attention</div></div>',
         1),
        # IssueReportsAdminView header (admin)
        ("admin_header",
         '<div className="ph"><div className="ph-title">Requests</div><div className="ph-sub">Requests logged by your team</div></div>',
         '<div className="ph"><div className="ph-title">Complaints & Feedback</div><div className="ph-sub">Complaints, feedback and requests from your team</div></div>',
         1),
    ]

    # verify all counts first
    for name, anchor, _, expected in ops:
        c = src.count(anchor)
        if c != expected:
            print(f"ABORT: anchor '{name}' matched {c} times (expected {expected}). No changes written.")
            sys.exit(1)

    # apply
    for name, anchor, repl, expected in ops:
        src = src.replace(anchor, repl)  # replace all; count already asserted

    if src == orig:
        print("ABORT: no net change. No file written.")
        sys.exit(1)

    with open(PATH, "w", encoding="utf-8") as f:
        f.write(src)
    print(f"OK: applied {len(ops)} rename ops to {PATH}")

if __name__ == "__main__":
    main()
