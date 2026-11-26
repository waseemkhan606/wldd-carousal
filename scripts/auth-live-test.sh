#!/usr/bin/env bash
# Live auth test against a throwaway server (CHECKPOINT 0). Usage: scripts/auth-live-test.sh
set -u
PORT=3111; B=http://localhost:$PORT; J='content-type: application/json'
TMP=$(mktemp -d); export DATA_DIR=$TMP/data TRUST_PROXY=1
npx next dev -p $PORT > $TMP/dev.log 2>&1 & PID=$!
trap 'kill $PID 2>/dev/null; pkill -f "next dev -p $PORT" 2>/dev/null' EXIT
for i in $(seq 40); do grep -q "shown ONCE" $TMP/dev.log && break; sleep 0.5; done
TOK=$(grep -A2 "shown ONCE" $TMP/dev.log | tail -1 | tr -d ' ')
pass=0; fail=0
check(){ if [ "$2" = "$3" ]; then echo "PASS $1 ($2)"; pass=$((pass+1)); else echo "FAIL $1 expected=$3 got=$2"; fail=$((fail+1)); fi; }
code(){ curl -s -o /dev/null -w "%{http_code}" "$@"; }
login(){ curl -s -c $1 -o /dev/null -w "%{http_code}" -X POST -H "$J" -H "x-forwarded-for: $3" -d "{\"token\":\"$2\"}" $B/api/auth/login; }

check "/ redirects to /login" "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' $B/)" "307 $B/login"
check "/api/brands unauth" "$(code $B/api/brands)" 401
check "/api/health public" "$(code $B/api/health)" 200
check "/login public" "$(code $B/login)" 200
check "token not on disk" "$(grep -rl "$TOK" $DATA_DIR | wc -l | tr -d ' ')" 0
check "token printed once" "$(grep -c "$TOK" $TMP/dev.log)" 1
check "right token logs in" "$(login $TMP/a $TOK 1.1.1.1)" 200
check "session opens /api/brands" "$(code -b $TMP/a $B/api/brands)" 200
check "session opens /brands page" "$(code -b $TMP/a $B/brands)" 200
check "tampered cookie rejected" "$(code -b 'cs_session=1.9999999999.AAAA' $B/api/brands)" 401
# second session B, then rotate from A: B must die, A stays alive (re-issued)
login $TMP/b $TOK 1.1.1.2 >/dev/null
check "wrong current token on rotate" "$(code -b $TMP/a -X POST -H "$J" -d '{"current":"bad"}' $B/api/auth/rotate)" 401
R=$(curl -s -b $TMP/a -c $TMP/a -X POST -H "$J" -d "{\"current\":\"$TOK\"}" $B/api/auth/rotate)
NEW=$(echo "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
check "rotation: other session B invalidated" "$(code -b $TMP/b $B/api/brands)" 401
check "rotation: rotating session stays signed in" "$(code -b $TMP/a $B/api/brands)" 200
check "rotation: old token rejected" "$(login $TMP/c $TOK 1.1.1.3)" 401
check "rotation: new token accepted" "$(login $TMP/c $NEW 1.1.1.4)" 200
check "new token not on disk" "$(grep -rl "$NEW" $DATA_DIR | wc -l | tr -d ' ')" 0
# rate limit: 5 wrong -> 6th is 429, even with the right token
for i in 1 2 3 4 5; do login $TMP/x bad 2.2.2.2 >/dev/null; done
check "6th attempt locked out" "$(login $TMP/x bad 2.2.2.2)" 429
check "right token also locked out" "$(login $TMP/x $NEW 2.2.2.2)" 429
check "other IP unaffected" "$(login $TMP/y $NEW 3.3.3.3)" 200
# logout
curl -s -b $TMP/c -c $TMP/c -X POST $B/api/auth/logout -o /dev/null
check "logout clears session" "$(code -b $TMP/c $B/api/brands)" 401
echo "---- $pass passed, $fail failed"; rm -rf $TMP; [ $fail -eq 0 ]
