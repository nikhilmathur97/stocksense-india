#!/usr/bin/env python3
"""
Fully automated production deployment — StockSense India
Provisions: Railway (PostgreSQL + Redis + FastAPI backend) + Vercel (Next.js)

Usage:
    RAILWAY_API_TOKEN=<token> python3 scripts/deploy_prod.py
"""
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, "frontend")

# ── Railway token (required) ──────────────────────────────────────────────────
RAILWAY_TOKEN = os.environ.get("RAILWAY_API_TOKEN") or os.environ.get("RAILWAY_TOKEN") or ""
if not RAILWAY_TOKEN:
    print("\n❌ Missing Railway API token.")
    print("   Get it from: https://railway.com/account/tokens → Create Token")
    print("   Then run:")
    print("   RAILWAY_API_TOKEN=your_token python3 scripts/deploy_prod.py\n")
    sys.exit(1)
os.environ["RAILWAY_API_TOKEN"] = RAILWAY_TOKEN

ANGEL_ONE_API_KEY     = "F2BP8qON"
ANGEL_ONE_CLIENT_CODE = "N61493142"
ANGEL_ONE_PASSWORD    = "1997"
ANGEL_ONE_TOTP_SECRET = "FUIBOTOT65NLX3JEJ4B73ZDRVU"
JWT_SECRET_KEY        = "ff75788ea43305b14a07890df76185c1670dad49262690c5a0b0c46019a5751c"
VERCEL_URL            = "https://stocksense-india-two.vercel.app"


# ── Helpers ───────────────────────────────────────────────────────────────────

def run(cmd, cwd=ROOT, capture=True, check=True):
    """Run a shell command; return stdout string on success."""
    result = subprocess.run(
        cmd, shell=True, cwd=cwd,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
        text=True,
    )
    if check and result.returncode != 0:
        print(f"\n❌ Command failed: {cmd}")
        if result.stderr:
            print(result.stderr[-2000:])
        sys.exit(1)
    return result.stdout.strip() if capture else ""


def rjson(cmd, cwd=ROOT):
    """Run a Railway CLI command and parse JSON output."""
    out = run(f"{cmd} --json", cwd=cwd)
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        print(f"⚠ Could not parse JSON from: {cmd}\n{out}")
        return {}


def step(msg):
    print(f"\n{'='*60}")
    print(f"  {msg}")
    print(f"{'='*60}")


# ── Vercel helpers ────────────────────────────────────────────────────────────

