#!/bin/bash
# check-conventions.sh — runs in a dashboard project root, verifies it follows
# conventions in ~/claude-code/personal/infra-docs/.
#
# Usage:  ./check-conventions.sh           (run from project root)
# Or:     ~/claude-code/personal/infra-docs/bin/check-conventions.sh
#
# Exit code 0 = clean (warnings allowed), 1 = blocking violations found.

PROJECT_DIR="${PWD}"
SRC="${PROJECT_DIR}/src"
FAIL=0
WARN=0

red()    { printf '\033[31m%s\033[0m\n' "$1"; }
green()  { printf '\033[32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[33m%s\033[0m\n' "$1"; }

pass() { green   "✓ $1"; }
fail() { red     "✗ $1"; FAIL=1; }
warn() { yellow  "! $1"; WARN=1; }

echo "=== Conventions check: $(basename "$PROJECT_DIR") ==="

if [ ! -d "$SRC" ]; then
  fail "no src/ directory — is this a dashboard project?"
  exit 1
fi

HAS_UI=0
if find "$SRC" -name '*.tsx' -not -path '*/node_modules/*' 2>/dev/null | head -1 | grep -q .; then
  HAS_UI=1
fi

# ---------- UI rules (only if .tsx files exist) ----------

if [ "$HAS_UI" = "1" ]; then
  # 1. shadcn must be initialized
  if [ -f "$SRC/components/ui/button.tsx" ] || [ -f "$SRC/components/ui/card.tsx" ]; then
    pass "shadcn initialized (src/components/ui)"
  else
    fail "shadcn not initialized. Run: npx shadcn@latest init -d --force && npx shadcn@latest add card button"
  fi

  # 2. No raw rounded+border divs OUTSIDE components/ui (use Card)
  HITS=$(grep -rlE 'className="[^"]*rounded-(lg|xl)[^"]*border[^"]*' "$SRC" --include='*.tsx' --exclude-dir=ui 2>/dev/null | grep -v '/components/ui/' || true)
  if [ -z "$HITS" ]; then
    pass "no raw rounded-lg/xl + border divs outside components/ui"
  else
    fail "raw rounded-lg/xl + border styling found — use shadcn <Card>:"
    echo "$HITS" | sed 's/^/    /'
    grep -nE 'className="[^"]*rounded-(lg|xl)[^"]*border[^"]*' $HITS 2>/dev/null | head -10 | sed 's/^/    /'
  fi

  # 3. Warn on raw <button className=…> outside components/ui (warn, not fail)
  BTN_HITS=$(grep -rlE '<button [^>]*className=' "$SRC" --include='*.tsx' --exclude-dir=ui 2>/dev/null | grep -v '/components/ui/' || true)
  if [ -z "$BTN_HITS" ]; then
    pass "no raw <button className=…> outside components/ui"
  else
    warn "raw <button className=…> found — prefer shadcn <Button>:"
    echo "$BTN_HITS" | sed 's/^/    /'
  fi

  # 4. Forbidden UI lib imports (HARD fail)
  BAD_IMPORTS=$(grep -rlE 'from .*"(@mantine|@chakra-ui|@mui|@nextui-org|antd|@headlessui)' "$SRC" --include='*.tsx' --include='*.ts' 2>/dev/null || true)
  if [ -z "$BAD_IMPORTS" ]; then
    pass "no forbidden UI library imports"
  else
    fail "forbidden UI library import (only shadcn/radix/base-ui allowed):"
    echo "$BAD_IMPORTS" | sed 's/^/    /'
  fi
fi

# ---------- Auth rules ----------

if [ -f "$PROJECT_DIR/package.json" ]; then
  if grep -q '"next-auth"' "$PROJECT_DIR/package.json" 2>/dev/null; then
    fail "next-auth in package.json — use simple OAuth pattern from infra-docs/snippets/"
  else
    pass "no next-auth dependency"
  fi
fi

if [ -f "$SRC/middleware.ts" ]; then
  if grep -q '__Secure-' "$SRC/middleware.ts"; then
    pass "middleware uses __Secure- cookie prefix"
  else
    warn "middleware.ts present but no __Secure- prefix — verify auth pattern"
  fi
fi

# ---------- Build/security ----------

if [ -f "$PROJECT_DIR/next.config.ts" ]; then
  if grep -q 'poweredByHeader: false' "$PROJECT_DIR/next.config.ts"; then
    pass "next.config.ts hides x-powered-by"
  else
    warn "next.config.ts should set poweredByHeader: false"
  fi
  if grep -q 'Strict-Transport-Security' "$PROJECT_DIR/next.config.ts"; then
    pass "next.config.ts has security headers"
  else
    warn "next.config.ts missing security headers — see infra-docs/DEPLOY.md"
  fi
  if grep -qE 'output:\s*["'\'']standalone["'\'']' "$PROJECT_DIR/next.config.ts"; then
    pass "next.config.ts has output: standalone"
  else
    warn "next.config.ts should set output: 'standalone' for systemd deploy"
  fi
fi

if [ -f "$PROJECT_DIR/.gitignore" ]; then
  if grep -qE '^\.env|^\*\.env' "$PROJECT_DIR/.gitignore" 2>/dev/null; then
    pass ".env in .gitignore"
  else
    warn ".env files might not be gitignored — add .env* to .gitignore"
  fi
fi

echo
if [ "$FAIL" = "1" ]; then
  red "✗ Conventions check FAILED — fix issues above before deploying."
  echo "  Reference: ~/claude-code/personal/infra-docs/{UI,AUTH,DEPLOY}.md"
  exit 1
elif [ "$WARN" = "1" ]; then
  yellow "○ Conventions OK with warnings — review above. Deploy allowed."
  exit 0
else
  green "✓ All conventions clean."
  exit 0
fi
