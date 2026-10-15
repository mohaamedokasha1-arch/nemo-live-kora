#!/usr/bin/env bash
set +e
export NEMO_DATA_DIR=/tmp/nemo-e2e NEMO_GATEWAY_STORE_PERSIST=on
mkdir -p $NEMO_DATA_DIR
echo "### LIVE ENGINE"
node --import tsx .github/probe/live.ts 2>&1 | tail -150
echo "### BUILD"
npm run build > /tmp/build.log 2>&1; echo "build exit $?"; tail -5 /tmp/build.log
echo "### SERVER"
(npm start > /tmp/server.log 2>&1 &) ; sleep 8
TODAY=$(TZ=Africa/Cairo date +%F); TOM=$(TZ=Africa/Cairo date -d tomorrow +%F)
for p in / /matches /matches/$TOM /matches/$TODAY "/api/matches?date=$TODAY" "/api/matches?date=$TOM" /news /about /sitemap.xml /api/health; do
  code=$(curl -s -o /tmp/page -w '%{http_code} %{time_total}s %{size_download}B' "http://127.0.0.1:3000$p"); echo "PAGE $p $code cards=$(grep -o 'kl-match-card' /tmp/page | wc -l) attribution=$(grep -c 'sportscore.com/' /tmp/page)"
done
curl -s "http://127.0.0.1:3000/api/matches?date=$TOM" > /tmp/tom.json
python3 - <<'PY'
import json,subprocess
d=json.load(open('/tmp/tom.json')); ms=d.get('matches',[])
print('API tomorrow', len(ms), 'first5', [(m['competitionNameAr'], m['homeTeam']['nameAr'], m['awayTeam']['nameAr'], m['cairoTime']) for m in ms[:5]])
ids=[m['id'] for m in ms[:3]]
for i in ids:
    out=subprocess.run(['curl','-s','-o','/tmp/d','-w','%{http_code}',f'http://127.0.0.1:3000/matches/{i}'],capture_output=True,text=True).stdout
    html=open('/tmp/d',encoding='utf-8',errors='replace').read()
    print('DETAIL',i,out,'has_title', ms[0]['homeTeam']['nameAr'][:6] in html or 'ضد' in html, 'attribution', 'sportscore.com/' in html)
PY
curl -s -A 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' -o /tmp/m http://127.0.0.1:3000/ -w 'MOBILE UA home %{http_code}\n'
echo "### SERVER LOG (errors)"; grep -iE "error|warn|unhandled" /tmp/server.log | head -20; tail -5 /tmp/server.log