def vercel_env_set(key, value):
    proc = subprocess.run(
        f"vercel env add {key} production --force",
        shell=True, cwd=FRONTEND,
        input=value, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    ok = proc.returncode == 0
    print(f"  {'✅' if ok else '⚠'} Vercel env {key}={value[:30]}{'...' if len(value) > 30 else ''}")
    return ok


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("\n🚀 StockSense India — Automated Production Deployment")
    print("  Frontend: Vercel (already live)")
    print("  Backend:  Railway (PostgreSQL + Redis + FastAPI)")
    print()

    # ── 0. Verify Railway token works ─────────────────────────────────────────
    step("Step 1/8 · Verify Railway credentials")
    result = run("railway whoami", check=False)
    if "Unauthorized" in result or not result:
        print("❌ Railway token is invalid or expired.")
        print("   Get a fresh one: https://railway.com/account/tokens")
        sys.exit(1)
    print(f"  ✅ Authenticated as: {result}")

    # ── 2. Create Railway project ─────────────────────────────────────────────
    step("Step 2/8 · Create Railway project")
    project = rjson("railway init --name stocksense-india")
    project_id = project.get("id", "")
    print(f"  ✅ Project created: {project_id or '(id not returned, continuing)'}")
    time.sleep(2)

    # ── 3. Add PostgreSQL ─────────────────────────────────────────────────────
    step("Step 3/8 · Provision PostgreSQL")
    pg = rjson("railway add --database postgres")
    print(f"  ✅ PostgreSQL provisioned: {pg.get('id', 'ok')}")
    time.sleep(3)

    # ── 4. Add Redis ──────────────────────────────────────────────────────────
    step("Step 4/8 · Provision Redis")
    rd = rjson("railway add --database redis")
    print(f"  ✅ Redis provisioned: {rd.get('id', 'ok')}")
    time.sleep(3)

    # ── 5. Create backend service ─────────────────────────────────────────────
    step("Step 5/8 · Create backend service")
    svc = rjson("railway add --service backend")
    print(f"  ✅ Service created: {svc.get('id', 'ok')}")
    time.sleep(2)

    # ── 6. Set environment variables ──────────────────────────────────────────
    step("Step 6/8 · Configure environment variables")

    env_vars = {
        "ANGEL_ONE_API_KEY":     ANGEL_ONE_API_KEY,
        "ANGEL_ONE_CLIENT_CODE": ANGEL_ONE_CLIENT_CODE,
        "ANGEL_ONE_PASSWORD":    ANGEL_ONE_PASSWORD,
        "ANGEL_ONE_TOTP_SECRET": ANGEL_ONE_TOTP_SECRET,
        "JWT_SECRET_KEY":        JWT_SECRET_KEY,
        "ENVIRONMENT":           "production",
        "DEBUG":                 "false",
        "TIMEZONE":              "Asia/Kolkata",
        "SCREENER_INTERVAL_SECONDS": "60",
        "MARKET_OPEN_TIME":      "09:15",
        "MARKET_CLOSE_TIME":     "15:30",
        "ALLOWED_ORIGINS":       f"{VERCEL_URL},https://stocksense-india-two.vercel.app",
    }

    for key, value in env_vars.items():
        run(
            f"railway variable set {key}={value!r} --service backend --skip-deploys",
            check=False,
        )
        print(f"  ✅ {key}")

    # ── 7. Deploy backend ─────────────────────────────────────────────────────
    step("Step 7/8 · Deploy backend to Railway (Docker build ~3-5 min)")
    print("  Building and deploying — please wait...")
    subprocess.run(
        "railway up --service backend --detach",
        shell=True, cwd=ROOT,
    )

    # Generate a public domain for the backend service
    print("  Generating public domain...")
    time.sleep(5)
    domain_out = rjson("railway domain --service backend")
    domain = domain_out.get("domain", "")
    backend_url = f"https://{domain}" if domain else ""

    if not backend_url:
        # Fallback: try to get URL from service status
        print("  ⚠ Domain not returned immediately — checking service status...")
        time.sleep(10)
        domain_out = rjson("railway domain --service backend")
        domain = domain_out.get("domain", "")
        backend_url = f"https://{domain}" if domain else ""

    if backend_url:
        print(f"  ✅ Backend URL: {backend_url}")
        # Update ALLOWED_ORIGINS with actual backend URL
        run(
            f"railway variable set ALLOWED_ORIGINS={backend_url},{VERCEL_URL} --service backend --skip-deploys",
            check=False,
        )
    else:
        print("  ⚠ Could not retrieve backend URL automatically.")
        backend_url = input("  Enter the Railway backend URL manually (https://xxx.up.railway.app): ").strip()

    # ── 8. Update Vercel env vars and redeploy ────────────────────────────────
    step("Step 8/8 · Wire Vercel → Railway backend")
    ws_url = backend_url.replace("https://", "wss://", 1)

    vercel_env_set("NEXT_PUBLIC_API_URL", backend_url)
    vercel_env_set("NEXT_PUBLIC_WS_URL", ws_url)
    vercel_env_set("NEXT_PUBLIC_APP_NAME", "StockSense India")

    print("\n  Redeploying frontend with updated env vars...")
    subprocess.run("vercel --prod --yes", shell=True, cwd=FRONTEND)

    # ── Done ──────────────────────────────────────────────────────────────────
    print("\n" + "="*60)
    print("  🎉 Deployment complete!")
    print("="*60)
    print(f"\n  Frontend : {VERCEL_URL}")
    print(f"  Backend  : {backend_url}")
    print(f"  Health   : {backend_url}/health")
    print(f"\n  Railway dashboard : https://railway.app")
    print(f"  Vercel dashboard  : https://vercel.com")
    print()
    print("  ⏳ Backend Docker build takes 3-5 min.")
    print("     Monitor at: https://railway.app → stocksense-india → Deployments")
    print()


if __name__ == "__main__":
    main()
