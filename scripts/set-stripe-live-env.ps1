<#
Put the two live Stripe API keys into Vercel Production, without either ever
appearing on screen, in your shell history, in a file, or in an agent's
transcript.

    STRIPE_SECRET_KEY       sk_live_…   (Reveal live key)
    STRIPE_PUBLISHABLE_KEY  pk_live_…

Both come from https://dashboard.stripe.com/apikeys with the dashboard in LIVE
mode.

WHY ONLY THESE TWO
------------------
Everything else is already set and none of it needed typing.
STRIPE_SUPPORT_PRODUCT_ID and PUBLIC_APP_ORIGIN are not credentials.
STRIPE_WEBHOOK_SECRET is one, and it was moved from Stripe to Vercel by a script
without ever being displayed — Stripe returns a webhook endpoint's signing
secret in the response that CREATES the endpoint, so a program can catch it in
flight. These two have no such path: Stripe exposes no API that returns your
secret or publishable key (there is no /v1/apikeys, by design), so a human has
to read them from the dashboard. That is the only reason this file exists.

USAGE
-----
Open PowerShell and run:

    powershell -ExecutionPolicy Bypass -File "E:\users\cheyr\deckpal-wt\billing\scripts\set-stripe-live-env.ps1"

It does not deploy anything. The merge is the deploy, and it is deliberately not
in here.
#>

[CmdletBinding()]
param(
    [string]$Target = 'production',
    [string]$LinkedCheckout = 'E:\users\cheyr\deckpal'
)

$ErrorActionPreference = 'Stop'

# The npm global bin is not always on PATH in a fresh shell.
if (-not (Get-Command vercel -ErrorAction SilentlyContinue)) {
    $env:PATH = "$env:PATH;$env:APPDATA\npm"
}
if (-not (Get-Command vercel -ErrorAction SilentlyContinue)) {
    Write-Host "vercel CLI not found. Run: npm i -g vercel   then: vercel login" -ForegroundColor Red
    exit 1
}

# Vercel commands only work from the checkout holding .vercel\ , and this script
# lives in a branch worktree that does not have one.
if (-not (Test-Path (Join-Path $LinkedCheckout '.vercel'))) {
    Write-Host "No .vercel\ in $LinkedCheckout. Pass -LinkedCheckout <path to the checkout you ran 'vercel link' in>." -ForegroundColor Red
    exit 1
}
Push-Location $LinkedCheckout

try {
    Write-Host ""
    Write-Host "Linked project: $LinkedCheckout"
    Write-Host "Setting two API keys on: $Target"
    Write-Host "Nothing you type is echoed, stored, or printed back."
    Write-Host ""

    $modes = @{}

    function Get-KeyMode([string]$Value) {
        if ($Value -like 'sk_live_*' -or $Value -like 'rk_live_*' -or $Value -like 'pk_live_*') { return 'live' }
        if ($Value -like 'sk_test_*' -or $Value -like 'rk_test_*' -or $Value -like 'pk_test_*') { return 'test' }
        return 'unknown'
    }

    function Set-Secret([string]$Name, [string]$Prefix) {
        # -AsSecureString keeps it off the screen and out of the history buffer.
        $secure = Read-Host -Prompt "  $Name ($Prefix...)" -AsSecureString

        $bstr  = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try {
            $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }

        if ([string]::IsNullOrWhiteSpace($plain)) {
            Write-Host "    empty - skipped, nothing changed." -ForegroundColor Yellow
            return
        }
        if (-not $plain.StartsWith($Prefix)) {
            Write-Host "    X does not start with '$Prefix'. Nothing sent - check you copied the whole value." -ForegroundColor Red
            return
        }

        # A test key here is the exact failure the billing gate exists to name,
        # and catching it now is cheaper than catching it from /health later.
        $mode = Get-KeyMode $plain
        $modes[$Name] = $mode
        if ($mode -eq 'test') {
            Write-Host "    X that is a TEST key and this is $Target. Nothing sent." -ForegroundColor Red
            return
        }

        # `vercel env add` refuses a name that already exists on the target.
        # A failure here is usually just "it did not exist".
        vercel env rm $Name $Target --yes *> $null

        # The value goes to vercel on STDIN, so it never becomes an argv entry
        # and cannot be read out of the process list.
        $plain | vercel env add $Name $Target *> $null
        if ($?) {
            Write-Host "    OK set" -ForegroundColor Green
        } else {
            Write-Host "    X vercel rejected it. Check 'vercel whoami' and that you are linked." -ForegroundColor Red
        }

        # Do not leave it lying in the session.
        Remove-Variable plain -ErrorAction SilentlyContinue
        [GC]::Collect()
    }

    Set-Secret 'STRIPE_SECRET_KEY'      'sk_'
    Set-Secret 'STRIPE_PUBLISHABLE_KEY' 'pk_'

    # The mismatch that answers every request 200 and fails every confirmation.
    if ($modes.ContainsKey('STRIPE_SECRET_KEY') -and $modes.ContainsKey('STRIPE_PUBLISHABLE_KEY')) {
        if ($modes['STRIPE_SECRET_KEY'] -ne $modes['STRIPE_PUBLISHABLE_KEY']) {
            Write-Host ""
            Write-Host "  !! MODE MISMATCH: secret key is $($modes['STRIPE_SECRET_KEY']), publishable key is $($modes['STRIPE_PUBLISHABLE_KEY'])." -ForegroundColor Red
            Write-Host "     The browser would load Stripe.js on one account while the server creates" -ForegroundColor Red
            Write-Host "     intents on the other: every request answers 200 and every card" -ForegroundColor Red
            Write-Host "     confirmation fails. Fix both before deploying." -ForegroundColor Red
        }
    }

    # Verify: names and targets only, never values.
    Write-Host ""
    Write-Host "On $Target now (names only - values are never displayed):"
    $names = @('STRIPE_SECRET_KEY','STRIPE_PUBLISHABLE_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_SUPPORT_PRODUCT_ID','PUBLIC_APP_ORIGIN')
    $listing = vercel env ls 2>$null
    $found = @()
    foreach ($line in $listing) {
        foreach ($n in $names) {
            if ($line -match "^\s*$n\s" -and $line -match '(?i)production') { $found += $n }
        }
    }
    $found = $found | Sort-Object -Unique
    foreach ($n in $names) {
        if ($found -contains $n) { Write-Host "  [x] $n" -ForegroundColor Green }
        else                     { Write-Host "  [ ] $n  MISSING" -ForegroundColor Red }
    }

    Write-Host ""
    if ($found.Count -eq $names.Count) {
        Write-Host "All five present. Nothing is deployed yet - the merge is the deploy." -ForegroundColor Green
    } else {
        Write-Host "Not all five are set. Do not merge until they are." -ForegroundColor Yellow
    }
    Write-Host "After the merge, the real proof:"
    Write-Host '  curl -s https://deckpal.app/api/health'
    Write-Host '  -> billingGate: configured, stripeMode: live'
}
finally {
    Pop-Location
}
