#!/usr/bin/env bash
set +e
TODAY=$(TZ=Africa/Cairo date +%F)
TOM=$(TZ=Africa/Cairo date -d tomorrow +%F)
echo "TODAY=$TODAY TOMORROW=$TOM"
p() { echo "=== $1"; curl -sS -m 25 -A 'nemo-live-kora-probe' -o /tmp/out -w 'HTTP %{http_code} size %{size_download}\n' "$1"; head -c ${2:-1500} /tmp/out; echo; }
p "https://sportscore.com/api/widget/matches/?sport=football&limit=50&src=nemo-live-kora" 2500
p "https://sportscore.com/api/v1/fixtures/?sport=football&date=$TODAY&src=nemo-live-kora" 2500
python3 - <<'PY'
import json
try:
  d=json.load(open('/tmp/out'))
  lst=d if isinstance(d,list) else d.get('matches') or d.get('fixtures') or d.get('events') or d.get('data') or []
  print('fixtures count',len(lst))
  from collections import Counter
  print(Counter([m.get('competition') for m in lst]).most_common(80))
except Exception as e: print('parse err',e)
PY
p "https://sportscore.com/api/v1/fixtures/?sport=football&date=$TOM&src=nemo-live-kora" 600
p "https://sportscore.com/developers/" 6000
p "https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=$TODAY&s=Soccer" 1500
p "https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=$TOM&s=Soccer" 600
p "https://www.thesportsdb.com/api/v1/json/123/eventsnextleague.php?id=4829" 800
for L in egy.1 ksa.1 uae.1 qat.1 caf.champions caf.confed eng.1 esp.1 ita.1 ger.1 fra.1 uefa.champions fifa.worldq.afr all; do
  echo "=== ESPN $L"; curl -sS -m 20 -o /tmp/e "https://site.api.espn.com/apis/site/v2/sports/soccer/$L/scoreboard?dates=${TODAY//-/}" -w 'HTTP %{http_code}\n'; python3 -c "
import json;d=json.load(open('/tmp/e'));ev=d.get('events',[]);print(len(ev),[e.get('name') for e in ev][:6])" 2>&1 | head -3
done
p "https://nemo-live-kora.vercel.app/api/matches?date=$TODAY" 400
python3 -c "
import json;d=json.load(open('/tmp/out'));print({k:(v if not isinstance(v,(list,dict)) else len(v)) for k,v in d.items()})" 2>&1 | head -5
p "https://nemo-live-kora.vercel.app/api/matches?date=$TOM" 300
p "https://nemo-live-kora.vercel.app/api/health" 3000
